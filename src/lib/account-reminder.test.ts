import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// 2026-11-11, the owner: 「提醒同學登入使用請申請帳號 以便協助記錄下次登入即可繼續」.
// Students who stay guests lose their record; the entry screen, the lobby and the desk now all say so in the same words.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const KEEP = "下次登入就能接著練";

test("the entry screen tells students to apply for an account after entering", () => {
  const gate = read("src/components/gate-screen.tsx");
  assert.ok(gate.includes("申請帳號"), "申請帳號");
  assert.ok(gate.includes(KEEP), KEEP);
  // The line sits under the 進入教室 button, before the guest trial.
  assert.ok(gate.indexOf("進入教室\"}") < gate.indexOf(KEEP), "after the button");
  assert.ok(gate.indexOf(KEEP) < gate.indexOf("沒有入場碼"), "before the guest trial");
});

test("the lobby opens with the account reminder for anyone not logged in", () => {
  const card = read("src/components/account-reminder.tsx");
  assert.match(card, /請先登入再練習/);
  assert.ok(card.includes(KEEP), KEEP);
  assert.match(card, /loginHref\(\{ next: "\/", mode: "up" \}\)[\s\S]*申請帳號/, "申請帳號 opens sign-up");
  assert.match(card, /loginHref\(\{ next: "\/" \}\)[\s\S]*登入/, "登入 opens sign-in");
  const lobby = read("src/components/lobby.tsx");
  const reminder = lobby.indexOf("{!CLASSROOM_OFFLINE && !userId && <AccountReminder />}");
  assert.ok(reminder > 0, "shown only to visitors who are not logged in");
  assert.ok(reminder < lobby.indexOf("<DailyCard />") && reminder < lobby.indexOf("<TodayCard />"), "first card in the lobby");
});

test("the desk's guest prompts use the same words", () => {
  const prompts = read("src/components/guest-prompts.tsx");
  assert.ok(prompts.includes(KEEP), KEEP);
  assert.doesNotMatch(prompts, /建立帳號/);
  assert.match(prompts, /申請帳號，保存這次的練習/);
  for (const path of ["src/components/classroom-account.tsx", "src/components/access-card.tsx"]) {
    assert.doesNotMatch(read(path), /登入／建立帳號/, path);
    assert.match(read(path), /登入／申請帳號/, path);
  }
});
