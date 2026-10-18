// Digital edition only: what each task asks the learner to enter, what counts as "done", and the
// short "你現在會做什麼／你的成果" lines shown when a task is finished.
//
// Rules of this file
// - Completion = the task's required items, never "every checkbox on the page".
//   self    : the learner's own confirmation (自評)
//   answer  : something the learner wrote or chose; any honest answer counts (否／不適用 included)
//   optional: shown and saved, never required
// - Rule checks (算式、與教材資料比對) are feedback only. They never block completion and never grade.
// - Example rows are read-only and labelled; learner fields always start empty.

/** "我能…" after finishing each task. */
export const can = {
  "01-1": "我能用入場碼進入教室，並確認這是模擬教學、不是投資建議。",
  "01-2": "我能建立自己的學員帳號，讓練習紀錄跟著帳號保存。",
  "01-3": "我能從課程卡片開始一輪練習，並用範本寫好作戰計畫。",
  "01-4": "我能在工作台找到狀態列、重播控制和報價區，並用「+1 分」前進時間。",
  "01-5": "我能用三種方法切換股票，也知道切換不會讓時間前進。",
  "01-6": "我能讀出一檔股票的最新價、漲跌、漲跌幅，以及它是哪一分鐘的收價。",
  "02-1": "我能用昨收判斷一檔股票是漲、跌還是平盤。",
  "02-2": "我能讀出今天的開盤、最高、最低，說出現價在今天範圍裡的位置。",
  "02-3": "我能切換分時與 K 線，讀出一根 K 棒的開高低收，並在圖上找到前高。",
  "02-4": "我能在五檔找到買一、賣一，並知道這裡的五檔是教學模擬。",
  "02-5": "我能用分鐘明細逐分鐘核對開高低收，也說得出本教材為什麼沒有成交量。",
  "02-6": "我能用一句觀察完成復盤，保存一整輪練習。",
  "03-1": "我能把模糊的想法寫成可以在畫面上核對的進場與失效條件。",
  "03-2": "我能逐分鐘前進，在條件成立的那一分鐘停下來。",
  "03-3": "我能設定下單票的方向、價格類型與張數，並看懂三個金額欄位。",
  "03-4": "我能用確認卡逐項核對，送出一筆模擬委託。",
  "03-5": "我能分辨「委託已送出」和「已經成交」。",
  "04-1": "我能確認委託已成交，並說出成交價為什麼是下一分鐘的開盤價。",
  "04-2": "我能在成交與庫存分頁讀出費用、持有張數與平均成本。",
  "04-3": "我能送出限價委託，並在成交前把它撤回。",
  "04-4": "我能在失效條件出現時依計畫賣出，並確認庫存歸零。",
  "04-5": "我能用成交紀錄對帳，算出價差、費稅與淨損益。",
  "04-6": "我能在 10:00 回看計畫並保存復盤，完成一輪完整的模擬交易。",
  "05-1": "我能說出當沖的四種基本風險，並算出一檔股票的費稅門檻。",
  "05-2": "我能先決定可承受的模擬損失，再算出最多張數。",
  "05-3": "我能在進場前寫好出場條件，條件成立時照著做。",
  "05-4": "我能只用已完成的 K 線記錄前高與突破，形態沒完成就不進場。",
  "05-5": "我能在條件沒出現時選擇等待，並把等待記錄下來。",
  "06-1": "我能在一輪練習前，選定一個要檢查的操作習慣。",
  "06-2": "我能在回放中記下每一個決定的時間、條件與理由。",
  "06-3": "我能依序核對計畫、委託、成交與庫存四份紀錄。",
  "06-4": "我能算出淨損益，並誠實回答自己有沒有遵守計畫。",
  "06-5": "我能從紀錄找出一次具體的失誤，寫下下一次只改的一件事。",
  "06-6": "我能把整理好的復盤寫進系統並保存。",
  "F-1": "我知道期末任務的規則、時間安排，以及要交哪些作品。",
  "F-2": "我知道期末怎麼評量，也知道模擬損益不計分。",
  "F-3": "我能在開始前寫好一份有風險預算的期末計畫。",
  "F-4": "我能在回放中為每一個決定留下時間、條件與理由。",
  "F-5": "我能用對帳、遵守計畫檢查與改善，完成一份期末報告。",
};

/** Where the evidence of each task lives (shown under 「你留下的成果」 next to the page's own answers). */
export const proof = {
  "01-1": "系統：大廳顯示「今天三件事」。",
  "01-2": "系統：大廳右上角出現「我的學習」。",
  "01-3": "系統：時鐘 09:01，本輪計畫是「先看不做」。",
  "01-4": "系統：時鐘走到 09:03。",
  "01-5": "系統：報價區可以換到任一檔，時鐘沒變。",
  "01-6": "本頁：「我的第一個報價」。",
  "02-1": "本頁：「09:05 的五檔股票」。",
  "02-2": "系統：「行情」分頁的開盤、昨收、最高、最低。",
  "02-3": "系統：K 線圖上標「前高」的虛線。",
  "02-4": "系統：五檔左上角的「教學模擬五檔」。",
  "02-5": "系統：「分鐘明細」最近 10 分鐘。",
  "02-6": "系統：第 1 輪的完成卡（含你寫的觀察）。",
  "03-1": "本頁：「我的具體規則」；系統：第 2 輪的作戰計畫。",
  "03-2": "系統：09:20 的快訊「台積電 站上昨收 2575」。",
  "03-3": "系統：下單票設定為買進、市價、1 張。",
  "03-4": "系統：委託分頁的「待撮合」。",
  "03-5": "本頁：「委託 vs 成交」。",
  "04-1": "系統：委託狀態「已成交」。",
  "04-2": "系統：成交分頁與庫存分頁。",
  "04-3": "系統：委託分頁的「已撤回」。",
  "04-4": "系統：成交分頁的賣出紀錄，庫存 0。",
  "04-5": "本頁：對帳表。",
  "04-6": "系統：第 2 輪的完成卡。",
  "05-1": "本頁：「我的費稅門檻計算」。",
  "05-2": "本頁：「風險預算表」；系統：第 3 輪的紀錄。",
  "05-3": "本頁：「出場條件檢核表」。",
  "05-4": "本頁：「N 字觀察表」。",
  "05-5": "本頁：「等待紀錄表」；系統：第 6 輪的完成卡。",
  "06-1": "本頁：你選的習慣；系統：第 7 輪的作戰計畫。",
  "06-2": "本頁：決策日誌。",
  "06-3": "本頁：「四份紀錄對照表」。",
  "06-4": "本頁：損益對帳與遵守計畫檢查。",
  "06-5": "本頁：「失誤與改善」。",
  "06-6": "系統：第 7 輪的完成卡（含復盤全文）。",
  "F-1": "本頁：你確認過的規則。",
  "F-2": "本頁：評量方式（自我檢查為選做）。",
  "F-3": "本頁：期末計畫單。",
  "F-4": "本頁：期末決策日誌。",
  "F-5": "本頁：期末報告；系統：期末那一輪的完成卡。",
};

/** Column input types and completion rules for the sheets that already exist in the lesson content. */
export const sheets = {
  "01-6": { key: "quote", inputs: ["stock", "time", "num", "text", "text"], need: { rows: 2, cols: [0, 1, 2] }, verify: { kind: "quote", day: "2026-10-06", stockCol: 0, timeCol: 1, priceCol: 2, changeCol: 3 } },
  "02-1": { key: "c0905", inputs: ["stock", "num", ["漲", "跌", "平"], "text"], need: { rows: 4, cols: [0, 1, 2] }, verify: { kind: "quote", day: "2026-10-06", time: "09:05", stockCol: 0, priceCol: 1, dirCol: 2 } },
  "03-1": { key: "rule", inputs: ["text", "text"], need: { rows: 2, cols: [0, 1] } },
  "03-5": { key: "vs", inputs: ["label", "text"], need: { rows: "all", cols: [1] } },
  "04-5": { key: "ledger", inputs: ["label", "label", "num"], need: { rows: "all", cols: [2] }, verify: { kind: "ledger" } },
  "05-1": { key: "fee", inputs: ["stock", "num", "num", "num", "num"], need: { rows: 2, cols: [0, 1, 4] }, verify: { kind: "threshold" } },
  "05-2": { key: "risk", inputs: ["label", "num"], need: { rows: [0, 1, 2, 3, 4, 5, 6, 7], cols: [1] }, verify: { kind: "risk" }, lastRowText: true },
  "05-3": { key: "exit", inputs: ["label+text", "time", "text", "tri"], need: { rows: 2, cols: [0] } },
  "05-4": { key: "nshape", inputs: ["stock", "text", "text", "text", "text"], need: { rows: 1, cols: [0, 1, 4] } },
  "05-5": { key: "wait", inputs: ["time", "text", "text", "text", "text"], need: { rows: 3, cols: [0, 1, 3] }, dynamic: { min: 3, max: 20 } },
  "06-2": { key: "log", inputs: ["time", "text", "text", "text"], need: { rows: 3, cols: [0, 2, 3] }, dynamic: { min: 3, max: 30 } },
  "06-3": { key: "four", inputs: ["label", "text", "tri"], need: { rows: "all", cols: [1, 2] }, fixedCells: { "0:2": "—" } },
  "06-5": { key: "fix", inputs: ["label", "text"], need: { rows: [2, 3, 4, 5], cols: [1] } },
};

/** 06-4: the net result next to the five honest yes／no／not-applicable answers. */
export const pnlCheck = {
  key: "pnl",
  title: "損益對帳",
  fields: [
    { id: "diff", label: "價差（元）", input: "num" },
    { id: "cost", label: "合計費稅（元）", input: "num" },
    { id: "net", label: "淨損益（元）", input: "num", need: true, hint: "這一輪沒有交易就填 0" },
    { id: "match", label: "和狀態列的「本輪損益」一致嗎？", input: "tri", need: true },
  ],
};

/** The final mission's three works, entered and kept on this device. */
export const finals = {
  "F-1": { confirm: "我讀完任務規則與時間配置，知道要交的三份作品和系統證據。" },
  "F-2": { confirm: "我讀完四個評量面向，知道模擬損益不計分。" },
  "F-3": {
    intro: "開始回放前填完。系統計畫的三格要和這一頁一致。",
    fields: [
      { id: "day", label: "交易日", input: ["2026-10-05", "2026-10-06"], need: true },
      { id: "theme", label: "練習主題", input: ["第 1 課", "第 2 課", "第 3 課", "第 4 課", "第 5 課", "第 6 課"], need: true },
      { id: "stock", label: "股票（代號）", input: "stock", need: true },
      { id: "reason", label: "我觀察的理由", input: "area", hint: "背景或價格條件，不寫成買賣答案", need: true },
      { id: "entry", label: "進場條件", input: "area", hint: "什麼條件出現，我才考慮操作（要能在畫面上核對）", need: true },
      { id: "exit", label: "失效／出場條件", input: "area", hint: "價格條件＋時間條件", need: true },
    ],
    risk: true,
    threshold: [
      { id: "perShare", label: "每股成本 = 來回費稅 ÷ 1,000", input: "num" },
      { id: "tick", label: "一檔是多少元", input: "num" },
      { id: "ticks", label: "至少要漲幾檔才打平", input: "num" },
      { id: "end", label: "我的結束時間", input: "time", need: true },
    ],
    confirm: "計畫單已完成，系統計畫的三格與本頁一致。",
  },
  "F-4": {
    intro: "每做一個決定（送單、等待、出場、不交易）就新增一列。只寫『當時看得到的』，不寫後來才知道的。至少 3 列；等待和不交易也算決定，不必每列都交易。",
    log: { inputs: ["time", "text", "text", "text"], columns: ["時間", "當時看得到的條件", "我的決定", "理由"], need: { rows: 3, cols: [0, 2, 3] }, dynamic: { min: 3, max: 40 } },
  },
  "F-5": {
    fills: { columns: ["時間", "買／賣", "張數", "成交價", "手續費", "交易稅"], inputs: ["time", ["買進", "賣出"], "num", "num", "num", "num"], dynamic: { min: 0, initial: 2, max: 20 } },
    noTrade: "這一輪沒有成交（整輪等待或不交易）",
    totals: [
      { id: "diff", label: "價差合計（元）", input: "num" },
      { id: "cost", label: "費稅合計（元）", input: "num" },
      { id: "net", label: "淨損益（元）", input: "num", needUnlessNoTrade: true },
      { id: "match", label: "和系統的「本輪損益」一致嗎？", input: "tri", need: true },
    ],
    adherence: [
      "進場前，條件真的已經成立了嗎？",
      "張數沒有超過風險預算的最多張數嗎？",
      "出場是依照事先寫好的條件嗎？",
      "結束前處理完部位了嗎？（沒有的話寫原因）",
      "所有委託都在計畫之內嗎？（沒有計畫以外的委託）",
    ],
    reflect: [
      { id: "mistake", label: "一次具體的失誤", hint: "時間、看到什麼、做了什麼、應該做什麼", need: true },
      { id: "change", label: "下一次只改一件事", hint: "要能從紀錄核對", need: true },
      { id: "proud", label: "這場挑戰，我最滿意的一個決定", hint: "選填" },
    ],
    confirm: "系統的期末復盤已保存，看得到完成卡。",
    teacher: "完成卡畫面已給講師看過（講師確認）",
  },
};

/** Five-minute first win before LEVEL 01: the guest path the classroom really offers (no account). */
export const quickstart = {
  id: "Q",
  title: "課前小任務：讀出第一個報價",
  minutes: "約 5 分鐘",
  goal: "不用建立帳號，用入場碼進教室、開始一輪回放，讀出台積電的最新價與時間，完成你的第一張成果卡。",
  why: "所有判斷都從『現在的價格是多少、是哪一分鐘的』開始。先用 5 分鐘成功一次，再進入完整的 LEVEL 01。",
  prep: ["講師給的教室網址與入場碼", "電腦或手機（電腦看得最清楚）"],
  steps: [
    { n: 1, text: "打開講師給的教室網址，輸入入場碼、勾選聲明，按「進入教室」。", sub: "這個小任務不用建立帳號，以訪客身分練習。" },
    { n: 2, text: "在大廳「今天三件事」按「開始今天的練習」。" },
    { n: 3, text: "計畫範本選「先看不做」，按「用這個計畫開始」。", sub: "出現新手教學時，可以先按「跳過」；LEVEL 01 會完整看一次。" },
    { n: 4, text: "按兩次「+1 分」，讓時鐘走到 `09:03`。" },
    { n: 5, text: "看報價區：股票名稱、時間（「09:03 收價」）、大字的最新價、漲跌，填進下方的成果卡。", sub: "數位版會自動用教材的每分鐘收價核對；紙本請和報價區再看一次。" },
  ],
  figures: [
    {
      row: [
        { shot: "q-today", caption: "大廳的「今天三件事」：按「開始今天的練習」。", crop: { x: 8, y: 9, w: 560, h: 258 }, marks: [{ n: 2, target: "start", pos: "r" }] },
        { shot: "q-plan", caption: "選「先看不做」，再按「用這個計畫開始」。", crop: { x: 0, y: 140, w: 680, h: 250 }, marks: [{ n: 3, target: "observe", pos: "ir" }] },
      ],
    },
    { shot: "q-desk", caption: "時鐘與重播控制：按兩次「+1 分」，時鐘走到 09:03。", crop: { x: 296, y: 0, w: 799, h: 44 }, gutterBottom: 30, marks: [{ n: 4, target: "plusOne", pos: "gb" }] },
    { shot: "q-quote", caption: "報價區：股票名稱、時間（09:03 收價）、最新價與漲跌。", gutter: 28, marks: [{ n: 5, target: "price", pos: "gl" }], width: "70%" },
  ],
  form: { inputs: ["stock", ["2026-10-06", "2026-10-05"], "time", "num", "text"], columns: ["股票", "交易日", "時間", "最新價", "漲跌"], need: [0, 1, 2, 3] },
  guestNote: "訪客練習是暫時的；大廳說明寫著：建立個人帳號後，訪客的練習會搬進帳號。",
  can: "我能自己進入教室、開始一輪回放，並讀出一檔股票的最新價與時間。",
  next: "LEVEL 01（約 40 分鐘）：建立你的帳號，讓每一輪練習都保存下來。",
};
