import type { Side } from "@/lib/game/types";

export type LessonBeat = {
  atMinute: number;
  title: string;
  body: string;
  hint: string;
};

export type Lesson = {
  id: string;
  no: string;
  skill: string;
  principle: string;
  prep: string[];
  beats: LessonBeat[];
  review: string[];
};

/** 教室六式：每盤都用，不隨關卡改。 */
export const PRINCIPLES: { no: string; title: string; body: string }[] = [
  { no: "01", title: "先算成本", body: "來回約 0.32%。價差不夠費稅，這筆就不該出手。" },
  { no: "02", title: "江波對昨收", body: "黃虛線是平盤。紅在上、綠在下，不預測，只反應。" },
  { no: "03", title: "五檔與分價", body: "堆積處才是支撐壓力。沒有量的反彈，不要當成底。" },
  { no: "04", title: "停損寫在進場", body: "進場同時決定出場。虧了再想，一定想太慢。" },
  { no: "05", title: "部位三成", body: "單檔不超過權益 30%。活著才有下一筆。" },
  { no: "06", title: "收盤前平倉", body: "當沖不是投資。13:20 還沒平，就是紀律破了。" },
];

export const LESSONS: Lesson[] = [
  {
    id: "wed-open",
    no: "第 1 課",
    skill: "成本與第一槍",
    principle: "開盤先看昨收與均價，不追第一根。",
    prep: [
      "江波黃虛線＝昨收。站上才考慮先買。",
      "來回 0.32%，第一槍要蓋得過費稅。",
      "單筆不超過權益 30%。張數先小。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "開盤觀察：先看線，再出手",
        body: "這是 8/26 證交所 5 秒指數前 45 分鐘。09:00:20 急殺至 44,926，再拉回。江波上看昨收（黃）與均價（藍）。第一根量能通常是雜訊。",
        hint: "選台積電，對照昨收。不要在 09:00 追價。",
      },
      {
        atMinute: 1,
        title: "低點已印在 09:00:20",
        body: "加權最低 44,926 就在開盤 20 秒。現在是回升段。江波若站回昨收，才是第一筆的條件。沒站上，空手也是功課。",
        hint: "站上昨收再掛；沒站上就看，不要攤。",
      },
      {
        atMinute: 10,
        title: "回測後的觀察",
        body: "低點已過，買盤還沒站穩。把這個分鐘的反彈當成底，就是在猜。分價表若沒有堆積，那不是支撐。",
        hint: "看五檔有沒有買盤變厚，而不是看感覺。",
      },
      {
        atMinute: 36,
        title: "檢查費稅",
        body: "若已進場，問兩件事：這筆有沒有蓋過 0.32%？部位有沒有超過 30%？沒有就平，不要加碼報復。",
        hint: "看均價與成本線。不夠就出場。",
      },
    ],
    review: [
      "第一槍有沒有等江波站上昨收。",
      "獲利有沒有被費稅吃掉。",
      "張數有沒有超過權益三成。",
    ],
  },
  {
    id: "mon",
    no: "第 2 課",
    skill: "不接飛刀",
    principle: "開高走低的日子，先賣比先買容易。",
    prep: [
      "週一收在最低 44,762。不要用攤平對抗趨勢。",
      "江波在昨收下方，先假設空方。",
      "量縮下跌不是便宜，是沒人接。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "開高不是多",
        body: "8/24 開 45,240。證交所 5 秒指數顯示高點 45,362 在 09:43，之後開高走低、收在最低 44,762。第一個衝動是追，正確的是等翻黑再決定要不要先賣。",
        hint: "江波若跌破昨收，不要在下方加買。",
      },
      {
        atMinute: 43,
        title: "高點已過",
        body: "09:43 印出全日高。台積電這天開平走低。這時買進是接飛刀。空手或先賣，比抄底重要。",
        hint: "看內外盤。外盤轉弱就不要逆勢加碼。",
      },
      {
        atMinute: 60,
        title: "失守整數",
        body: "約 09:59 加權失守 45,000。整數破了還去撿，是在跟趨勢作對。等分價表出現明顯堆積，才有資格談反彈。",
        hint: "打開分價。沒有堆，就還不是底。",
      },
      {
        atMinute: 200,
        title: "貼近最低",
        body: "午後無反攻量能，低點在尾盤 13:25 附近。這種日子收盤前平倉，不要把當沖做成隔夜信仰。",
        hint: "13:20 前把庫存清掉。",
      },
    ],
    review: [
      "有沒有在昨收下方攤平。",
      "先賣有沒有比先買容易。",
      "收盤前有沒有自己平倉。",
    ],
  },
  {
    id: "tue-dump",
    no: "第 3 課",
    skill: "停損紀律",
    principle: "停損寫在進場時，不是虧了再想。",
    prep: [
      "週二開盤 20 秒殺到 44,422。全日低點 44,210 在 11:00，這課先練停損。",
      "部位先小。活著才有午後 V 轉。",
      "進場同時決定：破哪裡就出。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "低開先寫停損",
        body: "隔夜弱、低開 44,728。前 20 秒就到 44,422。進場前先決定張數與出場價，不要等虧了才找理由。",
        hint: "張數先 1–2 張。停損想好再掛。",
      },
      {
        atMinute: 8,
        title: "再殺，還不是底",
        body: "早盤已到 44,273 一帶。全日低點 44,210 要到 11:00。這段不是找底的時間，是看你會不會砍。",
        hint: "虧的部位降張數，不要加碼攤平。",
      },
      {
        atMinute: 52,
        title: "反彈不是 V 轉",
        body: "這時指數彈到 44,400 附近，不是底。把反彈當轉折，教室裡可以，實盤會爆。",
        hint: "看分價堆積。沒有量就還不是支撐。",
      },
      {
        atMinute: 70,
        title: "還在磨，不要加碼",
        body: "10:10 仍在 44,300 一帶磨。這是減碼後的觀察區，不是立刻把張數加回來。低點留給下一課。",
        hint: "小部位跟上即可，把子彈留給 V 轉那課。",
      },
    ],
    review: [
      "進場時有沒有預先寫停損。",
      "有沒有在下跌中攤平。",
      "低點出現後 10 分鐘內風險有沒有降下來。",
    ],
  },
  {
    id: "tue-v",
    no: "第 4 課",
    skill: "順勢抱單",
    principle: "V 轉確認後才跟，讓利潤跑過費稅三倍。",
    prep: [
      "從 10:00 開始。全日低點還沒印，11:00 才是 44,210。",
      "站上均價再跟，不要猜左肩。",
      "加碼只加已經賺錢的方向。",
    ],
    beats: [
      {
        atMinute: 60,
        title: "10:00，還沒見底",
        body: "週二 10:00。指數仍在 44,400 附近磨。低點 44,210 要到 11:00。現在猜底，是在接飛刀。",
        hint: "對照均價線。沒站上就看。",
      },
      {
        atMinute: 120,
        title: "11:00 印出 44,210",
        body: "全日低點在這一分鐘。印出來還要等站上均價，才是跟的條件。抄這一秒，仍然是猜。",
        hint: "低點出現後先降風險，再等確認。",
      },
      {
        atMinute: 160,
        title: "電子接棒",
        body: "指數自低點回升。台積電由黑翻紅，電子午後走穩。順勢單讓它跑，目標是獲利大於費稅三倍。",
        hint: "有部位且賺錢，才考慮加一成。",
      },
      {
        atMinute: 250,
        title: "收在最高也要平",
        body: "尾盤幾乎收在最高。當沖仍然平倉。收在最高不代表明天續漲。",
        hint: "13:20 前自己平，不要等系統市價。",
      },
    ],
    review: [
      "有沒有等均價確認再跟。",
      "獲利有沒有大於費稅三倍。",
      "有沒有把順勢單做成隔夜。",
    ],
  },
  {
    id: "wed",
    no: "第 5 課",
    skill: "停利比停損難",
    principle: "漲 600 點的日子一樣有回檔，先讓利潤兌現。",
    prep: [
      "週三不是一路噴。先回測再攻。",
      "台積電翻紅，供應鏈才有量。",
      "停利條件事先寫好。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "先回測，再攻",
        body: "8/26 全日。開 45,158，低點在 09:00:20 的 44,926。等江波站上昨收再跟，不要把急殺當成崩盤，也不要追第一下。",
        hint: "和第 1 課同一套：昨收為界。",
      },
      {
        atMinute: 1,
        title: "回測是進場區",
        body: "最低 44,926 已在 09:00:20 印出。這是計畫進場區，不是追價區。沒計畫就不要因為急殺而手癢。",
        hint: "有計畫才掛。沒有就看分價。",
      },
      {
        atMinute: 70,
        title: "權值帶動",
        body: "台積電翻紅帶動供應鏈，加權站上 45,500。這時才輪到跟勢，而不是早上就重倉。",
        hint: "供應鏈有量再考慮第二檔。",
      },
      {
        atMinute: 200,
        title: "攻高超過 600 點",
        body: "盤中最高 45,878。大漲日最容易把當沖改成投資。回檔時停利，不要改故事。",
        hint: "鎖一部分利潤。剩下用成本線守。",
      },
    ],
    review: [
      "有沒有等站上昨收再跟。",
      "大漲時有沒有把當沖改成隔夜。",
      "停利有沒有事先寫好。",
    ],
  },
  {
    id: "tycoon",
    no: "期末考",
    skill: "自己執行規則",
    principle: "2 倍額度放大錯誤。規則不執行，再多課也是觀賞。",
    prep: [
      "本金 500 萬、2 倍額度。錯一次很痛。",
      "六式全部自己勾：成本、昨收、分價、停損、三成、平倉。",
      "教練只提醒，不替你按。",
    ],
    beats: [
      {
        atMinute: 0,
        title: "期末考開始",
        body: "同一支週三實盤，額度放大。低點在 09:00:20，高點在尾盤前，路徑不會改。你的計畫是什麼？寫在進場前。",
        hint: "先把張數算成不超過權益 30%。",
      },
      {
        atMinute: 1,
        title: "低點這一分鐘",
        body: "低點已在 09:00:20 印出。你是按計畫進，還是因為便宜而進？兩者看起來一樣，結果差很多。",
        hint: "回頭看你的計畫。沒有計畫就空手。",
      },
      {
        atMinute: 248,
        title: "高點附近",
        body: "盤中最高在這一帶。期末考最常見的死法：把當沖做成「再抱一下」。",
        hint: "先平一部分。13:20 清完。",
      },
    ],
    review: [
      "額度放大後有沒有把張數一起放大。",
      "低點是計畫還是手癢。",
      "高點有沒有把當沖做成隔夜。",
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
  if (input.trades === 0) tags.push("觀盤");
  let chase = 0;
  for (const f of input.fills) {
    if (!f.vwapAt) continue;
    if (f.side === "buy" && f.price > f.vwapAt * 1.004) chase += 1;
    if (f.side === "sell" && f.price < f.vwapAt * 0.996) chase += 1;
  }
  if (chase > 0) tags.push("追價");
  if (input.trades > 0 && Math.abs(input.pnl) < input.fees * 1.2) tags.push("費稅吃掉");
  if (input.maxDrawdown > 0.04) tags.push("回撤偏大");
  if (input.exposure > input.equity * 0.35) tags.push("部位偏重");
  if (input.pnl > 0 && input.maxDrawdown <= 0.025 && input.trades > 0) tags.push("風控有守");
  if (input.pnl > 0 && chase === 0 && input.trades > 0) tags.push("沒追價");

  let headline = "收盤。把成交對照課綱再打一次。";
  if (input.trades === 0) headline = "這盤只看沒做。觀盤也是功課，下一盤在成本夠的時候出手。";
  else if (tags.includes("追價")) headline = "有追價痕跡。江波在均價上方追，費稅先吃掉一截。";
  else if (tags.includes("費稅吃掉")) headline = "方向對了，但價差不夠來回成本。先等偏離均價再進。";
  else if (tags.includes("回撤偏大")) headline = "回撤偏大。張數先降，讓停損執行得下去。";
  else if (tags.includes("風控有守")) headline = "報酬與回撤都在線上。把同一套規則帶回下一盤。";
  else if (input.pnl > 0) headline = "正期望值。檢查是順勢抱對，還是波動剛好站在你這邊。";
  else if (input.pnl < 0) headline = "這盤虧了。對照課綱：有沒有攤平、有沒有等昨收。";

  return { tags, headline, notes: lesson.review };
}
