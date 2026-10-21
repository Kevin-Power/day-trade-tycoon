// Runs any desk QA script in Playwright's WebKit, an approximation of Safari, without editing it: every
// chromium.launch() the script makes launches WebKit instead.
// Usage (after `npx playwright install webkit`): node --import ./scripts/qa/webkit-preload.mjs scripts/qa/<script>.mjs ...
// WebKit has no CDP, so a script's CPU throttling (desk-ticks' slowed phone) is skipped, and it has no Long Tasks
// entries. WebKit on Windows still differs from Safari on a Mac or an iPhone (fonts, drawing); it does not replace them.
import { createRequire } from "node:module";

const { chromium, webkit } = createRequire(import.meta.url)("playwright");
chromium.launch = async (options = {}) => {
  // WebKit has no Chrome channel; drop it and any Chromium-only switches.
  const { channel, args, ...rest } = options;
  const browser = await webkit.launch(rest);
  const newContext = browser.newContext.bind(browser);
  browser.newContext = async (...settings) => {
    const context = await newContext(...settings);
    context.newCDPSession = async () => {
      console.warn("webkit-preload: no CDP in WebKit, so this script's CDP step (e.g. CPU throttling) is skipped.");
      return { send: async () => ({}), detach: async () => {} };
    };
    return context;
  };
  return browser;
};
