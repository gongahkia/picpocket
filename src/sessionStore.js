const crypto = require("crypto");
const { colors, uniqueNamesGenerator } = require("unique-names-generator");

const customWords = require("../words");

const SESSION_ID_PATTERN = /^[a-z]+-[a-z]+$/;
const PRESENTER_TOKEN_BYTES = 32;
const PRESENTER_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function createSessionStore({
  now = () => Date.now(),
  randomBytes = crypto.randomBytes,
} = {}) {
  const sessions = new Map();

  function createSession(ttlMs) {
    let sessionId;
    let attempts = 0;

    do {
      sessionId = uniqueNamesGenerator({
        dictionaries: [colors, customWords],
        length: 2,
        separator: "-",
        style: "lowerCase",
      });
      attempts += 1;
    } while (sessions.has(sessionId) && attempts < 100);

    if (sessions.has(sessionId)) {
      throw new Error("Unable to create a unique session ID");
    }

    const session = {
      audienceWs: new Set(),
      createdAt: now(),
      expiresAt: ttlMs ? now() + ttlMs : null,
      latestFrame: null,
      presenterToken: createPresenterToken(randomBytes),
      presenterWs: null,
      sessionId,
    };

    sessions.set(sessionId, session);
    return session;
  }

  function deleteSession(sessionId) {
    sessions.delete(sessionId);
  }

  function getSession(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) return null;

    if (session.expiresAt && now() > session.expiresAt) {
      sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  function hasSession(sessionId) {
    return Boolean(getSession(sessionId));
  }

  function isValidSessionId(sessionId) {
    return typeof sessionId === "string" && SESSION_ID_PATTERN.test(sessionId);
  }

  function isValidPresenterToken(presenterToken) {
    return (
      typeof presenterToken === "string" &&
      PRESENTER_TOKEN_PATTERN.test(presenterToken)
    );
  }

  function verifyPresenterToken(session, presenterToken) {
    if (!session || !isValidPresenterToken(presenterToken)) return false;

    const expected = Buffer.from(session.presenterToken);
    const actual = Buffer.from(presenterToken);

    return (
      expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
    );
  }

  return {
    createSession,
    deleteSession,
    getSession,
    hasSession,
    isValidPresenterToken,
    isValidSessionId,
    verifyPresenterToken,
  };
}

function createPresenterToken(randomBytes) {
  return randomBytes(PRESENTER_TOKEN_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

module.exports = {
  PRESENTER_TOKEN_PATTERN,
  SESSION_ID_PATTERN,
  createSessionStore,
};
