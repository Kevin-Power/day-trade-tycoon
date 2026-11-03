import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

// 2026-11-03, the owner: 「首頁能不能去除AI味道」, then 「把它處理好」. The entry screen (also what the class QR opens) and
// the lobby read like a landing-page template: a motivational slogan, a drawn K-line 「介面示意」, three numbered
// features, 「四字 · 四字」 eyebrows and an English tagline. They now say plainly what the classroom is.
const url = (path: string) => new URL(`../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(url(path), "utf8");

const HOME_FILES = [
  "src/components/gate-screen.tsx",
  "src/components/classroom-auth-layout.tsx",
  "src/components/lobby.tsx",
  "src/routes/login.tsx",
  "src/routes/setup.tsx",
];
const TEMPLATE =
  /DAY TRADE TYCOON|WorkspacePreview|FEATURES|把每一次判斷|練成自己的交易紀律|今天，先練好|一筆有計畫的交易|讓每一次練習|都有跡可循|你的教室，|從這裡開始|跟著講師掌握觀察重點|股文觀指 · 交易實作教室|當沖實作 · 模擬交易教室|01 \/ 教室入場|循序練習 · 隨時回看|留下紀錄 · 練習回看|隨時翻閱 · 反覆熟悉|先有計畫，再用紀錄檢查/;

test("the entry and lobby screens carry no template slogan, eyebrow, feature list or drawn preview", () => {
  for (const path of HOME_FILES) assert.doesNotMatch(read(path), TEMPLATE, path);
  assert.equal(existsSync(url("src/components/workspace-preview.tsx")), false, "the drawn 介面示意");
});

test("the brand line names the classroom instead of an English tagline", () => {
  for (const path of ["src/components/classroom-auth-layout.tsx", "src/components/lobby.tsx"])
    assert.match(read(path), /股文觀指教室/, path);
});

test("the entry screen says what the classroom does in plain words", () => {
  const gate = read("src/components/gate-screen.tsx");
  for (const fact of ["09:00", "10:30", "1,000 萬", "不會送到券商"]) assert.ok(gate.includes(fact), fact);
});

// Students come with the teacher's code (the class QR opens this screen), so the code form comes first and the
// guest trial is the quieter way in below it.
test("the entry code form comes before the guest trial", () => {
  const gate = read("src/components/gate-screen.tsx");
  assert.ok(gate.indexOf('label="教室入場碼"') > 0, "code field");
  assert.ok(gate.indexOf('label="教室入場碼"') < gate.indexOf("先體驗模擬操作"), "code field before the trial");
  assert.doesNotMatch(gate.slice(gate.indexOf("先體驗模擬操作") - 400), /academy-button-primary[^"]*"[^>]*>\s*先體驗/);
});

test("the entry page is flat ink like the desk: no glow, no gold rule, no leftover preview styles", () => {
  const css = read("src/classroom-refresh.css");
  for (const leftover of [/radial-gradient/, /border-top: 4px solid/, /\.workspace-preview/, /\.access-features/, /\.access-hero/])
    assert.equal(leftover.test(css), false, `classroom-refresh.css still has ${leftover}`);
});
