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

// Get a list of from addresses that are already being filtered.
const filteredFroms = (auth) => {
  return fetchFilters(auth)
    .then(filters => {
      return _.map(filters, filter => filter.criteria.from);
  });
}

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
}

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
}

if (command == 'show') {
  console.log(`Showing matching filters.`);
  const client = authorize.client()
    .then(auth => fetchMatchingFilters(auth, argv.to, argv.from, argv.subject, argv.query, argv.add))
    .then(filters => console.log(JSON.stringify(filters, undefined, 2)))
    .catch(err => console.log(err));
}
else if (command == 'remove') {
  console.log(`Remove filter(s).`);
  const client = authorize.client()
    .then(auth => {
      fetchMatchingFilters(auth, argv.to, argv.from, argv.subject, argv.query, argv.add)
      .then(filters => {
        var n = 1;
        _.each(filters, filter => {
          _.delay(function(filter) {
            if (!argv.check) {
              if (argv.verbose) {
                console.log('Deleting filter:');
                console.log(JSON.stringify(filter, undefined, 2));
              }
              deleteFilter(auth, filter).catch(err => console.log(err));
            }
          }, 1000 * n, filter);
          n += 1;
        });
      }).catch(err => console.log(err));
    }).catch(err => console.log(err));
}
else if (command == 'process') {
  console.log(`Process a file of filters.`);
  const client = authorize.client()
    .then(auth => {
      filteredFroms(auth)
      .then(froms => {
        var rows = unprocessedFilterList(argv.file, froms);
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
   }).catch(err => console.log(err)); // Catches from auth
}
else if (command == 'froms') {
  console.log(`Show from addresses currently being filtered.`);
  const client = authorize.client()
    .then(auth => filteredFroms(auth))
    .then(froms => {
      _.each(froms, from => {
        console.log(from);
      });
      var rows = readFilterList('rules.txt');
      return _.filter(rows, row => !_.includes(froms, row.from));
    })
    .then(rows => console.log(JSON.stringify(rows, undefined, 2)))
    .catch(err => console.log(err));
}

