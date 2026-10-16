import test from "node:test";
import assert from "node:assert/strict";
import { installMode, shouldRegisterServiceWorker } from "./install-mode.ts";

const android = "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const windows = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

test("phones get the right install help; desktops and installed apps get none", () => {
  assert.equal(installMode({ userAgent: android, hasPrompt: true, standalone: false }), "android-prompt");
  assert.equal(installMode({ userAgent: android, hasPrompt: false, standalone: false }), "none");
  assert.equal(installMode({ userAgent: iphone, hasPrompt: false, standalone: false }), "ios-guide");
  assert.equal(installMode({ userAgent: iphone, hasPrompt: false, standalone: true }), "none");
  assert.equal(installMode({ userAgent: windows, hasPrompt: true, standalone: false }), "none");
});

test("the service worker registers only on the hosted HTTPS site", () => {
  assert.equal(shouldRegisterServiceWorker({ protocol: "https:", baseUrl: "/" }), true);
  assert.equal(shouldRegisterServiceWorker({ protocol: "http:", baseUrl: "/" }), false);
  assert.equal(shouldRegisterServiceWorker({ protocol: "https:", baseUrl: "./" }), false);
});
