const yargs = require('yargs');
const fs = require("fs");
const { google } = require("googleapis");
const _ = require("lodash");
const Promise = require("bluebird");
const Json2csvParser = require('json2csv').Parser;
const authorize = require('./authorize');

var myLabels = {};

const labels_options = {
  describe: 'Limit to messages with specified labels.',
  demand: false,
  alias: 'l'
};

const argv = yargs
  .command('not_spam', 'Mark as not spam', {
    labels: labels_options
  })
  .command('show_titles', 'Show a list of message titles', {
    labels: labels_options
  })
  .command('show_labels', 'Show a list of labels', {
    labels: labels_options
  })
  .command('unspamify', 'Show a list of labels', {
    labels: labels_options
  })
  .help()
  .argv;
var command = process.argv[2];

if (command == 'not_spam') {
  console.log(`Marking messages as not spam.`);
} else if (command == 'show_titles') {
  console.log("Show a list of message titles.");
} else if (command == 'unspamify') {
  console.log("Remove messages from the spam list.");
}

const fetchSpamMessages = (auth, messageIds = [], pageToken = "") => {
  return new Promise((resolve, reject) => {
    let args = {
      includeSpamTrash: true,
      userId: "me",
      labelIds: ["SPAM"]
    };
    if (argv.labels) {
      args.labelIds = _.split(argv.labels, ',');
    }

    if (pageToken) {
      args = Object.assign({}, args, { pageToken });
    }

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.list(args, (err, res) => {
      if (err) return reject(err);

      latest_message_ids = _.map(res.data.messages, message => message.id);
      if (command == 'unspamify') {
        let args = {
          userId: "me",
          resource: {
            ids: latest_message_ids,
            removeLabelIds: ['SPAM']
          }
        };
        // console.log(args, undefined, 2);
        gmail.users.messages.batchModify(args, (err, res) => {
          if (err) return reject(err);
        });
      }

      messageIds = _.concat(
        messageIds,
        latest_message_ids
      );

      if (res.data.nextPageToken && pageToken !== res.data.nextPageToken)
        return resolve(
          fetchSpamMessages(auth, messageIds, res.data.nextPageToken)
        );

      return resolve(messageIds);
    });
  });
};

const fetchLabels = (auth) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
    };

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.labels.list(args, (err, res) => {
      if (err) return reject(err);
      return resolve(res.data.labels);
    });
  });
};

const fetchSingleSpamMessage = (auth, id) => {
  return new Promise((resolve, reject) => {
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.get({ userId: "me", id }, (err, res) => {
      if (err) reject(err);
      else {
        labelMap = {};
        labelIds = res.data.labelIds;
        if (command == 'show_titles') {
          subject_header = _.first(_.filter(res.data.payload.headers, ['name', "Subject"]));
          if (subject_header) {
            console.log(`SUBJECT: ${subject_header.value}`);
          }
          _.each(labelIds, label => _.set(labelMap, label, myLabels[label]));
          console.log(JSON.stringify(labelMap, undefined, 2));
        }

        if (command == 'not_spam') {
          subject_header = _.first(_.filter(res.data.payload.headers, ['name', "Subject"]));
          spam_labels = _.filter(labelIds, labelId => (labelId == "SPAM"));
          if (_.size(spam_labels)) {
            console.log(JSON.stringify(labelIds, undefined, 2));
            labels = _.filter(labelIds, labelId => _.startsWith(labelId, "Label_"));
            if (_.size(labels)) {
              if (subject_header) {
                console.log(`NOT SPAM: "${subject_header.value}"`);
              }
              let args = {
                userId: "me",
                id: id,
                resource: {
                  removeLabelIds: ['SPAM']
                }
              };
              gmail.users.messages.modify(args);
            }
          }
        }
        resolve(res.data);
      }
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

const parseTags = messages => {
  return _.reduce(
    _.map(messages, message => message.labelIds),
    (memo, labelIds) => _.union(memo, labelIds),
    []
  );
};

const client = authorize.client()
  .then(auth => {
    fetchLabels(auth).then(labels => {
      if (command == 'show_labels') {
        if (argv.labels) {
          labels_to_process = _.filter(labels, label => _.includes(_.split(argv.labels, ','), label.id));
        } else {
          labels_to_process = _.filter(labels, label => _.startsWith(label.id, "Label_"));
        }
        _.each(labels_to_process, label => {
          console.log(`${label.id}: ${label.name}`);
          console.log(JSON.stringify(label, undefined, 2));
        });
        process.exit();
      }
      _.each(labels, label => _.set(myLabels, label.id, label.name));
    });
    return fetchSpamMessages(auth).then(messageIds => {
      const concurrency = 20;
      return Promise.map(
        messageIds,
        messageId => fetchSingleSpamMessage(auth, messageId),
        { concurrency }
      )
        .then(messages => {
          console.log('Fetched all Spam Messages');
          // console.log(JSON.stringify(parseTags(messages), undefined, 2));
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
