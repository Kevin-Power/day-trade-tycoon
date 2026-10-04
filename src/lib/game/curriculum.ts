import type { Side } from "./types.ts";

export type LessonBeat = {
  atMinute: number;
  title: string;
  body: string;
  hint: string;
};

export type PassRule = {
  id: string;
  label: string;
  /** 機器可判定的規則代碼，實作見 pass-rules.ts */
  code:
    | "max_dd"
    | "flatten_before_close"
    | "no_average_down"
    | "profit_gt_fees"
    | "min_hold_minutes"
    | "risk_down_after_low"
    | "positive_pnl"
    | "min_winning_trade";
  params?: Record<string, number>;
};

export type Lesson = {
  id: string;
  no: string;
  skill: string;
  principle: string;
  prep: string[];
  beats: LessonBeat[];
  /** 關鍵分鐘暫停。未填則用 beats（略過開場 0 分，改由講解卡負責）。 */
  checkpoints?: LessonBeat[];
  review: string[];
  passRules?: PassRule[];
};

/** 教室六式：每盤都用，不隨關卡改。 */
export const PRINCIPLES: { no: string; title: string; body: string }[] = [
  {
    no: "01",
    title: "先核對費稅",
    body: "買賣價差不等於淨損益。費稅依模擬成交計算，請看教室明細，不套固定百分比。",
  },
  {
    no: "02",
    title: "看懂基準線",
    body: "江波黃虛線是昨收，均價線是另一個比較基準。先說出目前位置，不把線當成買賣答案。",
  },
  {
    no: "03",
    title: "分清委託與成交",
    body: "五檔顯示待成交委託，分價顯示已成交量。單看堆積，不能確認支撐或壓力。",
  },
  {
    no: "04",
    title: "先寫出場條件",
    body: "操作前寫下進出條件與張數。行情改變時，先核對原計畫再決定。",
  },
  {
    no: "05",
    title: "核對本筆金額",
    body: "下單頁會在本筆估算金額超過模擬權益 30% 時提醒。先核對張數，這不是個人的安全額度。",
  },
  {
    no: "06",
    title: "收尾逐項核對",
    body: "先看待成交委託與庫存，再核對成交紀錄。結束練習不代表部位已全部平倉。",
  },
];

export const LESSONS: Lesson[] = [
  {
    id: "wed-open",
    no: "第 1 課",
    skill: "核對第一筆操作",
    principle: "先看商品與盤面，再核對自己寫下的操作條件。",
    prep: [
      "先找到商品代號、昨收與目前價格。",
      "先寫進出條件與張數；費稅另外核對教室明細。",
      "下單頁的 30% 是本筆估算金額提醒，不是個人的安全額度；條件未到可先觀察。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先找到今天看的商品",
        body: "先核對商品名稱、代號與目前模擬時間。江波的昨收線與均價線可用來比較位置，不能告訴你後面的走勢。",
        hint: "先找商品代號與昨收，不急著送單。",
      },
      {
        atMinute: 1,
        title: "說出目前價格在哪裡",
        body: "看目前價格相對昨收與均價的位置，再對照自己的進場條件。條件未出現，可以保持觀察。",
        hint: "說出目前價在昨收上方、下方，還是附近。",
      },
      {
        atMinute: 10,
        title: "分清五檔與自己的成交",
        body: "五檔是市場委託，並不是你的成交紀錄。如果已送單，先查看委託狀態與已成交張數。",
        hint: "有送單就查看原委託，先不要重複按。",
      },
      {
        atMinute: 24,
        title: "核對成本與剩餘庫存",
        body: "有成交時，查看費用、交易稅與剩餘張數，再對照原定出場條件。沒有成交時，也可以記下等待的理由。",
        hint: "先看庫存，再看成交明細中的費稅。",
      },
    ],
    review: [
      "是否能說出當時觀察到的價格位置與自己的條件。",
      "委託、成交與結束時庫存是否核對清楚。",
      "有成交時，是否把費稅列入結果；沒有成交時，等待的理由是什麼。",
    ],
  },
  {
    id: "mon",
    no: "第 2 課",
    skill: "下跌時核對部位",
    principle: "價格變動時，先確認自己有沒有部位與原定出場條件。",
    prep: [
      "先確認庫存張數，不把價格下跌直接當成便宜。",
      "把目前價格與昨收、均價分開比較。",
      "有部位時對照原計畫，沒有部位時可以繼續觀察。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先確認有沒有持倉",
        body: "本課練習價格變動時如何核對部位。先看自己的庫存；目前沒有持倉，也能練習觀察與說明理由。",
        hint: "打開庫存，確認商品、方向與張數。",
      },
      {
        atMinute: 43,
        title: "把盤面與計畫對起來",
        body: "先描述目前價格與昨收的相對位置。有部位時，再核對原定出場條件是否出現；不要只憑一個顏色決定。",
        hint: "找出原計畫，核對一個出場條件。",
      },
      {
        atMinute: 60,
        title: "成交之後，部位有改變嗎",
        body: "若剛才有操作，先查原委託是否成交，再看庫存變化。五檔或分價出現堆積，都不代表你的委託已成交。",
        hint: "對照原委託的已成交張數與目前庫存。",
      },
      {
        atMinute: 200,
        title: "開始核對收尾安排",
        body: "看目前模擬時間，再查看待成交委託與庫存。有部位時依原計畫處理，送出後仍要核對成交與剩餘張數。",
        hint: "先查待成交委託，再查庫存。",
      },
    ],
    review: [
      "價格下跌時，是否先確認自己有沒有持倉。",
      "有操作時，是否核對原計畫、委託與成交，而不是只看價格。",
      "結束時的庫存是多少，用哪份紀錄確認。",
    ],
  },
  {
    id: "tue-dump",
    no: "第 3 課",
    skill: "核對並執行出場條件",
    principle: "操作前寫清出場條件，再用紀錄對照實際執行。",
    prep: [
      "先記下可核對的出場條件，不預設後續行情。",
      "送單前核對張數與可用額度；本課不要求一定進場。",
      "有持倉且條件出現時，核對商品與方向，再決定如何操作。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先寫下出場條件",
        body: "寫清楚什麼情況下要重新核對或處理部位。這是自己的操作計畫，沒有符合進場條件時，不必為了練停損而買進。",
        hint: "先寫一個能在盤面或紀錄中核對的條件。",
      },
      {
        atMinute: 8,
        title: "現在有部位需要處理嗎",
        body: "先查庫存。有部位時，把目前狀態與原定出場條件對起來；沒有部位時，繼續觀察即可。",
        hint: "先確認庫存張數，再核對原定條件。",
      },
      {
        atMinute: 52,
        title: "價格變動，先回看原計畫",
        body: "一段價格變動不能確認後面走勢。若需要調整操作，先說明眼前看到了什麼，再核對原計畫與持倉。",
        hint: "用一句話說出目前觀察，不預告後面漲跌。",
      },
      {
        atMinute: 70,
        title: "把出場過程核對完整",
        body: "若已送出出場委託，查看已成交與待成交張數，再核對剩餘庫存。按過按鈕不代表已全部出場。",
        hint: "對照委託、成交與剩餘張數三個地方。",
      },
    ],
    review: [
      "是否在操作前寫下可核對的出場條件。",
      "實際操作與原定條件是否一致；沒有操作的理由是什麼。",
      "若有出場，是否核對了成交與剩餘庫存。",
    ],
  },
  {
    id: "tue-v",
    no: "第 4 課",
    skill: "等待條件與核對出場",
    principle: "依自己的條件決定等待或操作，再核對時間與成本。",
    prep: [
      "本課從 10:00 開始，先看當時已出現的盤面。",
      "先寫清楚等待的條件，不把均價當作必然轉折。",
      "已有部位時，核對持有時間、出場條件與費稅。",
    ],
    beats: [
      {
        atMinute: 60,
        title: "10:00，先說清楚要等什麼",
        body: "先看目前價格相對昨收與均價的位置，再寫下自己等待的條件。現在能確認的只有已出現的資料。",
        hint: "先說出一個等待的條件。",
      },
      {
        atMinute: 120,
        title: "再次核對條件是否出現",
        body: "把眼前盤面與剛才的條件比較。條件未到，可以繼續等待；有部位時，也要核對原定出場條件。",
        hint: "分開說明目前觀察與自己的操作條件。",
      },
      {
        atMinute: 160,
        title: "核對持有時間與成本",
        body: "有成交時，從紀錄查看進場時間與費稅，再對照目前持倉。是否出場依原計畫核對，不為湊滿時間而繼續持有。",
        hint: "先找成交時間，再看費稅與庫存。",
      },
      {
        atMinute: 250,
        title: "收尾前，再查一次狀態",
        body: "查看模擬時間、待成交委託與庫存。需要處理部位時，送出後仍要確認是否成交，不能只憑損益顏色判斷已完成。",
        hint: "先核對待成交委託與剩餘張數。",
      },
    ],
    review: [
      "等待或操作的理由，是否來自當時可見的資料與原計畫。",
      "有成交時，是否能核對進出時間與費稅。",
      "結束時的委託與庫存狀態，是否核對清楚。",
    ],
  },
  {
    id: "wed",
    no: "第 5 課",
    skill: "核對收尾與庫存",
    principle: "按計畫處理部位，並以成交與庫存確認收尾狀態。",
    prep: [
      "先確認目前模擬時間與已選商品。",
      "操作前寫好出場條件，包含需要重新核對的情況。",
      "收尾時要查看委託、成交與庫存，不只看損益。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先寫今天的收尾條件",
        body: "本課練習把操作做完、核對清楚。先記下進出條件與張數，再確認商品與目前模擬時間。",
        hint: "先寫清楚什麼情況下要核對或處理部位。",
      },
      {
        atMinute: 1,
        title: "先觀察，再核對計畫",
        body: "看目前價格相對昨收與均價的位置。是否操作要對照自己的條件；沒有符合條件時，可以先留下觀察。",
        hint: "把目前看到的狀態，和預定條件分開說。",
      },
      {
        atMinute: 70,
        title: "逐檔查看自己的部位",
        body: "有多檔部位時，逐檔核對商品代號、方向與張數。其他商品的變動，不代表這一檔已符合你的出場條件。",
        hint: "先選一檔，核對它自己的庫存與計畫。",
      },
      {
        atMinute: 200,
        title: "收尾分三步核對",
        body: "先查待成交委託，再查庫存；若已處理部位，最後用成交紀錄確認。部分成交時，還要核對剩餘張數。",
        hint: "依序查看委託、庫存與成交。",
      },
    ],
    review: [
      "出場條件是否事先寫清楚，操作後有沒有對照。",
      "收尾時是否逐項核對委託、成交與庫存。",
      "結束時若仍有部位，是否能說明剩餘商品與張數。",
    ],
  },
  {
    id: "tycoon",
    no: "期末考",
    skill: "自己執行規則",
    principle: "額度是教室設定；自行核對計畫、操作與紀錄，再選下一次重點。",
    prep: [
      "本金 500 萬、2 倍額度。先核對每筆張數與模擬風險。",
      "逐項核對商品、條件、張數、委託、成交與庫存。",
      "送單前核對本筆估算金額提醒，條件未到可以不交易。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先選今天要核對的動作",
        body: "這次由你自己完成觀察、操作核對與復盤。先寫下要練的動作和條件；額度增加，不表示需要增加張數。",
        hint: "寫下一個重點，再核對下單頁的金額提醒。",
      },
      {
        atMinute: 1,
        title: "說明眼前資料與操作理由",
        body: "把當下看見的價格位置與原計畫對起來。可以操作，也可以等待；重點是能用當時的資料說明自己的選擇。",
        hint: "先說出觀察與條件，不用後面的結果解釋。",
      },
      {
        atMinute: 248,
        title: "自己完成收尾核對",
        body: "確認模擬時間、待成交委託與庫存。處理部位後，再用成交紀錄檢查剩餘張數，準備留下復盤重點。",
        hint: "依序核對委託、成交與結束時庫存。",
      },
    ],
    review: [
      "是否能說明張數、部位與本課額度設定的關係。",
      "實際操作或等待的理由，是否與事前條件一致。",
      "從本盤紀錄選出一個下次要核對的動作。",
    ],
  },
];

export function lessonById(id: string): Lesson | undefined {
  return LESSONS.find((l) => l.id === id);
}

export function nextLesson(id: string): Lesson | undefined {
  const i = LESSONS.findIndex((l) => l.id === id);
  if (i < 0) return undefined;
  return LESSONS[i + 1];
}

export function beatKey(scenarioId: string, atMinute: number) {
  return `${scenarioId}:${atMinute}`;
}

export function openingBeat(scenarioId: string, startMinute: number): LessonBeat | null {
  const lesson = lessonById(scenarioId);
  if (!lesson) return null;
  return lesson.beats.find((b) => b.atMinute >= startMinute - 0.05) ?? null;
}

export function checkpointsOf(lesson: Lesson): LessonBeat[] {
  if (lesson.id === "tue-dump") {
    return [
      {
        atMinute: 0.333,
        title: "開盤先核對自己的條件",
        body: "先看目前價格與庫存，再對照操作前寫下的出場條件。沒有持倉時，可以觀察並記下理由。",
        hint: "先核對庫存與原定條件，不必為了練習而進場。",
      },
      {
        atMinute: 120,
        title: "11:00 · 核對部位與計畫",
        body: "查看目前庫存與原定出場條件。有操作時，核對成交及剩餘張數；單一價位不能確認後面走勢。",
        hint: "查看庫存，再核對原計畫與成交。",
      },
    ];
  }
  return (lesson.checkpoints ?? lesson.beats).filter((b) => b.atMinute > 0.05);
}

export const PASS_RULES: Record<string, PassRule[]> = {
  "wed-open": [
    { id: "avg", label: "不攤平", code: "no_average_down" },
    { id: "dd", label: "回撤 ≤ 2%", code: "max_dd", params: { max: 0.02 } },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
    { id: "win", label: "完成一筆獲利當沖", code: "min_winning_trade", params: { min: 1 } },
  ],
  mon: [
    { id: "avg", label: "不攤平", code: "no_average_down" },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
    { id: "dd", label: "回撤 < 4%", code: "max_dd", params: { max: 0.04 } },
  ],
  "tue-dump": [
    { id: "avg", label: "不攤平", code: "no_average_down" },
    { id: "risk", label: "低點後把風險降下來", code: "risk_down_after_low" },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
  ],
  "tue-v": [
    { id: "hold", label: "順勢至少抱 15 分鐘", code: "min_hold_minutes", params: { min: 15 } },
    { id: "fees", label: "獲利大於費稅三倍", code: "profit_gt_fees", params: { multiple: 3 } },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
  ],
  wed: [
    { id: "pnl", label: "全日報酬為正", code: "positive_pnl" },
    { id: "dd", label: "回撤 < 3%", code: "max_dd", params: { max: 0.03 } },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
  ],
  tycoon: [
    { id: "pnl", label: "全日報酬為正", code: "positive_pnl" },
    { id: "dd", label: "回撤 < 5%", code: "max_dd", params: { max: 0.05 } },
    { id: "flat", label: "收盤前自行平倉", code: "flatten_before_close" },
  ],
};

export function passRulesOf(id: string): PassRule[] {
  return lessonById(id)?.passRules ?? PASS_RULES[id] ?? [];
}

for (const lesson of LESSONS) {
  if (!lesson.passRules?.length) lesson.passRules = PASS_RULES[lesson.id] ?? [];
}

export type DebriefInput = {
  trades: number;
  pnl: number;
  fees: number;
  maxDrawdown: number;
  equity: number;
  exposure: number;
  fills: { side: Side; price: number; vwapAt: number }[];
};

export type Debrief = {
  tags: string[];
  headline: string;
  notes: string[];
};

export function debrief(lesson: Lesson, input: DebriefInput): Debrief {
  const tags: string[] = [];
  if (input.fills.length === 0) tags.push("尚無成交");
  else if (input.trades === 0) tags.push("尚無平倉撮合");
  let awayFromVwap = 0;
  for (const f of input.fills) {
    if (!f.vwapAt) continue;
    if (f.side === "buy" && f.price > f.vwapAt * 1.004) awayFromVwap += 1;
    if (f.side === "sell" && f.price < f.vwapAt * 0.996) awayFromVwap += 1;
  }
  if (awayFromVwap > 0) tags.push("成交價偏離均價比較值");
  const nearFees = input.trades > 0 && Math.abs(input.pnl) < input.fees * 1.2;
  if (nearFees) tags.push("淨損益絕對值小於費稅 1.2 倍");
  if (input.maxDrawdown > 0.04) tags.push("最大回撤超過 4%");
  if (input.equity > 0 && input.exposure > input.equity * 0.35) tags.push("結束時曝險超過權益 35%");
  if (input.pnl > 0) tags.push("模擬淨損益為正");
  else if (input.pnl < 0) tags.push("模擬淨損益為負");

  let headline = "先核對委託、成交與結束時庫存，再對照原計畫。";
  if (input.fills.length === 0)
    headline = "本盤尚無成交。可以記下觀察與沒有進場的理由，不必為完成練習而送單。";
  else if (input.trades === 0)
    headline = "本盤有成交，但尚無平倉撮合紀錄。先核對庫存與待成交委託。";
  else if (awayFromVwap > 0)
    headline =
      "有買價高於當時均價 0.4%，或賣價低於當時均價 0.4% 的紀錄。回看當時條件，這個比較無法判定操作動機。";
  else if (nearFees)
    headline =
      "本盤淨損益的絕對值小於費稅的 1.2 倍。請分開核對買賣價差與成本，這個比較不能判定方向是否正確。";
  else if (input.maxDrawdown > 0.04)
    headline = "本盤最大回撤超過 4%。對照當時部位與原定條件，找出一個需要再核對的動作。";
  else if (input.pnl > 0)
    headline = "本盤模擬淨損益為正。仍需對照原計畫與操作紀錄，不能據此認定風控或進出場已熟練。";
  else if (input.pnl < 0)
    headline = "本盤模擬淨損益為負。先核對費稅與原定條件，不用一次盈虧判定操作能力。";

  return {
    tags,
    headline: `${headline} 單盤紀錄不是技能認證，也不代表未來報酬。`,
    notes: lesson.review,
  };
}
