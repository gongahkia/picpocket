function createLogger({ debug = false } = {}) {
  return {
    debug: (...args) => {
      if (debug) console.debug(...args);
    },
    error: (...args) => console.error(...args),
    info: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
  };
}

module.exports = { createLogger };
