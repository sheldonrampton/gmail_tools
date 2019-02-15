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
  describe: 'Filters to add.',
  demand: false,
  default: '',
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
    check: check_option,
    verbose: verbose_option
  })
  .command('show', 'Show a list of filters', {
    to: to_option,
    from: from_option,
    subject: subject_option,
    query: query_option,
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

const fetchMatchingFilters = (auth, to, from, subject, query) => {
  return fetchFilters(auth)
    .then(filters => {
      if (to) {
        filters = _.filter(filters, filter => filter.criteria.to == to);
      }
      if (from) {
        filters = _.filter(filters, filter => filter.criteria.from == from);
      }
      if (subject) {
        filters = _.filter(filters, filter => filter.criteria.subject == subject);
      }
      if (query) {
        filters = _.filter(filters, filter => filter.criteria.query == query);
      }
      return filters;
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

if (command == 'show') {
  console.log(`Showing matching filters.`);
  const client = authorize.client()
    .then(auth => fetchMatchingFilters(auth, argv.to, argv.from, argv.subject, argv.query))
    .then(filters => console.log(JSON.stringify(filters, undefined, 2)))
    .catch(err => console.log(err));
}
else if (command == 'apply') {
  console.log(`Apply matching filters.`);
  const client = authorize.client()
    .then(auth => fetchMatchingFilters(auth, argv.to, argv.from, argv.subject, argv.query))
    .then(filters => console.log(JSON.stringify(filters, undefined, 2)))
    .catch(err => console.log(err));
}
else if (command == 'remove') {
  console.log(`Remove filters.`);
  const client = authorize.client()
    .then(auth => {
      fetchMatchingFilters(auth, argv.to, argv.from, argv.subject, argv.query)
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
  var rows = readFilterList(argv.file);
  const client = authorize.client()
    .then(auth => {
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
        }, 5000 * n, row);
        n += 1;
      });
    }).catch(err => console.log(err));
}
else if (command == 'process2') {
  console.log(`Process a file of filters.`);
  var rows = readFilterList(argv.file);
  const client = authorize.client()
    .then(auth => {
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
        }, 5000 * n, row);
        n += 1;
      });
    }).catch(err => console.log(err));
}
else if (command == 'froms') {
  console.log(`Show the from addresses currently being filtered.`);
  const client = authorize.client()
    .then(auth => filteredFroms(auth))
    .then(froms => {
      _.each(froms, from => {
        console.log(from);
      })
    }).catch(err => console.log(err));
}
