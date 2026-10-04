const createApp = require('./src/app');
const { seed } = require('./src/db');

seed();
const app = createApp();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Newtonite app listening on http://localhost:${port}`);
  });
}

module.exports = app;
