const express = require("express");
const path = require("path");
const QRCode = require("qrcode");

const { compressToPng } = require("./imageService");

const NO_STORE = "no-store, max-age=0";
const SECURITY_HEADERS = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "connect-src 'self' ws: wss:",
    "font-src 'self'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "object-src 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
  ].join("; "),
  "Permissions-Policy":
    "camera=(), display-capture=(self), geolocation=(), microphone=(), payment=(), usb=()",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function createApp({ config, logger, sessions }) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use((req, res, next) => {
    for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(header, value);
    }

    if (shouldSkipCache(req.path)) {
      res.setHeader("Cache-Control", NO_STORE);
    }

    next();
  });

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(
    express.static(path.join(__dirname, "..", "public"), {
      setHeaders(res, filePath) {
        if (path.basename(filePath) === "presenter.html") {
          res.setHeader("Cache-Control", NO_STORE);
        }
      },
    }),
  );

  app.post(
    "/api/save-image",
    createRateLimiter({
      max: config.saveRateLimitMax,
      windowMs: config.rateLimitWindowMs,
    }),
    async (req, res) => {
      try {
        const compressed = await compressToPng(req.body && req.body.imageData);
        const filename = `picpocket-${Date.now()}.png`;

        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`,
        );
        res.setHeader("Cache-Control", NO_STORE);
        res.setHeader("Content-Type", "image/png");
        res.send(compressed);
      } catch (error) {
        const message =
          error.message === "Missing image data"
            ? error.message
            : "Invalid image data";
        res.status(400).send(message);
      }
    },
  );

  app.get(
    "/api/qrcode",
    createRateLimiter({
      max: config.qrRateLimitMax,
      windowMs: config.rateLimitWindowMs,
    }),
    async (req, res) => {
      const data = typeof req.query.data === "string" ? req.query.data : "";

      if (!data || data.length > 2048) {
        res.status(400).send("Missing or invalid QR data");
        return;
      }

      try {
        const svg = await QRCode.toString(data, {
          errorCorrectionLevel: "H",
          margin: 1,
          type: "svg",
          width: 180,
        });

        res.setHeader("Cache-Control", NO_STORE);
        res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
        res.send(svg);
      } catch (error) {
        logger.error("Failed to generate QR code", error);
        res.status(500).send("QR generation failed");
      }
    },
  );

  app.get("/presenter", (req, res) => {
    const session = sessions.createSession(config.sessionTtlMs);
    logger.info(`New session created: ${session.sessionId}`);
    const params = new URLSearchParams({
      id: session.sessionId,
      token: session.presenterToken,
    });

    res.redirect(`/presenter.html?${params.toString()}`);
  });

  app.get("/join/:sessionId", (req, res) => {
    const { sessionId } = req.params;

    if (
      !sessions.isValidSessionId(sessionId) ||
      !sessions.hasSession(sessionId)
    ) {
      res.status(404).send("Presentation session not found or invalid ID.");
      return;
    }

    res.sendFile(path.join(__dirname, "..", "public", "audience.html"));
  });

  app.get("/healthz", (req, res) => {
    res.type("text/plain").send("ok");
  });

  app.use((error, req, res, next) => {
    if (error && error.type === "entity.too.large") {
      res.status(413).send("Payload too large");
      return;
    }

    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).send("Invalid JSON");
      return;
    }

    next(error);
  });

  return app;
}

function createRateLimiter({ max, now = Date.now, windowMs }) {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const currentTime = now();
    const bucket = buckets.get(key);

    if (!bucket || currentTime >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs });
      next();
      return;
    }

    if (bucket.count >= max) {
      res.setHeader(
        "Retry-After",
        String(Math.ceil((bucket.resetAt - currentTime) / 1000)),
      );
      res.status(429).send("Too many requests");
      return;
    }

    bucket.count += 1;
    next();
  };
}

function shouldSkipCache(requestPath) {
  return (
    requestPath === "/presenter" ||
    requestPath === "/presenter.html" ||
    requestPath.startsWith("/join/") ||
    requestPath.startsWith("/api/qrcode") ||
    requestPath.startsWith("/api/save-image")
  );
}

module.exports = { createApp };
