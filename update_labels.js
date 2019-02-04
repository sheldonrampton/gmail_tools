const yargs = require('yargs');
const { google } = require("googleapis");
const Promise = require("bluebird");
const authorize = require('./authorize');
const _ = require('lodash');

const target_option = {
  describe: 'Tag whose name will be used.',
  demand: false,
  alias: 't'
};
const source_option = {
  describe: 'Tag to be renamed.',
  demand: true,
  alias: 's'
};
const name_option = {
  describe: 'The name to give to the tag.',
  demand: false,
  alias: 'n'
};
const pattern_option = {
  describe: 'A pattern to be replaced in the tag.',
  demand: false,
  alias: 'p'
};
const replacement_option = {
  describe: 'The string with which to replace the pattern.',
  demand: false,
  default: '',
  alias: 'r'
};
const check_option = {
  describe: 'Use this flag to perform a test run without actually executing changes.',
  alias: 'c',
  default: false
};
const verbose_option = {
  describe: 'Output process details.',
  alias: 'v',
  default: false
};

const argv = yargs
  .command('rename', 'Rename a source label', {
    target: target_option,
    source: source_option,
    name: name_option,
    pattern: pattern_option,
    replacement: replacement_option,
    check: check_option,
    verbose: verbose_option
  })
  .help()
  .argv;
var command = process.argv[2];

const renameTag = (auth, target_id, source_id, name, pattern, replacement) => {
  fetchSingleLabel(auth, source_id)
    .then(source_label => {
      if (argv.verbose) {
        console.log(`Fetched source label ${source_label.id}: ${source_label.name}:`);
        console.log(JSON.stringify(source_label, undefined, 2));
      }
      return source_label;
    })
    .then(source_label => {
      if (name) {
        if (pattern) {
          name = _.replace(name, pattern, pattern);
        }
        console.log(`Renaming tag ${source_label.name} to ${name}.`);
        if (!argv.check) {
          source_label.name = name;
          updateLabel(auth, source_label)
            .catch(err => console.log(err));
        }
      }
      else if (target_id) {
        fetchSingleLabel(auth, target_id)
        .then(target_label => {
          if (argv.verbose) {
            console.log(`Fetched target label ${target_label.id}: ${target_label.name}:`);
            console.log(JSON.stringify(target_label, undefined, 2));
          }
          if (pattern) {
            target_label.name = _.replace(target_label.name, pattern, pattern);
          }
          console.log(`The label will be renamed from ${source_label.name} to ${target_label.name}.`);
          console.log("The original target label will also be deleted after the renaming occurs.");
          if (!argv.check) {
            deleteLabel(auth, target_label)
              .catch(err => console.log(err));
          }
          target_label.id = source_label.id;
          if (!argv.check) {
            updateLabel(auth, target_label)
              .catch(err => console.log(err));
          }
          return target_label;
          }).catch(err => console.log(err)); // Catches failure to fetch target label
      } else if (pattern) {
        replacement_name = _.replace(source_label.name, pattern, replacement);
        console.log(`The label will be renamed from ${source_label.name} to ${replacement_name}.`);
        source_label.name = replacement_name;
        if (!argv.check) {
          updateLabel(auth, source_label)
            .catch(err => console.log(err));
        }
      } else {
        console.log ('No changes have been specified.');
      }
    })
    .catch(err => console.log(err)); // Catches failure to fetch source label.
};

const fetchSingleLabel = (auth, id) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      id: id
    };
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.labels.get(args, (err, res) => {
      if (err) reject(`Failed to fetch label '${id}' with error code ${err.response.status}: ${err.response.statusText}`);
      resolve(res.data);
    });
  })
};

const updateLabel = (auth, label) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      id: label.id,
      resource: {
        id: label.id,
        labelListVisibility: label.labelListVisibility,
        messageListVisibility: label.messageListVisibility,
        name: label.name
      }
    };
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.labels.update(args, (err, res) => {
      console.log(JSON.stringify(res.data, undefined, 2));
      if (err) reject(`Failed to update label '${label.id}' with error code ${err.response.status}: ${err.response.statusText}`);
      resolve(res.data);
    });
  })
};

const deleteLabel = (auth, label) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      id: label.id
    };
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.labels.delete(args, (err, res) => {
      if (err) reject(`Failed to delete label '${label.id}' with error code ${err.response.status}: ${err.response.statusText}`);
      resolve(res.data);
    });
  })
};

if (command == 'rename') {
  console.log(`Modifying the source label (id ${argv.source}) with a new name.`);
  const client = authorize.client()
    .then(auth => renameTag(auth, argv.target, argv.source, argv.name, argv.pattern, argv.replacement))
    .catch(err => console.log(err));
}
