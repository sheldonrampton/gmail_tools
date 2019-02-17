const yargs = require('yargs');
const { google } = require("googleapis");
const Promise = require("bluebird");
const authorize = require('./authorize');
const labelFetcher = require('./update_labels');
const _ = require('lodash');
const fs = require("fs");

const id_option = {
  describe: 'ID criterion for the filter.',
  demand: false,
  alias: 'i'
};
const to_option = {
  describe: 'To address criterion for the filter.',
  demand: false,
  alias: 't'
};
const from_option = {
  describe: 'From address criterion for the filter.',
  demand: false,
  alias: 'f'
};
const subject_option = {
  describe: 'Email subject criterion for the filter.',
  demand: false,
  alias: 's'
};
const query_option = {
  describe: 'Query criterion for the filter.',
  demand: false,
  alias: 'q'
};
const add_options = {
  describe: 'Labels to add.',
  demand: false,
  type: 'array',
  default: [],
  alias: 'a'
};
const remove_options = {
  describe: 'Filters to remove.',
  demand: false,
  default: '',
  alias: 'r'
};
const file_option = {
  describe: 'File to process.',
  demand: true,
  default: '',
  alias: 'l'
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
  .command('add', 'Add a filter', {
    to: to_option,
    from: from_option,
    subject: subject_option,
    query: query_option,
    add: add_options,
    remove: remove_options,
    check: check_option,
    verbose: verbose_option
  })
  .command('remove', 'Remove a filter', {
    to: to_option,
    from: from_option,
    subject: subject_option,
    query: query_option,
    add: add_options,
    remove: remove_options,
    check: check_option,
    verbose: verbose_option
  })
  .command('show', 'Show a list of filters', {
    to: to_option,
    from: from_option,
    subject: subject_option,
    query: query_option,
    add: add_options,
    remove: remove_options,
    check: check_option,
    verbose: verbose_option
  })
  .command('apply', 'Apply a filter', {
    id: id_option,
    check: check_option,
    verbose: verbose_option
  })
  .command('process', 'Process a list of filters', {
    file: file_option,
    check: check_option,
    verbose: verbose_option
  })
  .command('froms', 'Show a list of from addresses already being filtered', {
    verbose: verbose_option
  })
  .help()
  .argv;
var command = process.argv[2];

const fetchFilters = (auth) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
    };

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.settings.filters.list(args, (err, res) => {
      if (err) return reject(err);
      return resolve(res.data.filter);
    });
  });
};

const getFilter = (auth, id) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      id: id
    };

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.settings.filters.get(args, (err, res) => {
      if (err) return reject(err);
      return resolve(res.data);
    });
  });
};

// Feturns a list of filters that match specified criteria.
// NOTE: For the sake of sanity, the array of filters are called "items"
// in this function. This is to avoid confusion caused by the linguistic
// similarity between filters (the objects defined by the Gmail API)
// and the lodash _.filter() function.
const fetchMatchingFilters = (auth, to, from, subject, query, add_label_ids) => {
  return fetchFilters(auth)
    .then(items => {
      if (to) {
        items = _.filter(items, item => item.criteria.to == to);
      }
      if (from) {
        items = _.filter(items, item => item.criteria.from == from);
      }
      if (subject) {
        items = _.filter(items, item => item.criteria.subject == subject);
      }
      if (query) {
        items = _.filter(items, item => item.criteria.query == query);
      }
      if (_.size(add_label_ids)) {
        items = _.reject(
          items,
          item => _.every(add_label_ids, label => !_.includes(item.action.addLabelIds, label))
        );
      }
      return items;
  });
};

const fetchMatchingMessages = (auth, from) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      q: `from:${from} label:inbox`
    };

    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.list(args, (err, res) => {
      if (err) return reject(err);
      if (res.data.resultSizeEstimate) {
        return resolve(res.data.messages);
      }
      else {
        return resolve([]);
      }
    });
  });
};

const updateMessages = (auth, message_ids, filter) => {
  return new Promise((resolve, reject) => {
    if (!_.size(message_ids)) {
      return resolve([]);
    }
    let args = {
      userId: "me",
      resource: {
        ids: message_ids,
        addLabelIds: filter.action.addLabelIds,
        removeLabelIds: filter.action.removeLabelIds
      }
    };
    const gmail = google.gmail({ version: "v1", auth });
    gmail.users.messages.batchModify(args, (err, res) => {
      if (err) return reject(err);
      return resolve(res.data);
    });
  });
}

// Get a list of from addresses that are already being filtered.
const filteredFroms = (auth) => {
  return fetchFilters(auth)
    .then(filters => {
      return _.map(filters, filter => filter.criteria.from);
  });
};

const deleteFilter = (auth, filter) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      id: filter.id
    };
    const gmail = google.gmail({ version: "v1", auth });
    if (argv.verbose) {
      console.log(`Deleting filter id ${filter.id}.`);
    }
    if (!argv.check) {
      gmail.users.settings.filters.delete(args, (err, res) => {
        if (err) reject(`Failed to delete filter '${filter.id}' with error code ${err.response.status}: ${err.response.statusText}`);
        resolve(res.data);
      });
    } else {
      resolve();
    }
  })
};

const defineFilter = (criteria, add_label_ids, remove_label_ids) => {
  return {
    criteria: criteria,
    action: {
      addLabelIds: add_label_ids,
      removeLabelIds: remove_label_ids
    }
  };
};


// Defines a filter with a single from address for criteria
// and a single label ID to use for tagging emails from that
// email address. The filter also removes emails from the inbox.
const simpleDefineFilter = (from, add_label_id) => {
  return {
    criteria: {
      from: from
    },
    action: {
      addLabelIds: [
        add_label_id
      ],
      removeLabelIds: [
        "INBOX"
      ]
    }
  };
};

const createFilter = (auth, filter) => {
  return new Promise((resolve, reject) => {
    let args = {
      userId: "me",
      resource: filter
    };
    const gmail = google.gmail({ version: "v1", auth });
    if (argv.verbose) {
      console.log(`Creating filter for emails from ${filter.criteria.from}.`);
    }
    if (!argv.check) {
      gmail.users.settings.filters.create(args, (err, res) => {
        if (err) reject(`Failed to create filter with error code ${err.response.status}: ${err.response.statusText}`);
        resolve(res.data);
      });
    } else {
      resolve();
    }
  })
};

const readFilterList = (filename) => {
  var array = fs.readFileSync(filename).toString().split("\n");
  return _.map(array, row => {
    var items = row.split("\t");
    return {
      from: items[0],
      lc_name: items[1],
      name: items[2]
    };
  });
};

const unprocessedFilterList = (filename, froms) => {
  rows = readFilterList(filename);
  unprocessed_rows = _.filter(
    rows,
    row => !_.includes(froms, row.from)
  );

  processed_rows = _.filter(
    rows,
    row => _.includes(froms, row.from)
  );

  console.log(`There are ${_.size(froms)} from addresses currently being filtered.`);
  console.log(`There are ${_.size(rows)} from addresses in the file.`);
  console.log(`There are ${_.size(unprocessed_rows)} rows that have not been successfully processed.`);
  console.log(`There are ${_.size(processed_rows)} rows that have been successfully processed.`);

  return unprocessed_rows;
};

const applyFilter = (auth, id) => {
  getFilter(auth, id)
  .then(filter => {
    from = filter.criteria.from;
    console.log(`Applying filter for emails from ${from}...`);
    fetchMatchingMessages(auth, from)
    .then(list => {
      message_ids = _.map(list, item => item.id);
      console.log(JSON.stringify(message_ids, undefined, 2));
      updateMessages(auth, message_ids, filter);
    }).catch(err => console.log(err))
  }).catch(err => console.log(err))
};

const showFroms = (auth) =>
  filteredFroms(auth).then(
    froms => console.log(JSON.stringify(froms, undefined, 2))
  );

const processFile = (auth, filename) => {
  filteredFroms(auth)
  .then(froms => {
    var rows = unprocessedFilterList(filename, froms);
    var n = 1;
    _.each(rows, row => {
      _.delay(function(row) {
        if (row.name) {
          if (argv.verbose) {
            console.log('Data row:');
            console.log(JSON.stringify(row, undefined, 2));
          }
          labelFetcher.fetchLabelsNamed(auth, row.name)
            .then(labels => {
              if (argv.verbose) {
                console.log('Matching label:');
                console.log(JSON.stringify(labels, undefined, 2));
              }
              filter = {
                criteria: {
                  from: row.from
                },
                action: {
                  addLabelIds: [
                    labels[0].id
                  ],
                  removeLabelIds: [
                    "INBOX"
                  ]
                }
              };
              console.log(`Creating filter for emails from ${row.from}...`)
              createFilter(auth, filter).catch(err => console.log(err));
            })
            .catch(err => console.log(err));
        }
      }, 10000 * n, row);
      n += 1;
    });
  }).catch(err => console.log(err)); // Catches from unfilteredFroms
}

const removeFilters = (auth, to, from, subject, query, add) => {
  fetchMatchingFilters(auth, to, from, subject, query, add)
  .then(filters => {
    var n = 1;
    _.each(filters, filter => {
      _.delay(function(filter) {
        if (argv.verbose) {
          console.log('Deleting filter:');
          console.log(JSON.stringify(filter, undefined, 2));
        }
        if (!argv.check) {
          deleteFilter(auth, filter).catch(err => console.log(err));
        }
      }, 1000 * n, filter);
      n += 1;
    });
  }).catch(err => console.log(err));
}

const showMatchingFilters = (auth, to, from, subject, query, add) => {
  fetchMatchingFilters(auth, to, from, subject, query, add)
    .then(filters => console.log(JSON.stringify(filters, undefined, 2)));
}

if (command == 'show') {
  authorize.performCommand(
    showMatchingFilters,
    'Showing matching filters.',
    argv.to, argv.from, argv.subject, argv.query, argv.add
  );
}
else if (command == 'remove') {
  authorize.performCommand(
    removeFilters,
    'Remove filter(s).',
    argv.to, argv.from, argv.subject, argv.query, argv.add
  );
}
else if (command == 'process') {
  authorize.performCommand(
    processFile,
    'Process a file of filters.',
    argv.file
  );
}
else if (command == 'froms') {
  authorize.performCommand(
    showFroms,
    'Apply a single filter to emails currently in the inbox.'
  );
}
else if (command == 'apply') {
  authorize.performCommand(
    applyFilter,
    'Apply a single filter to emails currently in the inbox.',
    argv.id
  );
}

