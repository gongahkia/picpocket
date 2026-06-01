const WebSocket = require("ws");

const MESSAGE_TYPES = {
  AWAITING: "awaiting",
  DISCONNECTED: "disconnected",
  FRAME: "frame",
};

function attachWebSocketServer({ config, logger, server, sessions }) {
  const wss = new WebSocket.Server({
    maxPayload: config.wsMaxPayloadBytes,
    server,
  });

  wss.on("connection", (ws, req) => {
    const { role, sessionId } = parseRequest(req);

    if (!sessions.isValidSessionId(sessionId)) {
      closeWithPolicy(ws, "Invalid session ID");
      return;
    }

    const session = sessions.getSession(sessionId);
    if (!session) {
      closeWithPolicy(ws, "Session not found");
      return;
    }

    if (role === "presenter") {
      if (!connectPresenter({ logger, session, sessionId, ws })) return;
    } else if (role === "audience") {
      if (!connectAudience({ config, logger, session, sessionId, ws })) return;
    } else {
      closeWithPolicy(ws, "Unknown WebSocket role");
      return;
    }

    ws.on("message", (rawMessage) => {
      if (ws !== session.presenterWs) return;

      const message = parsePresenterMessage(rawMessage);
      if (!message) {
        closeWithPolicy(ws, "Invalid presenter message");
        return;
      }

      if (message.type === MESSAGE_TYPES.FRAME) {
        session.latestFrame = message;
      }

      if (message.type === MESSAGE_TYPES.AWAITING) {
        session.latestFrame = null;
      }

      broadcast(session.audienceWs, message);
    });

    ws.on("close", () => {
      if (ws === session.presenterWs) {
        logger.info(`Presenter disconnected from session: ${sessionId}`);
        session.presenterWs = null;
        broadcast(session.audienceWs, {
          message: "Presenter disconnected. Presentation ended.",
          type: MESSAGE_TYPES.DISCONNECTED,
        });
        closeAudienceConnections(session.audienceWs);
        sessions.deleteSession(sessionId);
        return;
      }

      if (session.audienceWs.has(ws)) {
        session.audienceWs.delete(ws);
        logger.debug(`Audience disconnected from session: ${sessionId}`);

        if (!session.presenterWs && session.audienceWs.size === 0) {
          sessions.deleteSession(sessionId);
        }
      }
    });

    ws.on("error", (error) => {
      logger.warn(`WebSocket error for ${role}/${sessionId}: ${error.message}`);
    });
  });

  return wss;
}

function broadcast(audienceWs, message) {
  const payload = JSON.stringify(message);

  audienceWs.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  });
}

function closeAudienceConnections(audienceWs) {
  audienceWs.forEach((client) => {
    if (
      client.readyState === WebSocket.OPEN ||
      client.readyState === WebSocket.CONNECTING
    ) {
      client.close(1000, "Presentation ended");
    }
  });
  audienceWs.clear();
}

function closeWithPolicy(ws, reason) {
  ws.close(1008, reason);
}

function connectAudience({ config, logger, session, sessionId, ws }) {
  if (session.audienceWs.size >= config.maxAudiencePerSession) {
    closeWithPolicy(ws, "Audience limit reached");
    return false;
  }

  session.audienceWs.add(ws);
  logger.info(
    `Audience connected to session: ${sessionId}. Total audience: ${session.audienceWs.size}`,
  );

  if (session.latestFrame && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(session.latestFrame));
  }

  return true;
}

function connectPresenter({ logger, session, sessionId, ws }) {
  if (
    session.presenterWs &&
    session.presenterWs.readyState === WebSocket.OPEN
  ) {
    closeWithPolicy(ws, "Presenter already connected");
    return false;
  }

  session.presenterWs = ws;
  logger.info(`Presenter connected to session: ${sessionId}`);
  return true;
}

function isImageDataUrl(value) {
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpeg|jpg|webp);base64,/.test(value)
  );
}

function parsePresenterMessage(rawMessage) {
  let message;

  try {
    message = JSON.parse(rawMessage.toString("utf8"));
  } catch {
    return null;
  }

  if (!message || typeof message !== "object") return null;

  if (message.type === MESSAGE_TYPES.AWAITING) {
    return { type: MESSAGE_TYPES.AWAITING };
  }

  if (
    message.type === MESSAGE_TYPES.FRAME &&
    isImageDataUrl(message.imageData)
  ) {
    return {
      imageData: message.imageData,
      sentAt: Number.isFinite(message.sentAt) ? message.sentAt : Date.now(),
      type: MESSAGE_TYPES.FRAME,
    };
  }

  return null;
}

function parseRequest(req) {
  const url = new URL(req.url, "http://localhost");
  const [, wsPrefix, role] = url.pathname.split("/");

  return {
    role: wsPrefix === "ws" ? role : null,
    sessionId: url.searchParams.get("id") || "",
  };
}

module.exports = { MESSAGE_TYPES, attachWebSocketServer };
