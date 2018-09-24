const fs = require("fs");
const readline = require("readline");
const { google } = require("googleapis");
const _ = require("lodash");
const Promise = require("bluebird");
const Json2csvParser = require('json2csv').Parser;

// If modifying these scopes, delete token.json.
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];
const TOKEN_PATH = "token.json";

const fetchSpamMessages = (auth, messageIds = [], pageToken = "") => {
  return new Promise((resolve, reject) => {
    let args = {
      includeSpamTrash: true,
      userId: "me",
      labelIds: ["SPAM"]
    };

    if (pageToken) {
      args = Object.assign({}, args, { pageToken });
    }

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.list(args, (err, res) => {
      if (err) return reject(err);

      messageIds = _.concat(
        messageIds,
        _.map(res.data.messages, message => message.id)
      );

      if (res.data.nextPageToken && pageToken !== res.data.nextPageToken)
        return resolve(
          fetchSpamMessages(auth, messageIds, res.data.nextPageToken)
        );

      return resolve(messageIds);
    });
  });
};

const fetchSingleSpamMessage = (auth, id) => {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.get({ userId: "me", id }, (err, res) => {
      if (err) reject(err);
      else resolve(res.data);
    });
  });
};

const parseHeaders = messages => {
  return _.reduce(
    _.map(messages, message =>
      _.map(message.payload.headers, header => header.name)
    ),
    (memo, headers) => _.union(memo, headers),
    []
  );
};

// Load client secrets from a local file.
new Promise((resolve, reject) => {
  fs.readFile("credentials.json", (err, content) => {
    if (err) reject(err);
    else resolve(content);
  });
})
  // Authorize a client with credentials, then call the Gmail API.
  .then(content => authorize(JSON.parse(content)))
  .then(auth => {
    return fetchSpamMessages(auth).then(messageIds => {
      const concurrency = 20;
      return Promise.map(
        messageIds,
        messageId => fetchSingleSpamMessage(auth, messageId),
        { concurrency }
      )
        .then(messages => {
          const headers = parseHeaders(messages).sort();

          const defaults = {};
          _.each(headers, header => _.set(defaults, header, ""));

          const messageHeaders = _.map(messages, message =>
            _.defaults(
              _.reduce(
                message.payload.headers,
                (memo, header) =>
                  Object.assign({}, memo, { [header.name]: header.value.replace('"','\"') }),
                {}
              ),
              defaults
            )
          );

		  const json2csvParser = new Json2csvParser({ fields:headers });
		  const csvData = json2csvParser.parse(messageHeaders);
		  fs.writeFile(`./messageHeaders-${Date.now()}.csv`, csvData, err => {
			if(err) {
				return console.log(err);
			}
		
			console.log("The file was saved!");
		  });
        })
        .catch(err => console.log(err));
    });
  })
  .catch(err => console.log(err));

/**
 * Create an OAuth2 client with the given credentials, and then execute the
 * given callback function.
 * @param {Object} credentials The authorization client credentials.
 * @param {function} callback The callback to call with the authorized client.
 */
const authorize = credentials => {
  return new Promise((resolve, reject) => {
    const { client_secret, client_id, redirect_uris } = credentials.installed;
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    // Check if we have previously stored a token.
    fs.readFile(TOKEN_PATH, (err, token) => {
      if (err) getNewToken(oAuth2Client, resolve, reject);
      else {
        oAuth2Client.setCredentials(JSON.parse(token));
        resolve(oAuth2Client);
      }
    });
  });
};

/**
 * Get and store new token after prompting for user authorization, and then
 * execute the given callback with the authorized OAuth2 client.
 * @param {google.auth.OAuth2} oAuth2Client The OAuth2 client to get token for.
 * @param {getEventsCallback} callback The callback for the authorized client.
 */
const getNewToken = (oAuth2Client, resolve, reject) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES
  });

  console.log("Authorize this app by visiting this url:", authUrl);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question("Enter the code from that page here: ", code => {
    rl.close();

    oAuth2Client.getToken(code, (err, token) => {
      if (err) reject(err);
      else {
        oAuth2Client.setCredentials(token);
        // Store the token to disk for later program executions
        fs.writeFile(TOKEN_PATH, JSON.stringify(token), err => {
          if (err) reject(err);
          else {
            console.log("Token stored to", TOKEN_PATH);
            resolve(oAuth2Client);
          }
        });
      }
    });
  });
};
