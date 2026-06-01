const http = require("http");

const { createApp } = require("./src/app");
const { loadConfig } = require("./src/config");
const { createLogger } = require("./src/logger");
const { createSessionStore } = require("./src/sessionStore");
const { attachWebSocketServer } = require("./src/websocket");

function createServer(options = {}) {
  const config = loadConfig(options.env || process.env);
  const logger = options.logger || createLogger({ debug: config.debug });
  const sessions = options.sessions || createSessionStore();
  const app = createApp({ config, logger, sessions });
  const server = http.createServer(app);
  const wss = attachWebSocketServer({ config, logger, server, sessions });

  return { app, config, logger, server, sessions, wss };
}

if (require.main === module) {
  const { config, logger, server } = createServer();

  server.listen(config.port, () => {
    logger.info(`Server running on port ${config.port}`);
    logger.info(
      `To start a presentation, open: http://localhost:${config.port}/presenter`,
    );
  });
}

module.exports = { createServer };
