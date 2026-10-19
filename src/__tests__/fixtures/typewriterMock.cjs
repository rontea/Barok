module.exports = {
  FREE_TIER_TYPEWRITER_INTERVAL_MS: 32,
  createTypewriterController: () => ({
    setTarget: () => undefined,
    flush: () => undefined,
    cancel: () => undefined,
    getText: () => '',
  }),
};
