import { RealCandlesLink } from "@/components/real-candles-entry";

const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

export function LiveTape() {
  return (
    <section
      className="mb-4 rounded-xl border border-border bg-bg p-4"
      aria-labelledby="additional-market-title"
    >
      <h3 id="additional-market-title" className="text-lg font-semibold">
        每日真實行情教材
      </h3>
      <p className="mt-2 text-base leading-relaxed text-muted">
        日開高低收或大盤指數不能替代個股的真實成交。原「每日實盤」生成練習已停止，也不再以日資料建立新的模擬盤。
      </p>
      {CLASSROOM_OFFLINE ? (
        <p className="mt-3 text-base leading-relaxed text-muted">
          離線包僅供閱讀教材、固定委託範例與歷史紀錄。真實回放需要連線。
        </p>
      ) : (
        <div className="mt-4">
          <RealCandlesLink>開啟每日真實行情教材</RealCandlesLink>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            從 2026/10/21 起，每個交易日收盤後多一堂富邦的真實逐筆教材（09:00–10:30，每局 1 到 80 檔）；不是即時行情。
          </p>
        </div>
      )}
    </section>
  );
}
