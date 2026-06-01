const express = require('express');
const path = require('path');
const QRCode = require('qrcode');

const { compressToPng } = require('./imageService');

function createApp({ config, logger, sessions }) {
  const app = express();

  app.disable('x-powered-by');

  app.use((req, res, next) => {
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
  });

  app.use(express.json({ limit: config.jsonBodyLimit }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.post('/api/save-image', async (req, res) => {
    try {
      const compressed = await compressToPng(req.body && req.body.imageData);
      const filename = `picpocket-${Date.now()}.png`;

      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Type', 'image/png');
      res.send(compressed);
    } catch (error) {
      const message = error.message === 'Missing image data' ? error.message : 'Invalid image data';
      res.status(400).send(message);
    }
  });

  app.get('/api/qrcode', async (req, res) => {
    const data = typeof req.query.data === 'string' ? req.query.data : '';

    if (!data || data.length > 2048) {
      res.status(400).send('Missing or invalid QR data');
      return;
    }

    try {
      const svg = await QRCode.toString(data, {
        errorCorrectionLevel: 'H',
        margin: 1,
        type: 'svg',
        width: 180,
      });

      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
      res.send(svg);
    } catch (error) {
      logger.error('Failed to generate QR code', error);
      res.status(500).send('QR generation failed');
    }
  });

  app.get('/presenter', (req, res) => {
    const session = sessions.createSession(config.sessionTtlMs);
    logger.info(`New session created: ${session.sessionId}`);
    res.redirect(`/presenter.html?id=${session.sessionId}`);
  });

  app.get('/join/:sessionId', (req, res) => {
    const { sessionId } = req.params;

    if (!sessions.isValidSessionId(sessionId) || !sessions.hasSession(sessionId)) {
      res.status(404).send('Presentation session not found or invalid ID.');
      return;
    }

    res.sendFile(path.join(__dirname, '..', 'public', 'audience.html'));
  });

  app.get('/healthz', (req, res) => {
    res.type('text/plain').send('ok');
  });

  app.use((error, req, res, next) => {
    if (error && error.type === 'entity.too.large') {
      res.status(413).send('Payload too large');
      return;
    }

    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).send('Invalid JSON');
      return;
    }

    next(error);
  });

  return app;
}

module.exports = { createApp };
