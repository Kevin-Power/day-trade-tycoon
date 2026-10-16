import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SEAT_TODAY } from "./license.ts";

// Guests practise first since the easy-start work; no screen may say an account is required to start.
test("copy no longer says real K-line practice needs an account first", () => {
  const lobbyCard = readFileSync(new URL("../components/classroom-account.tsx", import.meta.url), "utf8");
  for (const text of [SEAT_TODAY, lobbyCard]) assert.doesNotMatch(text, /需登入個人帳號/);
  assert.match(SEAT_TODAY, /先以訪客練習/);
});
