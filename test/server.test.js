const assert = require('assert/strict');
const http = require('http');
const test = require('node:test');
const WebSocket = require('ws');

const { createServer } = require('../server');

const SAMPLE_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
const SAMPLE_JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==';

function createSilentLogger() {
  return {
    debug() {},
    error() {},
    info() {},
    warn() {},
  };
}

async function httpRequest(origin, path, options = {}) {
  const url = new URL(path, origin);

  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        headers: options.headers || {},
        method: options.method || 'GET',
      },
      (response) => {
        const chunks = [];

        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          resolve({
            body: Buffer.concat(chunks),
            headers: response.headers,
            statusCode: response.statusCode,
          });
        });
      },
    );

    request.on('error', reject);
    if (options.body) request.write(options.body);
    request.end();
  });
}

async function startTestServer() {
  const instance = createServer({
    env: {
      DEBUG: 'false',
      JSON_BODY_LIMIT: '1mb',
      MAX_AUDIENCE_PER_SESSION: '10',
      PORT: '0',
      SESSION_TTL_MS: '60000',
      WS_MAX_PAYLOAD_BYTES: String(1024 * 1024),
    },
    logger: createSilentLogger(),
  });

  await new Promise((resolve) => {
    instance.server.listen(0, '127.0.0.1', resolve);
  });

  const { port } = instance.server.address();
  return {
    ...instance,
    origin: `http://127.0.0.1:${port}`,
    wsOrigin: `ws://127.0.0.1:${port}`,
  };
}

async function stopTestServer(instance) {
  instance.wss.clients.forEach((client) => {
    client.terminate();
  });

  await new Promise((resolve) => {
    instance.wss.close(resolve);
  });

  await new Promise((resolve) => {
    instance.server.close(resolve);
  });
}

function waitForClose(ws) {
  return new Promise((resolve) => {
    ws.once('close', resolve);
  });
}

function waitForMessage(ws) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 2000);

    ws.once('message', (message) => {
      clearTimeout(timeout);
      resolve(JSON.parse(message.toString('utf8')));
    });
  });
}

function waitForOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
}

test('HTTP routes create and serve presentation sessions', async () => {
  const instance = await startTestServer();
  test.after(() => stopTestServer(instance));

  const health = await httpRequest(instance.origin, '/healthz');
  assert.equal(health.statusCode, 200);
  assert.equal(health.body.toString('utf8'), 'ok');

  const presenter = await httpRequest(instance.origin, '/presenter');
  assert.equal(presenter.statusCode, 302);
  assert.match(presenter.headers.location, /^\/presenter\.html\?id=[a-z]+-[a-z]+$/);

  const sessionId = new URL(`${instance.origin}${presenter.headers.location}`).searchParams.get('id');
  const join = await httpRequest(instance.origin, `/join/${sessionId}`);
  assert.equal(join.statusCode, 200);
  assert.match(join.body.toString('utf8'), /PicPocket Audience/);

  const missingJoin = await httpRequest(instance.origin, '/join/not-a-session');
  assert.equal(missingJoin.statusCode, 404);
});

test('image save endpoint validates and returns compressed PNG', async () => {
  const instance = await startTestServer();
  test.after(() => stopTestServer(instance));

  const valid = await httpRequest(instance.origin, '/api/save-image', {
    body: JSON.stringify({ imageData: SAMPLE_PNG }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  assert.equal(valid.statusCode, 200);
  assert.equal(valid.headers['content-type'], 'image/png');
  assert.ok(valid.body.length > 0);

  const invalid = await httpRequest(instance.origin, '/api/save-image', {
    body: JSON.stringify({ imageData: 'not-image-data' }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });

  assert.equal(invalid.statusCode, 400);
});

test('QR endpoint renders an SVG for audience links', async () => {
  const instance = await startTestServer();
  test.after(() => stopTestServer(instance));

  const response = await httpRequest(
    instance.origin,
    `/api/qrcode?data=${encodeURIComponent(`${instance.origin}/join/blue-room`)}`,
  );

  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /image\/svg\+xml/);
  assert.match(response.body.toString('utf8'), /<svg/);
});

test('WebSocket relay broadcasts frames and lifecycle messages', async () => {
  const instance = await startTestServer();
  test.after(() => stopTestServer(instance));

  const presenterResponse = await httpRequest(instance.origin, '/presenter');
  const sessionId = new URL(`${instance.origin}${presenterResponse.headers.location}`).searchParams.get('id');
  const presenter = new WebSocket(`${instance.wsOrigin}/ws/presenter?id=${sessionId}`);
  const audience = new WebSocket(`${instance.wsOrigin}/ws/audience?id=${sessionId}`);

  await Promise.all([waitForOpen(presenter), waitForOpen(audience)]);

  const duplicatePresenter = new WebSocket(`${instance.wsOrigin}/ws/presenter?id=${sessionId}`);
  await waitForClose(duplicatePresenter);

  const frameMessage = waitForMessage(audience);
  presenter.send(
    JSON.stringify({
      imageData: SAMPLE_JPEG,
      sentAt: 123,
      type: 'frame',
    }),
  );

  assert.deepEqual(await frameMessage, {
    imageData: SAMPLE_JPEG,
    sentAt: 123,
    type: 'frame',
  });

  const lateAudience = new WebSocket(`${instance.wsOrigin}/ws/audience?id=${sessionId}`);
  await waitForOpen(lateAudience);
  assert.equal((await waitForMessage(lateAudience)).imageData, SAMPLE_JPEG);

  const awaitingMessage = waitForMessage(audience);
  presenter.send(JSON.stringify({ type: 'awaiting' }));
  assert.deepEqual(await awaitingMessage, { type: 'awaiting' });

  const disconnectedMessage = waitForMessage(audience);
  presenter.close();
  assert.equal((await disconnectedMessage).type, 'disconnected');

  audience.close();
  lateAudience.close();
});
