export const LEARNER_GUIDE_KEY = "day-tycoon-learner-guide-v1";
export const LEARNER_GUIDE_PAUSE_MESSAGE =
  "操作導覽中，盤勢保持暫停。請先完成或略過導覽，再自行開始練習。";

export const LEARNER_GUIDE_STEPS = [
  {
    title: "先看商品",
    tab: "watch",
    body: "下方「自選行情」列出練習商品。第一課已選好鴻海；點商品可看走勢，不會下單。",
    detail: "先確認商品名稱。這裡的行情與金額都是教室模擬。",
  },
  {
    title: "認識模擬買進",
    tab: "trade",
    body: "下方「模擬下單」可選買進或賣出，再確認商品、價格與張數。最後按送出，才會建立模擬委託。",
    detail: "導覽不會替你送單。現在只認識按鈕，開始練習後再依自己的計畫操作。",
  },
  {
    title: "查看庫存與成交",
    tab: "pos",
    body: "送出後，到下方「庫存成交」確認。委託是等待成交的指示；成交後，持有的張數才會出現在庫存。",
    detail: "沒有看到成交，先查委託狀態，不要因為不確定而重複送出。",
  },
  {
    title: "平倉，再看復盤",
    tab: "trade",
    body: "要結束某個商品的持倉，可在「模擬下單」按「平倉此檔」，再到庫存確認剩餘張數。練完後，按上方「結束練習」看復盤。",
    detail: "結算會結束這次練習。復盤用來檢查操作與成本，模擬損益不代表實際報酬。",
  },
] as const;

export function shouldAutoOpenLearnerGuide(
  scenarioId: string,
  completedSessions: number,
  seen: boolean,
) {
  return scenarioId === "wed-open" && completedSessions === 0 && !seen;
}

export function learnerGuideStepState(requestedStep: number) {
  const step = Number.isFinite(requestedStep)
    ? Math.max(0, Math.min(LEARNER_GUIDE_STEPS.length - 1, Math.trunc(requestedStep)))
    : 0;
  return {
    learnerGuideStep: step,
    learnerGuideReady: false,
    mobileTab: LEARNER_GUIDE_STEPS[step].tab,
    paused: true,
  } as const;
}

export function initialPracticeSpeed(scenarioSpeed: number, autoGuide: boolean) {
  return autoGuide ? 1 : scenarioSpeed;
}

export function finishedLearnerGuideState() {
  return { learnerGuideStep: null, learnerGuideReady: true, paused: true } as const;
}

function guideKey(identity: string | null) {
  return `${LEARNER_GUIDE_KEY}:${identity || "guest"}`;
}

export function hasSeenLearnerGuide(identity: string | null): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(guideKey(identity)) === "1";
  } catch {
    return false;
  }
}

export function rememberLearnerGuide(identity: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(guideKey(identity), "1");
  } catch {
    // A storage restriction must not prevent the learner from leaving the guide.
  }
}
