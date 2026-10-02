const YAML = require('yamljs');
const swaggerUi = require('swagger-ui-express');
const swaggerJSDoc = require('swagger-jsdoc');
const path = require('path');

const swaggerYamlPath = path.join(__dirname, 'swagger.yaml');
const options = {
  definition: YAML.load(swaggerYamlPath),
  apis: [
    path.join(__dirname, 'paths/*.js'),
    path.join(__dirname, 'components/*.js')
  ]
};

const specs = swaggerJSDoc(options);

module.exports = (app) => {
  app.use(
    '/api',
    swaggerUi.serve,
    swaggerUi.setup(specs, {
      explorer: true,
      swaggerOptions: {
        validatorUrl: null,
        persistAuthorization: true
      },
      customCss: '.swagger-ui .topbar { display: none }',
      customSiteTitle: 'PBTM website API Docs'
    })
  );
};