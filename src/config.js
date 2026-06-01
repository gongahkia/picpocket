function readNumber(env, key, fallback) {
  const rawValue = env[key];
  if (rawValue === undefined || rawValue === '') return fallback;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function loadConfig(env = process.env) {
  return {
    debug: env.DEBUG === 'true',
    jsonBodyLimit: env.JSON_BODY_LIMIT || '10mb',
    maxAudiencePerSession: readNumber(env, 'MAX_AUDIENCE_PER_SESSION', 250),
    port: readNumber(env, 'PORT', 3000),
    sessionTtlMs: readNumber(env, 'SESSION_TTL_MS', 1000 * 60 * 60 * 2),
    wsMaxPayloadBytes: readNumber(env, 'WS_MAX_PAYLOAD_BYTES', 6 * 1024 * 1024),
  };
}

module.exports = { loadConfig };
