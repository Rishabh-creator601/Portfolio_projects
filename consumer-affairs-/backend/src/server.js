const { connectDB } = require('./config/db');
const { PORT, NODE_ENV, CORS_ORIGINS } = require('./config/env');
const createApp = require('./app');

const app = createApp();

connectDB();

const server = app.listen(PORT, () => {
  console.log(`Server running in ${NODE_ENV} mode on port ${PORT}`);
  console.log(`Accepting browser requests from: ${CORS_ORIGINS.join(', ')}`);
});

const shutdown = (signal) => {
  console.log(`${signal} received, closing server...`);
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (err) => {
  console.error(`Unhandled rejection: ${err && err.message}`);
  server.close(() => process.exit(1));
});

module.exports = server;
