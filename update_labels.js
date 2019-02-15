const yargs = require('yargs');
const { google } = require("googleapis");
const Promise = require("bluebird");
const authorize = require('./authorize');
const _ = require('lodash');

const to_option = {
  describe: 'Tag whose name will be used.',
  demand: false,
  alias: 't'
};
const from_option = {
  describe: 'Tag to be renamed.',
  demand: true,
  alias: 'f'
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
  .command('rename', 'Rename a label', {
    to: to_option,
    from: from_option,
    name: name_option,
    pattern: pattern_option,
    replacement: replacement_option,
    check: check_option,
    verbose: verbose_option
  })
  .command('bulk_rename', 'Rename a group of labels that match a pattern', {
    pattern: pattern_option,
    replacement: replacement_option,
    check: check_option,
    verbose: verbose_option
  })
  .command('bulk_delete', 'Delete a group of labels that match a pattern', {
    pattern: pattern_option,
    check: check_option,
    verbose: verbose_option
  })
  .command('show', 'Show a list of labels', {
    pattern: pattern_option,
    name: name_option,
    verbose: verbose_option
  })
  .help()
  .argv;
var command = process.argv[2];

const renameTag = (auth, to_id, from_id, name, pattern, replacement) => {
  fetchSingleLabel(auth, from_id)
    .then(from_label => {
      if (argv.verbose) {
        console.log(`Fetched from label ${from_label.id}: ${from_label.name}:`);
        console.log(JSON.stringify(from_label, undefined, 2));
      }
      return from_label;
    })
    .then(from_label => {
      if (name) {
        if (pattern) {
          name = _.replace(name, pattern, pattern);
        }
        console.log(`Renaming tag ${from_label.name} to ${name}.`);
        if (!argv.check) {
          from_label.name = name;
          updateLabel(auth, from_label)
            .catch(err => console.log(err));
        }
      }
      else if (to_id) {
        fetchSingleLabel(auth, to_id)
        .then(to_label => {
          if (argv.verbose) {
            console.log(`Fetched to label ${to_label.id}: ${to_label.name}:`);
            console.log(JSON.stringify(to_label, undefined, 2));
          }
          if (pattern) {
            to_label.name = _.replace(to_label.name, pattern, pattern);
          }
          console.log(`The label will be renamed from ${from_label.name} to ${to_label.name}.`);
          console.log("The original label with that name will be deleted after the renaming occurs.");
          if (!argv.check) {
            deleteLabel(auth, to_label)
              .then(() => {
                to_label.id = from_label.id;
                updateLabel(auth, to_label)
              }).catch(err => console.log(err));
          }
          return to_label;
        }).catch(err => console.log(err)); // Catches failure to fetch to label
      } else if (pattern) {
        replacement_name = _.replace(from_label.name, pattern, replacement);
        console.log(`The label will be renamed from ${from_label.name} to ${replacement_name}.`);
        from_label.name = replacement_name;
        if (!argv.check) {
          updateLabel(auth, from_label)
            .catch(err => console.log(err));
        }
      } else {
        console.log ('No changes have been specified.');
      }
    })
    .catch(err => console.log(err)); // Catches failure to fetch from label.
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

const fetchMatchingLabels = (auth, pattern) => {
  return fetchLabels(auth)
    .then(labels => {
      return _.filter(labels, label => _.includes(label.name, pattern));
  });
};

const fetchLabelsNamed = (auth, name) => {
  return fetchLabels(auth)
    .then(labels => {
      return _.filter(labels, ['name', name]);
  });
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
    if (argv.verbose) {
      console.log(`Deleting label id ${label.id}: ${label.name}.`);
    }
    if (!argv.check) {
      gmail.users.labels.delete(args, (err, res) => {
        if (err) reject(`Failed to delete label '${label.id}' with error code ${err.response.status}: ${err.response.statusText}`);
        resolve(res.data);
      });
    } else {
      resolve();
    }
  })
};

const waitCall = (auth, label, pattern, replacement) => {
  const timeout = 1000;
  return Promise.resolve(renameTag(auth, undefined, label.id, undefined, pattern, replacement))
};

const sleep = (millis) => {
    return new Promise(resolve => setTimeout(resolve, millis));
}

if (command == 'rename') {
  console.log(`Modifying label (id ${argv.from}) with a new name.`);
  const client = authorize.client()
    .then(auth => renameTag(auth, argv.to, argv.from, argv.name, argv.pattern, argv.replacement))
    .catch(err => console.log(err));
} else if (command == 'show') {
  console.log(`Showing matching labels.`);
  const client = authorize.client()
    .then(auth => {
      if (argv.name) {
        return fetchLabelsNamed(auth, argv.name);
      }
      else {
        return fetchMatchingLabels(auth, argv.pattern);
      }
    })
    .then(labels => {
      // console.log(JSON.stringify(labels, undefined, 2))
      var n = 1;
      _.each(labels, label => {
        _.delay(function(label) {
         console.log(JSON.stringify(label, undefined, 2))
         }, 100 * n, label);
        n += 1;
      });
    }).catch(err => console.log(err));
} else if (command == 'bulk_rename' ) {
  console.log(`Renaming matching labels.`);
  const client = authorize.client()
    .then(auth => {
      fetchMatchingLabels(auth, argv.pattern)
        .then(labels => {
          var n = 1;
          _.each(labels, label => {
            _.delay(function(label) {
              renameTag(auth, undefined, label.id, undefined, argv.pattern, argv.replacement);
            }, 1000 * n, label);
            n += 1;
        });
      }).catch(err => console.log(err))
    }).catch(err => console.log(err));
} else if (command == 'bulk_delete' ) {
  console.log(`Deleting matching labels.`);
  const client = authorize.client()
    .then(auth => fetchMatchingLabels(auth, argv.pattern))
    .then(labels => {
      const client = authorize.client().then(auth => {
        _.each(labels, label => {
          deleteLabel(auth, label);
        });
      }).catch(err => console.log(err));
    }).catch(err => console.log(err));
}

module.exports = {
  fetchMatchingLabels,
  fetchLabelsNamed
};
