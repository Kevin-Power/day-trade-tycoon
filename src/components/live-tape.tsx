import { RealCandlesLink } from "@/components/real-candles-entry";

const CLASSROOM_OFFLINE = import.meta.env.BASE_URL === "./";

export function LiveTape() {
  return (
    <section
      className="mb-4 rounded-xl border border-border bg-bg p-4"
      aria-labelledby="additional-market-title"
    >
      <h3 id="additional-market-title" className="text-lg font-semibold">
        其他日期待補真實分鐘行情
      </h3>
      <p className="mt-2 text-base leading-relaxed text-muted">
        日開高低收或大盤指數不能替代個股真實分鐘
        K。原「每日實盤」生成練習已停止，也不再以日資料建立新的模擬盤。
      </p>
      {CLASSROOM_OFFLINE ? (
        <p className="mt-3 text-base leading-relaxed text-muted">
          離線包僅供閱讀教材、固定委託範例與歷史紀錄。真實回放需要連線。
        </p>
      ) : (
        <div className="mt-4">
          <RealCandlesLink>開啟已提供的真實 K 教材</RealCandlesLink>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            目前僅 2026/10/06、5 檔股票、09:00–10:30；不是每日自動更新或即時行情。
          </p>
        </div>
      )}
    </section>
  );
}
