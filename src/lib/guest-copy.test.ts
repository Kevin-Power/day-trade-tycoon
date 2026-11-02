import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Guests practise first since the easy-start work; no screen may say an account is required to start.
test("copy no longer says real K-line practice needs an account first", () => {
  const lobbyCard = readFileSync(new URL("../components/classroom-account.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(lobbyCard, /需登入個人帳號/);
});
