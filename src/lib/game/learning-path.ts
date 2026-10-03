export type CourseStep = {
  id: string;
  title: string;
  stage: "入門操作" | "風險紀律" | "自主練習";
  focus: string;
  steps: readonly [string, string, string];
  reflection: string;
};

/** Teaching guidance only; completion is not a pass decision or a profit claim. */
export const COURSE_PATH: readonly CourseStep[] = [
  {
    id: "wed-open",
    title: "第一筆有計畫的操作",
    stage: "入門操作",
    focus: "先熟悉一輪模擬流程；條件未到，可以先觀察而不送單。",
    steps: [
      "觀察商品，記下自己的進出條件與張數。",
      "若決定送單，核對商品、方向、張數與成交。",
      "查看結束時庫存，用復盤核對剛才的操作。",
    ],
    reflection: "哪個操作已經比較清楚？下一次還想核對哪一步？",
  },
  {
    id: "mon",
    title: "下跌時保護部位",
    stage: "風險紀律",
    focus: "下跌時先核對部位與原定條件，沒有符合條件也可以維持觀察。",
    steps: [
      "先觀察下跌時的盤面，確認自己有沒有持倉。",
      "有部位時，核對張數與原定出場條件再操作。",
      "復盤查看部位如何改變，記下一個可改進的動作。",
    ],
    reflection: "盤面下跌時，你先核對了什麼，再決定要不要操作？",
  },
  {
    id: "tue-dump",
    title: "練習執行停損",
    stage: "風險紀律",
    focus: "把預先寫下的出場條件，對照本盤操作紀錄；沒有持倉不必為了練習而進場。",
    steps: [
      "先觀察盤面，寫清楚自己預定的出場條件。",
      "有持倉且條件出現時，核對並執行模擬出場。",
      "用復盤比較原定條件、成交與剩餘庫存。",
    ],
    reflection: "原定的出場條件與實際操作是否一致？哪一步需要再練？",
  },
  {
    id: "tue-v",
    title: "練習耐心與出場",
    stage: "風險紀律",
    focus: "練習等待自己設定的條件，不以多下單或單次賺賠判斷進步。",
    steps: [
      "先觀察條件是否出現，未出現時可以繼續等待。",
      "有持倉時，核對持有時間與原定出場條件。",
      "復盤查看進出時間與成本，說明等待或出場的理由。",
    ],
    reflection: "這次等待或出場的理由是什麼？下次想把哪個判斷寫得更清楚？",
  },
  {
    id: "wed",
    title: "按計畫完成收尾",
    stage: "自主練習",
    focus: "把收尾分成核對庫存、處理部位與檢查紀錄；沒有持倉也要確認狀態。",
    steps: [
      "先觀察模擬時間，查看目前庫存與待成交委託。",
      "若有部位，依計畫處理並核對剩餘張數。",
      "復盤確認結束時庫存，記下收尾是否符合計畫。",
    ],
    reflection: "結束時還有沒有未平倉部位？你用哪份紀錄確認？",
  },
  {
    id: "tycoon",
    title: "獨立完成一次復盤",
    stage: "自主練習",
    focus: "自己完成觀察、核對與復盤；條件未到可不交易，重點是能說明自己的選擇。",
    steps: [
      "先觀察盤面，記下這次要練的動作與操作條件。",
      "自行核對每次委託、成交及庫存的變化。",
      "用完整復盤找出已做到的事，再選一項下次重點。",
    ],
    reflection: "哪一個動作做得更清楚？下一次只改善哪一件事？",
  },
];

export function courseStepFor(id: string): CourseStep | undefined {
  return COURSE_PATH.find((step) => step.id === id);
}
