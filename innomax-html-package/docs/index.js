const basicInfo = require('./basicinfo');
const servers = require('./server');
const tags = require('./tags');
const components = require('./components');
const authPaths = require('./paths/auth');
const coursePaths = require('./paths/course');
const rdvPaths = require('./paths/rdv');

module.exports = {
  ...basicInfo,
  ...servers,
  ...tags,
  ...components,
  paths: {
    ...authPaths,
    ...coursePaths,
    ...rdvPaths
  }
};