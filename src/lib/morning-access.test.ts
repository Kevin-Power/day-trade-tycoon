import test from "node:test";
import assert from "node:assert/strict";
import { describeAccessProblem } from "./morning-access.ts";

test("an unauthenticated practice request asks to retry the guest start", () => {
  assert.deepEqual(describeAccessProblem(401, "請先登入學員帳號"), {
    kind: "guest-start", title: "暫時無法開始練習", body: "請稍候再試一次。也可以先登入或建立帳號。" });
});

test("a member without a profile is sent to finish it", () => {
  assert.deepEqual(describeAccessProblem(403, "請先完成學員資料與教學聲明"), {
    kind: "profile", title: "還差一步：完成學員資料",
    body: "建立帳號後要填寫學員名稱並確認教學聲明，才能保存練習。" });
});

test("any other refusal shows the server message and goes back to the lobby", () => {
  assert.deepEqual(describeAccessProblem(403, "請先進入教室"), { kind: "gate", title: "請重新進入教室", body: "請先進入教室" });
});
