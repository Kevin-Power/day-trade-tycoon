import { useState } from "react";
import { Arrow, toneClass } from "@/components/signed";
import { ProvenanceBadge, ProvenanceMicro } from "@/components/provenance";
import { useGame } from "@/lib/game/store";
import { formatPrice } from "@/lib/market/ticks";
import { freezeWeekLabel, officialWatchlistMicro } from "@/lib/provenance";
import { cn, formatLots } from "@/lib/utils";
import { CATALOGUE_COUNT, searchStocks } from "@/lib/market/universe";
import { stockDayFor } from "@/lib/market/real-paths";

type ListTab = "all" | "tse" | "otc";

const TABS: { id: ListTab; label: string }[] = [
  { id: "all", label: "自選" },
  { id: "tse", label: "上市" },
  { id: "otc", label: "上櫃" },
];

function chg(n: number) {
  const abs = Math.abs(n).toFixed(2);
  if (n > 0) return `+${abs}`;
  if (n < 0) return `-${abs}`;
  return abs;
}

export function Watchlist() {
  const engine = useGame((s) => s.engine);
  const selected = useGame((s) => s.selected);
  const select = useGame((s) => s.select);
  const frame = useGame((s) => s.frame);
  const [tab, setTab] = useState<ListTab>("all");
  const [query, setQuery] = useState("");
  const [detailed, setDetailed] = useState(false);
  void frame;
  const quotes = (engine?.allQuotes() ?? []).filter((q) => tab === "all" || q.market === tab);
  const results = query.trim() ? searchStocks(query, tab === "all" ? undefined : tab) : [];

  return (
    <div className="term-scroll flex h-full min-h-0 flex-col overflow-x-hidden overflow-y-auto bg-bg lg:overflow-visible">
      <div className="pane-title flex shrink-0 flex-wrap items-center gap-1 px-2 lg:h-7 lg:flex-nowrap lg:gap-0.5 lg:px-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={cn(
              "min-h-12 rounded-md px-3 text-base tracking-wide lg:min-h-0 lg:h-6 lg:rounded-xs lg:px-2 lg:text-micro",
              tab === t.id ? "bg-header-2 text-fg" : "text-fg/70 hover:text-fg",
            )}
          >
            {t.label}
          </button>
        ))}
        <span className="px-1 text-base text-fg/80 lg:ml-auto lg:text-micro">
          {engine?.session.label} · {quotes.length} 檔
        </span>
        <ProvenanceBadge kind="official" className="text-sm lg:text-2xs" />
      </div>
      <ProvenanceMicro text={officialWatchlistMicro(freezeWeekLabel(engine?.session.date))} className="shrink-0 text-sm lg:text-2xs" />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-2 py-2 lg:flex-nowrap lg:py-1">
        <input aria-label="搜尋上市櫃" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder={`搜尋 ${CATALOGUE_COUNT} 檔代號或名稱`} autoComplete="off"
          className="h-12 min-w-0 flex-1 basis-48 rounded-md bg-surface px-2 text-base text-fg placeholder:text-subtle lg:h-10 lg:basis-auto lg:text-sm" />
        <button type="button" aria-pressed={detailed} onClick={() => setDetailed(value => !value)}
          className="min-h-12 shrink-0 rounded-md border border-border px-3 text-base text-muted hover:bg-elevated lg:min-h-10 lg:border-0 lg:px-2 lg:text-xs">
          <span className="lg:hidden">{detailed ? "返回商品卡片" : "詳細行情表"}</span>
          <span className="hidden lg:inline">{detailed ? "精簡欄位" : "詳細欄位"}</span>
        </button>
      </div>
      {query.trim() ? <div className="term-scroll shrink-0 lg:min-h-0 lg:flex-1 lg:overflow-auto">
        <p className="px-3 py-2 text-base leading-relaxed text-muted lg:px-2 lg:py-1 lg:text-micro">教材週名稱目錄；有當日教材資料才能加入模擬。</p>
        {results.length === 0 && <p className="p-3 text-base text-muted lg:text-xs">沒有符合的商品。</p>}
        {results.map((item) => {
          const available = engine && stockDayFor(item.code, engine.session.id);
          return <button key={item.code} type="button" disabled={!available}
            onClick={() => { select(item.code); setQuery(""); }}
            className="flex min-h-14 w-full flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-3 text-left text-base hover:bg-elevated disabled:opacity-60 lg:min-h-0 lg:py-2 lg:text-xs">
            <span><span className="mr-2 font-mono text-muted">{item.code}</span>{item.name}</span>
            <span className="text-base text-muted lg:text-micro">{available ? "選取並看走勢" : "此日無資料"}</span>
          </button>;
        })}
      </div> : <>
      <div className="term-scroll shrink-0 overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-auto">
        {!detailed && (
          <div className="space-y-3 p-3 lg:hidden">
            <p className="text-base leading-relaxed text-muted">先選商品看走勢，再到「模擬下單」填寫委託。</p>
            {quotes.length === 0 && <p className="py-6 text-base text-muted">這一欄沒有商品。改選「自選」或「上市」。</p>}
            {quotes.map((q) => {
              const active = q.code === selected;
              return (
                <article key={q.code} className={cn("rounded-xl border bg-surface p-3 text-base", active ? "border-brand bg-brand/5" : "border-border")}>
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-mono text-muted">{q.code}</span>
                    <h3 className="text-lg font-semibold text-fg">{q.name}</h3>
                    {active && <span className="ml-auto text-base font-medium text-brand">目前選取</span>}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    <div>
                      <dt className="text-muted">目前模擬價</dt>
                      <dd className={cn("mt-1 break-words font-mono text-xl font-semibold tabular", toneClass(q.change))}>{formatPrice(q.last)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">累計成交量</dt>
                      <dd className="mt-1 break-words font-mono tabular">{formatLots(q.volume)} 張</dd>
                    </div>
                    <div>
                      <dt className="text-muted">漲跌</dt>
                      <dd className={cn("mt-1 break-words font-mono tabular", toneClass(q.change))}><Arrow n={q.change} /> {chg(q.change)}</dd>
                    </div>
                    <div>
                      <dt className="text-muted">漲幅</dt>
                      <dd className={cn("mt-1 break-words font-mono tabular", toneClass(q.changePct))}>{chg(q.changePct)}%</dd>
                    </div>
                  </dl>
                  <button type="button" aria-label={`選取 ${q.code} ${q.name} 並看走勢`} aria-pressed={active}
                    onClick={() => select(q.code)}
                    className="mt-3 min-h-12 w-full rounded-lg border border-brand bg-brand/10 px-3 py-2 text-base font-medium text-brand hover:bg-brand/15">
                    選取並看走勢
                  </button>
                </article>
              );
            })}
          </div>
        )}
        {detailed && <p className="sticky left-0 px-3 py-2 text-base leading-relaxed text-muted lg:hidden">可左右滑動查看完整欄位；按商品名稱可看走勢。</p>}
        <table className={cn("w-full border-collapse font-mono text-base lg:text-xs", detailed ? "min-w-watchlist max-lg:[&_th]:table-cell max-lg:[&_td]:table-cell" : "watchlist-compact hidden lg:table")}>
          <caption className="sr-only">模擬行情。選擇商品可切換至走勢圖。</caption>
          <thead className="sticky top-0 z-10 bg-header-2 text-fg">
            <tr className="text-left">
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">商品</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium md:table-cell">買進</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium md:table-cell">賣出</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">成交</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">漲跌</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">漲幅%</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">單量</th>
              <th className="whitespace-nowrap px-1.5 py-1 font-medium">總量</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">委買</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium lg:table-cell">委賣</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">昨收</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">內盤</th>
              <th className="hidden whitespace-nowrap px-1.5 py-1 font-medium xl:table-cell">外盤</th>
            </tr>
          </thead>
          <tbody>
            {quotes.length === 0 && (
              <tr>
                <td colSpan={13} className="px-2 py-8 text-center font-sans text-xs text-muted">
                  這一欄沒有商品。改選「自選」或「上市」。
                </td>
              </tr>
            )}
            {quotes.map((q) => {
              const active = q.code === selected;
              const flash = q.flash === 1 ? "flash-up" : q.flash === -1 ? "flash-down" : "";
              const limitCls = q.atLimitUp ? "bg-up text-white" : q.atLimitDown ? "bg-down text-white" : "";
              const ch = toneClass(q.change);
              return (
                <tr
                  key={q.code}
                  onClick={() => select(q.code)}
                  className={cn(
                    "cursor-pointer border-b border-border/80 hover:bg-elevated/80",
                    active && "bg-header/40",
                    flash,
                  )}
                >
                  <td className="whitespace-nowrap px-1.5 py-0.5">
                    <button type="button" aria-label={`選擇 ${q.code} ${q.name}`} aria-pressed={active}
                      onClick={event => { event.stopPropagation(); select(q.code); }} className="min-h-12 w-full rounded text-left lg:min-h-0">
                    <span className="flex items-baseline gap-1.5">
                      <span className="text-muted">{q.code}</span>
                      <span className="font-sans text-base text-fg lg:text-xs">{q.name}</span>
                    </span>
                    </button>
                  </td>
                  <td className={cn("hidden whitespace-nowrap px-1.5 py-0.5 tabular md:table-cell", ch, limitCls)}>
                    {formatPrice(q.bid)}
                  </td>
                  <td className={cn("hidden whitespace-nowrap px-1.5 py-0.5 tabular md:table-cell", ch, limitCls)}>
                    {formatPrice(q.ask)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-0.5 tabular font-medium", ch, limitCls)}>
                    {formatPrice(q.last)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-0.5 tabular", ch)}>
                    <Arrow n={q.change} /> {chg(q.change)}
                  </td>
                  <td className={cn("whitespace-nowrap px-1.5 py-0.5 tabular", toneClass(q.changePct))}>
                    {chg(q.changePct)}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-muted lg:table-cell">
                    {formatLots(q.tickLots)}
                  </td>
                  <td className="whitespace-nowrap px-1.5 py-0.5 tabular">{formatLots(q.volume)}</td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-down lg:table-cell">
                    {formatLots(q.bidLots)}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-up lg:table-cell">
                    {formatLots(q.askLots)}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-muted xl:table-cell">
                    {formatPrice(q.prevClose)}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-down xl:table-cell">
                    {formatLots(q.inner)}
                  </td>
                  <td className="hidden whitespace-nowrap px-1.5 py-0.5 tabular text-up xl:table-cell">
                    {formatLots(q.outer)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>}
    </div>
  );
}
