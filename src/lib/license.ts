/** Buyer-facing classroom package copy. No invented NT$ prices. */

export const LICENSE_VERSION = "2026-09-21";
export const LICENSE_QUOTE = "洽教室／講師報價";
export const LICENSE_TITLE = "教室授權／班級方案";

export const LICENSE_INCLUDED = [
  {
    id: "sim",
    title: "模擬教室",
    body: "券商風格盤面：自選、江波、五檔、委託、庫存／成交。模擬撮合已開，費稅與收盤強平在教室裡算完。",
  },
  {
    id: "curriculum",
    title: "課綱",
    body: "教材週凍結 2026/08/24–08/26。六課加期末考，當沖六式每盤都用。線上另有交易日收盤後的自由練習。",
  },
  {
    id: "offline",
    title: "地端包",
    body: "大廳可下載。解壓後雙擊 START.bat，教室電腦不必連網。地端只內建教材週，不會去抓最新盤。",
  },
  {
    id: "manual",
    title: "說明書",
    body: "學員怎麼玩、資料哪裡來、模擬跟實盤差在哪。可列印，也可下載 PDF。",
  },
] as const;

export const LICENSE_EXCLUDED = [
  {
    id: "live",
    title: "實盤下單",
    body: "委託單上看得到「實盤」，點了不會送到券商。教室下單仍走模擬撮合。",
  },
  {
    id: "advisory",
    title: "投顧、訊號、代操",
    body: "這不是進出場訊號，也不是代操。講師帶打是教學，不是勸誘下單。",
  },
  {
    id: "guarantee",
    title: "保證獲利",
    body: "教室成績不能外推到實盤。沒有保證會賺、沒有保證能過當沖考試。",
  },
] as const;

export const LICENSE_SKUS = [
  {
    id: "online",
    name: "線上班級授權",
    includes: "模擬教室、課綱、說明書、線上自由練習",
    quote: LICENSE_QUOTE,
  },
  {
    id: "offline",
    name: "地端教室包",
    includes: "模擬教室、課綱、說明書、離線教材週",
    quote: LICENSE_QUOTE,
  },
  {
    id: "bundle",
    name: "線上＋地端",
    includes: "上面兩包都有。規則同一套，不要講成兩個版本。",
    quote: LICENSE_QUOTE,
  },
] as const;

export const SEAT_TODAY =
  "今天是全班同一組入場密碼，講師發給學員。軟體不管人數上限，戰績存在該機瀏覽器。授權先按「班級／地端包」談，不是按登入人頭。";

export const SEAT_ROADMAP =
  "之後才做每人一個帳號、講師看全班。那是路線圖，還沒做。在那之前，不要對外講「已經有席次帳號」。";

export const LICENSE_LEAD =
  "當沖大富翁賣的是教室，不是券商、不是投顧、不是保證獲利。這一頁給金主、講師、要開班的人看：這包有什麼、沒有什麼、席次怎麼算、報價找誰。";

export const LICENSE_ONE_LINER = "一句話：先賣教室。實盤是下一張合約，不該擋這一期開課。";

export const LICENSE_PRICING_NOTE =
  "報價欄是預留。沒有官價、沒有早鳥、沒有一班多少錢。數字在講師那邊，這一頁只寫「洽教室／講師報價」。";

export const LICENSE_PAYMENT_NOTE =
  "沒有線上刷卡，也沒有 LINE Pay。班費怎麼收（現場、匯款、其他）由教室決定。這一頁不接金流。";

export function licensePlainText(): string {
  const parts = [
    LICENSE_TITLE,
    LICENSE_LEAD,
    LICENSE_ONE_LINER,
    LICENSE_QUOTE,
    LICENSE_PRICING_NOTE,
    LICENSE_PAYMENT_NOTE,
    SEAT_TODAY,
    SEAT_ROADMAP,
    ...LICENSE_INCLUDED.flatMap((x) => [x.title, x.body]),
    ...LICENSE_EXCLUDED.flatMap((x) => [x.title, x.body]),
    ...LICENSE_SKUS.flatMap((x) => [x.name, x.includes, x.quote]),
  ];
  return parts.join("\n");
}
