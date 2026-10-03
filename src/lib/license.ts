/** Buyer-facing classroom package copy. No invented NT$ prices. */

export const LICENSE_VERSION = "2026-10-04";
export const LICENSE_QUOTE = "洽教室／講師報價";
export const LICENSE_TITLE = "從第一筆有計畫的操作開始";

export const LICENSE_INCLUDED = [
  {
    id: "sim",
    title: "模擬教室",
    body: "熟悉行情、江波圖、五檔與委託畫面，練習核對成交、庫存及交易成本。所有操作均在模擬環境中進行。",
  },
  {
    id: "curriculum",
    title: "課綱",
    body: "六組課程任務分成入門操作、風險紀律與自主練習。每課都有練習目標、三個步驟與復盤提問，可搭配講師帶班反覆練習。",
  },
  {
    id: "offline",
    title: "地端包",
    body: "提供 Windows 電腦使用的離線教材包，大廳可下載。解壓後執行 START.bat，即可練習內建教材情境；離線包不更新最新行情。",
  },
  {
    id: "manual",
    title: "說明書",
    body: "從登入、第一筆操作到復盤的使用說明，也交代資料來源與模擬限制。提供線上閱讀、列印與 PDF 下載。",
  },
] as const;

export const LICENSE_EXCLUDED = [
  {
    id: "live",
    title: "實盤下單",
    body: "目前沒有連接券商真實交易帳戶。富邦 API 為後續串接方向，尚未提供實盤下單服務。",
  },
  {
    id: "advisory",
    title: "投顧、訊號、代操",
    body: "課程練習觀察、操作與復盤，不提供買賣訊號、代操或個別投資建議。",
  },
  {
    id: "guarantee",
    title: "保證獲利",
    body: "模擬成績與學習足跡不能代表實盤獲利能力。課程不保證報酬，也不以一次賺賠判定是否學會。",
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
  "講師帶著看，自己動手練，做完再一起復盤。用六組課程任務，循序練習進場計畫、委託核對、風險控制與收尾。每次先做好一個動作，再決定下一步。";

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
