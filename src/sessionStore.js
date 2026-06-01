const { colors, uniqueNamesGenerator } = require('unique-names-generator');

const customWords = require('../words');

const SESSION_ID_PATTERN = /^[a-z]+-[a-z]+$/;

function createSessionStore({ now = () => Date.now() } = {}) {
  const sessions = new Map();

  function createSession(ttlMs) {
    let sessionId;
    let attempts = 0;

    do {
      sessionId = uniqueNamesGenerator({
        dictionaries: [colors, customWords],
        length: 2,
        separator: '-',
        style: 'lowerCase',
      });
      attempts += 1;
    } while (sessions.has(sessionId) && attempts < 100);

    if (sessions.has(sessionId)) {
      throw new Error('Unable to create a unique session ID');
    }

    const session = {
      audienceWs: new Set(),
      createdAt: now(),
      expiresAt: ttlMs ? now() + ttlMs : null,
      latestFrame: null,
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
    return typeof sessionId === 'string' && SESSION_ID_PATTERN.test(sessionId);
  }

  return {
    createSession,
    deleteSession,
    getSession,
    hasSession,
    isValidSessionId,
  };
}

module.exports = { SESSION_ID_PATTERN, createSessionStore };
