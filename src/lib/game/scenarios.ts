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
    tag: "教材 · 入門",
    blurb: "週三教材盤前 30 分鐘。先認識商品、委託與成交；可以暫停核對，條件未到也可以繼續觀察。",
    objective: "完成一筆獲利當沖，回撤不超過 2%。",
    minutes: 30,
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
      "先讀出目前商品與模擬時間，再對照昨收和均價；後面的走勢還要繼續觀察。",
      "查看成交明細的手續費與交易稅。買賣價格相同，也可能因成本而虧損。",
      "本課用模擬權益 30% 提醒部位大小；先核對張數，這不是個人的安全額度。",
    ],
  },
  {
    id: "mon",
    name: "8/24 週一殺盤",
    tag: "教材 · 風險紀律",
    blurb: "週一歷史教材。練習在價格變動時核對庫存與原定出場條件，並用成交紀錄說明自己的選擇。",
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
      "目前價格與昨收的關係，是可見的狀態；不能只靠它判定接下來的方向。",
      "若有庫存，先回看原定出場條件；沒有符合進場條件時，可以繼續觀察。",
      "收尾時先核對待成交委託與庫存。平倉按鈕不保證全部成交，仍要查剩餘張數。",
    ],
  },
  {
    id: "tue-dump",
    name: "8/25 早盤下殺",
    tag: "教材 · 停損練習",
    blurb: "週二教材盤 09:00–11:10。先寫出場條件，再核對條件出現時的實際操作；沒有庫存也可練習辨識狀態。",
    objective: "低點出現後 10 分鐘內把風險降下來。",
    minutes: 130,
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
      "先說出原定的出場條件，再對照目前價格；現在還不能知道全日最低點。",
      "查看已成交與尚待成交張數。取消委託只處理未成交部分，不會清掉已有庫存。",
      "操作後回到庫存與成交確認結果，不用增加交易次數來證明有練習。",
    ],
  },
  {
    id: "tue-v",
    name: "8/25 V轉翻紅",
    tag: "教材 · 耐心與出場",
    blurb: "週二 10:00 起的歷史教材。練習等待自己事先設定的條件，記下持有或出場理由，結束後核對時間與費稅。",
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
      "把目前走勢和原計畫分開看。價格回升不等於之後一定繼續上漲。",
      "有庫存時，核對持有時間與出場條件；不用為了教材挑戰拖延原定的出場。",
      "用成交紀錄確認進出時間與費稅，說明自己為什麼等待或出場。",
    ],
  },
  {
    id: "wed",
    name: "8/26 週三攻高",
    tag: "教材 · 收尾練習",
    blurb: "週三全日歷史教材。依模擬時間安排收尾，核對未成交委託、處理部位，再確認結束時留下哪些紀錄。",
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
      "先看畫面上的模擬時間；歷史教材不是現在市場的即時走勢。",
      "一檔商品的漲跌不能代替另一檔的條件。先核對自己選的商品與計畫。",
      "收尾前查看委託、成交與庫存。用剩餘張數確認結果，不只看損益。",
    ],
  },
  {
    id: "tycoon",
    name: "8/26 全日大富翁",
    tag: "期末考",
    blurb: "同一支週三教材盤，本金 500 萬、2 倍額度。放慢走完 09:00–13:30，練習守住規則完成全天。",
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
      "這盤是 2 倍模擬額度。可用額度增加，不表示必須增加張數。",
      "這是固定歷史教材。依當下畫面核對事前條件，不把記得後續走勢當成判斷能力。",
      "收尾時自行核對待單及庫存；系統嘗試平倉後仍可能留有部位，請查看結算紀錄。",
    ],
  },
];

const liveScenarios = new Map<string, Scenario>();

export function makeLiveScenario(day: TapeDay, kind: "full" | "open"): Scenario {
  const seed = Number(day.date.replaceAll("-", "")) % 1_000_000;
  if (kind === "open") {
    return {
      id: `live-open-${day.id}`,
      name: `${day.label} 開盤 45 分`,
      tag: "歷史教材",
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
        "指數取自所選歷史教材，個股撮合為教室模擬。先核對商品、時間及自己的條件。",
        "核對成交明細的手續費與交易稅，不用單一百分比代替每筆實際模擬成本。",
        "部位提醒以模擬權益計算；不是個人的安全額度。未符合條件時可以不送單。",
      ],
    };
  }
  return {
    id: `live-full-${day.id}`,
    name: `${day.label} 全日練習`,
    tag: "歷史教材",
    blurb: `開 ${formatIndex(day.open)}。全日歷史教材自由練習；先留下條件，結束後再用紀錄回看自己的操作。`,
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
      "指數取自所選歷史教材，個股撮合為教室模擬。先看當下可見資料再決定。",
      "核對成交明細的手續費與交易稅，將成本列入復盤。",
      "收尾時先查未成交委託，再處理庫存；平倉後核對成交及剩餘張數。",
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
