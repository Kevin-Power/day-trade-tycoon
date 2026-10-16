/** Where a learner lands after sign-up, and what the practice screen says when it cannot open. */
export const PRACTICE_PATH = "/morning?panel=trade";
export const GUEST_TERMS_TEXT =
  "按下開始，表示你了解：這是用歷史 K 線的紙上模擬，不是真實交易，結果不代表實際獲利。";
const PROFILE_REQUIRED = "請先完成學員資料與教學聲明";

export type AccessProblem = { kind: "guest-start" | "profile" | "gate"; title: string; body: string };

export function describeAccessProblem(status: number, message: string): AccessProblem {
  if (status === 401)
    return { kind: "guest-start", title: "暫時無法開始練習", body: "請稍候再試一次。也可以先登入或建立帳號。" };
  if (message === PROFILE_REQUIRED)
    return {
      kind: "profile",
      title: "還差一步：完成學員資料",
      body: "建立帳號後要填寫學員名稱並確認教學聲明，才能保存練習。",
    };
  return { kind: "gate", title: "請重新進入教室", body: message };
}
