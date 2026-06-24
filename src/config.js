function readNumber(env, key, fallback) {
  const rawValue = env[key];
  if (rawValue === undefined || rawValue === "") return fallback;

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function loadConfig(env = process.env) {
  return {
    debug: env.DEBUG === "true",
    frameDataUrlMaxBytes: readNumber(
      env,
      "FRAME_DATA_URL_MAX_BYTES",
      5 * 1024 * 1024,
    ),
    jsonBodyLimit: env.JSON_BODY_LIMIT || "10mb",
    maxAudiencePerSession: readNumber(env, "MAX_AUDIENCE_PER_SESSION", 250),
    maxImageInputBytes: readNumber(
      env,
      "MAX_IMAGE_INPUT_BYTES",
      6 * 1024 * 1024,
    ),
    maxImagePixels: readNumber(env, "MAX_IMAGE_PIXELS", 4 * 1000 * 1000),
    qrRateLimitMax: readNumber(env, "QR_RATE_LIMIT_MAX", 120),
    port: readNumber(env, "PORT", 3000),
    rateLimitWindowMs: readNumber(env, "RATE_LIMIT_WINDOW_MS", 60 * 1000),
    saveRateLimitMax: readNumber(env, "SAVE_RATE_LIMIT_MAX", 60),
    sessionTtlMs: readNumber(env, "SESSION_TTL_MS", 1000 * 60 * 60 * 2),
    wsMaxPayloadBytes: readNumber(env, "WS_MAX_PAYLOAD_BYTES", 6 * 1024 * 1024),
  };
}

module.exports = { loadConfig };
