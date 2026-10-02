/** Buyer-facing classroom package copy. No invented NT$ prices. */

export const LICENSE_VERSION = "2026-10-02";
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
    body: "教材週凍結 2026/08/24–08/26。五課加一期末考，講師帶班搭配模擬練習與逐筆復盤。線上另有交易日收盤後的自由練習。",
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
    includes: "包含線上教室與地端教材包，使用相同模擬規則。",
    quote: LICENSE_QUOTE,
  },
] as const;

export const SEAT_TODAY =
  "全班同一組入場密碼由講師提供。學員可建立自己的帳號，儲存已提交的模擬復盤；訪客練習只保存在該機瀏覽器。報名資格由教室核對，註冊帳號不代表完成繳費。";

export const SEAT_ROADMAP =
  "每人一個帳號與講師班級檢視已納入教室。授權人數、課程日期與費用由教室確認；線上付款與自動發放繳費權限尚未提供。";

export const LICENSE_LEAD =
  "透過講師帶班、模擬下單與課後復盤，練習進場前的計畫、交易成本與風險控制。適合希望先建立操作紀律，再評估是否參與實際交易的學員。";

export const LICENSE_ONE_LINER = "先在模擬教室練清楚每一筆交易的理由、風險與成本。";

export const LICENSE_PRICING_NOTE =
  "洽教室／講師報價，確認上課日期、費用、名額、使用期間與教材範圍後再報名。";

export const LICENSE_PAYMENT_NOTE =
  "本網站不接金流。付款方式與報名完成通知由教室提供，請先取得教室確認。";

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
