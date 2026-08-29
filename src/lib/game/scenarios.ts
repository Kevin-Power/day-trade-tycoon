import type { TapeDay } from "@/lib/market/tape-types";
import { formatIndex } from "@/lib/market/week";

export type Scenario = {
  id: string;
  name: string;
  tag: string;
  blurb: string;
  objective: string;
  minutes: number;
  startMinute: number;
  speed: number;
  capital: number;
  allowShort: boolean;
  leverage: number;
  seed: number;
  sessionId: string;
  indexDrift: number;
  indexVol: number;
  shock?: { atMinute: number; ret: number; headline: string };
  coach: string[];
};

export const SCENARIOS: Scenario[] = [
  {
    id: "wed-open",
    name: "8/26 開盤觀察",
    tag: "本週 · 建議先打",
    blurb: "週三實盤前 45 分鐘。開盤 20 秒內急殺至 44,926，再拉回。最慢速，看五檔再出手。",
    objective: "完成一筆獲利當沖，回撤不超過 2%。",
    minutes: 45,
    startMinute: 0,
    speed: 4,
    capital: 1_000_000,
    allowShort: false,
    leverage: 1,
    seed: 8261,
    sessionId: "wed",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "這是 8/26 證交所 5 秒指數：09:00:20 探 44,926，再翻紅。不要追第一根。",
      "當沖來回成本約 0.32%，價差不夠就不要出手。",
      "單筆部位建議不超過權益的 30%。",
    ],
  },
  {
    id: "mon",
    name: "8/24 週一殺盤",
    tag: "本週 · 下跌",
    blurb: "週一實盤。開 45,240、高 45,362，收在最低 44,762，跌 462 點。練的是不接飛刀。",
    objective: "避開攤平，收盤前平倉，回撤小於 4%。",
    minutes: 270,
    startMinute: 0,
    speed: 8,
    capital: 2_000_000,
    allowShort: true,
    leverage: 1,
    seed: 8241,
    sessionId: "mon",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "開高走低收在最低，這種日子先賣比先買容易。",
      "量縮下跌不要抄底。等分價表出現堆積再考慮。",
      "收盤前十分鐘未平倉，系統將市價出場。",
    ],
  },
  {
    id: "tue-dump",
    name: "8/25 早盤下殺",
    tag: "本週 · 停損",
    blurb: "週二實盤前 90 分鐘。開盤 20 秒殺到 44,422，全日低點 44,210 要到 11:00。先練停損。",
    objective: "低點出現後 10 分鐘內把風險降下來。",
    minutes: 90,
    startMinute: 0,
    speed: 6,
    capital: 2_000_000,
    allowShort: true,
    leverage: 1,
    seed: 8251,
    sessionId: "tue",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "早盤殺盤看的是反應，不是預測低點。",
      "南亞科那天早盤暴跌後才止穩，第一根反彈不一定是底。",
      "部位先小，活著才有週二午後的 V 轉。",
    ],
  },
  {
    id: "tue-v",
    name: "8/25 V轉翻紅",
    tag: "本週 · 反轉",
    blurb: "週二 10:00 起。11:00 才印出 44,210，之後收到 45,169、收在最高。練順勢，不要猜左肩。",
    objective: "順勢至少抱 15 分鐘，獲利大於費稅三倍。",
    minutes: 210,
    startMinute: 60,
    speed: 8,
    capital: 2_000_000,
    allowShort: true,
    leverage: 1,
    seed: 8252,
    sessionId: "tue",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "V 轉確認後才加碼，不要在左肩猜底。",
      "金融先翻紅、電子午後接棒，這是當天的節奏。",
      "收在最高不代表明天續漲，當沖還是要平。",
    ],
  },
  {
    id: "wed",
    name: "8/26 週三攻高",
    tag: "本週 · 今日",
    blurb: "週三全日實盤。開 45,158、高 45,878、收 45,833，漲 663 點 +1.47%。權值帶動。",
    objective: "全日報酬為正，回撤小於 3%，收盤前自行平倉。",
    minutes: 270,
    startMinute: 0,
    speed: 8,
    capital: 2_000_000,
    allowShort: true,
    leverage: 1,
    seed: 8262,
    sessionId: "wed",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "今天不是一路噴，開盤先回測再攻。等站上昨收再跟。",
      "台積電翻紅後供應鏈才有量，不要提前追。",
      "漲 600 點的日子一樣有回檔，停利比停損更難。",
    ],
  },
  {
    id: "tycoon",
    name: "8/26 全日大富翁",
    tag: "期末考",
    blurb: "同一支週三實盤，本金 500 萬、2 倍額度。放慢走完 09:00–13:30，看你能不能當沖致富。",
    objective: "全日報酬為正，回撤小於 5%，且收盤前自行平倉。",
    minutes: 270,
    startMinute: 0,
    speed: 6,
    capital: 5_000_000,
    allowShort: true,
    leverage: 2,
    seed: 8263,
    sessionId: "wed",
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "2 倍額度會放大錯誤。先用週三開盤那 45 分鐘熱身。",
      "實盤路徑不會改：低點在 09:00:20，高點在尾盤前。",
      "收盤前十分鐘未平倉，系統將市價出場。",
    ],
  },
];

const liveScenarios = new Map<string, Scenario>();

export function makeLiveScenario(day: TapeDay, kind: "full" | "open"): Scenario {
  const chg = day.close - day.prevClose;
  const pct = (chg / day.prevClose) * 100;
  const seed = Number(day.date.replaceAll("-", "")) % 1_000_000;
  if (kind === "open") {
    return {
      id: `live-open-${day.id}`,
      name: `${day.label} 開盤 45 分`,
      tag: "每日實盤",
      blurb: `證交所 5 秒指數前 45 分鐘。開 ${formatIndex(day.open)}。自由練習，沒有課綱暫停。`,
      objective: "看懂開盤節奏，完成一筆有計畫的當沖。",
      minutes: 45,
      startMinute: 0,
      speed: 4,
      capital: 1_000_000,
      allowShort: false,
      leverage: 1,
      seed: seed + 1,
      sessionId: day.id,
      indexDrift: 0,
      indexVol: 0,
      coach: [
        "這是當天的真實加權 5 秒指數。先看昨收與均價，不要追第一根。",
        "來回約 0.32%。價差不夠就不要出手。",
        "單筆不超過權益 30%。",
      ],
    };
  }
  return {
    id: `live-full-${day.id}`,
    name: `${day.label} 全日練習`,
    tag: "每日實盤",
    blurb: `開 ${formatIndex(day.open)} · 收 ${formatIndex(day.close)}（${chg >= 0 ? "+" : ""}${pct.toFixed(2)}%）。自由練習，規則自己執行。`,
    objective: "全日報酬為正，回撤小於 4%，收盤前自行平倉。",
    minutes: 270,
    startMinute: 0,
    speed: 8,
    capital: 2_000_000,
    allowShort: true,
    leverage: 1,
    seed,
    sessionId: day.id,
    indexDrift: 0,
    indexVol: 0,
    coach: [
      "這是證交所 5 秒指數。先看昨收與均價，不要追第一根。",
      "來回約 0.32%。價差不夠就不要出手。",
      "收盤前自行平倉。未平倉將市價出場。",
    ],
  };
}

export function registerLiveScenarios(days: TapeDay[]) {
  for (const day of days) {
    const full = makeLiveScenario(day, "full");
    const open = makeLiveScenario(day, "open");
    liveScenarios.set(full.id, full);
    liveScenarios.set(open.id, open);
  }
}

export function scenarioById(id: string): Scenario | undefined {
  return liveScenarios.get(id) ?? SCENARIOS.find((s) => s.id === id);
}

export const RANKS: { min: number; title: string; need: string }[] = [
  { min: Number.NEGATIVE_INFINITY, title: "見習生", need: "完成第一盤" },
  { min: 1, title: "當沖學員", need: "生涯損益轉正" },
  { min: 50_000, title: "盤勢觀察員", need: "累計 +5 萬" },
  { min: 150_000, title: "當沖高手", need: "累計 +15 萬" },
  { min: 400_000, title: "市場作手", need: "累計 +40 萬" },
  { min: 1_000_000, title: "當沖大富翁", need: "累計 +100 萬" },
];

export function rankFor(careerPnl: number) {
  let current = RANKS[0]!;
  for (const r of RANKS) {
    if (careerPnl >= r.min) current = r;
  }
  return current;
}

export function nextRank(careerPnl: number) {
  const current = rankFor(careerPnl);
  const idx = RANKS.findIndex((r) => r.title === current.title);
  return RANKS[idx + 1] ?? null;
}

export function gradeFor(pnlPct: number, trades: number, maxDd: number): string {
  if (trades === 0) return "觀盤";
  if (pnlPct >= 2 && maxDd <= 0.02) return "S";
  if (pnlPct >= 1) return "A";
  if (pnlPct >= 0.3) return "B";
  if (pnlPct >= 0) return "C";
  if (pnlPct > -1) return "D";
  return "F";
}
