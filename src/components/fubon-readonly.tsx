import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { DeskBar } from "@/components/morning-desk-bar";
import { TickPrice } from "@/components/tick-price";
import { browserStorage } from "@/lib/device-storage";
import type { FeedResponse, FubonRow } from "@/lib/broker/fubon-feed";
import { loginHref } from "@/lib/safe-next";
import "@/fubon-readonly.css";

const STORAGE = "fubon-readonly-watch-v1";
const initialSymbols = ["2330", "2317", "2454"];
const labels = { disabled: "行情尚未設定", connecting: "正在連線", syncing: "正在訂閱", connected: "行情連線正常", reconnecting: "斷線，等候重連", stopped: "連線已暫停，請檢查服務設定" };
const phaseLabels = { continuous: "逐筆交易", trial: "試撮", halted: "暫緩撮合", closed: "收盤" };
const number = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("zh-TW", { maximumFractionDigits: 4 });
const stamp = (us: number | null | undefined) => us ? new Date(us / 1000).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "尚無資料";
const tone = (price: number | null, reference: number | null) => price == null || reference == null || price === reference ? "flat" : price > reference ? "up" : "down";

/** Access check reveals only owner eligibility; it never starts the SDK. */
export function FubonEntry() {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    void fetch("/api/broker/quotes?access=1", { cache: "no-store", signal: abort.signal, credentials: "same-origin" })
      .then(response => { if (!abort.signal.aborted) setAllowed(response.ok); }).catch(() => {});
    return () => abort.abort();
  }, []);
  return allowed ? <Link className="td-home" to="/morning" search={{ feed: "fubon" }}>富邦唯讀行情</Link> : null;
}

function useFeed(symbols: string[]) {
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState("");
  const [received, setReceived] = useState(0);
  const client = useRef<string | null>(null);
  const key = symbols.join(",");
  useEffect(() => {
    client.current ??= crypto.randomUUID();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let active: AbortController | null = null;
    async function poll() {
      if (disposed) return;
      if (document.hidden) { timer = setTimeout(() => void poll(), 2000); return; }
      const abort = new AbortController(); active = abort;
      const timeout = setTimeout(() => abort.abort(), 8000);
      let delay = 1000;
      let stop = false;
      try {
        const response = await fetch(`/api/broker/quotes?${new URLSearchParams({ client: client.current!, symbols: key })}`, {
          credentials: "same-origin", cache: "no-store", signal: abort.signal,
        });
        const body = await response.json();
        if (disposed) return;
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) { setData(null); stop = true; }
          delay = response.status === 429 ? 60_000 : 5000;
          throw new Error(typeof body.message === "string" ? body.message : "行情暫時無法讀取");
        }
        if (body.ok !== true || body.readOnly !== true || body.liveOrders !== false || !Array.isArray(body.rows)) throw new Error("行情回覆不完整");
        setData(body as FeedResponse); setError(""); setReceived(performance.now());
      } catch (error) {
        if (!disposed) setError(error instanceof Error && error.name !== "AbortError" ? error.message : "讀取逾時，正在重新連線");
        delay = Math.max(delay, 5000);
      } finally {
        clearTimeout(timeout);
        if (!disposed && !stop) timer = setTimeout(() => void poll(), delay);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); active?.abort(); };
  }, [key]);
  return { data, error, received };
}

export function FubonReadOnly() {
  const [symbols, setSymbols] = useState(initialSymbols);
  const [selected, setSelected] = useState("2330");
  const [input, setInput] = useState("");
  const [notice, setNotice] = useState("");
  const [clock, setClock] = useState(0);
  const { data, error, received } = useFeed(symbols);
  useEffect(() => {
    try {
      const saved: unknown = JSON.parse(browserStorage()?.getItem(STORAGE) ?? "null");
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= 20 && saved.every(s => typeof s === "string" && /^\d{4}$/.test(s))) {
        setSymbols([...new Set(saved)]); setSelected(saved[0]);
      }
    } catch { /* private mode keeps a useful default */ }
    const timer = setInterval(() => setClock(performance.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  function change(next: string[]) {
    setSymbols(next);
    try { browserStorage()?.setItem(STORAGE, JSON.stringify(next)); } catch { /* current tab remains usable */ }
    if (!next.includes(selected)) setSelected(next[0]);
  }
  const browserStale = !received || clock - received > 5000 || Boolean(error);
  const rows = new Map(data?.rows.map(row => [row.symbol, row]) ?? []);
  const selectedRow = rows.get(selected);
  const aged = (us: number | null | undefined) => !us || !data || data.serverTime + Math.max(0, clock - received) - us / 1000 > 15000;
  const bookStale = browserStale || !selectedRow?.bookFresh || aged(selectedRow.bookTime);
  return <main className="trading-desk fb-desk" data-market-theme="dark">
    <DeskBar><strong className="fb-heading">富邦盤中行情</strong><span className="fb-lock">唯讀 · 真實下單未啟用</span></DeskBar>
    <div className="fb-status" role="status" data-warning={browserStale || data?.state !== "connected"}>
      <strong>{error || (data ? labels[data.state] : "正在確認存取權限")}</strong>
      {error ? <a href={loginHref({ next: "/morning?feed=fubon" })}>登入本人帳號</a> : null}
      <span>{data?.retryAt ? `下次嘗試 ${new Date(data.retryAt).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}` : "來源：富邦證券 · 上市／上櫃整股"}</span>
      <Link to="/morning" search={{}}>返回歷史模擬練習</Link>
    </div>
    <div className="fb-layout">
      <section className="fb-panel" aria-label="富邦自選報價">
        <div className="fb-title"><h1>自選報價</h1><span>{symbols.length} / 20 檔</span></div>
        <form className="fb-add" onSubmit={event => {
          event.preventDefault();
          const value = input.trim();
          if (!/^\d{4}$/.test(value)) { setNotice("請輸入四位數上市櫃股票代碼"); return; }
          if (symbols.length >= 20 && !symbols.includes(value)) { setNotice("自選最多 20 檔"); return; }
          if (!symbols.includes(value)) change([...symbols, value]);
          setSelected(value); setInput(""); setNotice("");
        }}>
          <label htmlFor="fb-symbol">股票代碼</label><input id="fb-symbol" value={input} onChange={event => setInput(event.target.value)} placeholder="例如 2330" inputMode="numeric" maxLength={4} />
          <button type="submit">加入自選</button>
        </form>
        {notice ? <p role="status" className="fb-note">{notice}</p> : null}
        <div className="fb-table-scroll"><table className="fb-table">
          <thead><tr><th>商品</th><th>成交</th><th>漲跌</th><th>最佳買／賣</th><th>資料時間／狀態</th><th><span className="sr-only">移除</span></th></tr></thead>
          <tbody>{symbols.map(symbol => {
            const row = rows.get(symbol);
            const stale = browserStale || !row?.tradeFresh || aged(row.tradeTime);
            const validRef = row?.price != null && row.reference != null;
            return <tr key={symbol} data-selected={symbol === selected} data-stale={stale}>
              <th scope="row"><button type="button" className="fb-select" aria-pressed={selected === symbol} onClick={() => setSelected(symbol)}>{row?.name ?? symbol}<small>{symbol} {row?.exchange}</small></button></th>
              <td data-tone={tone(row?.price ?? null, row?.reference ?? null)}><TickPrice value={row?.price ?? null} identity={`fubon:${symbol}`}>{number(row?.price)}</TickPrice></td>
              <td data-tone={tone(row?.price ?? null, row?.reference ?? null)}>{validRef ? number(row!.price! - row!.reference!) : "—"}</td>
              <td data-stale={browserStale || !row?.bookFresh || aged(row.bookTime)}>{number(row?.bids[0]?.price)} / {number(row?.asks[0]?.price)}</td>
              <td className="fb-time">{stamp(row?.tradeTime)}<small>{row?.issue === "SNAPSHOT_FAILED" ? "查無商品或行情未提供" : row?.issue === "SNAPSHOT_RATE_LIMIT" ? "券商流量限制，等候恢復" : row?.issue ? "資料異常，保留前值" : !row?.acknowledged ? "等待訂閱確認" : stale ? "尚無最新成交／舊資料" : "最新成交"}</small></td>
              <td><button type="button" className="fb-remove" aria-label={`移除 ${symbol}`} disabled={symbols.length === 1} onClick={() => change(symbols.filter(s => s !== symbol))}>×</button></td>
            </tr>;
          })}</tbody>
        </table></div>
        <p className="fb-note">價格取自券商回傳。超過 15 秒未更新會標示舊資料；冷門股沒有成交也會出現此標示。休市與開盤前請核對日期。</p>
      </section>
      <section className="fb-panel fb-book" aria-label="富邦真實五檔" data-stale={bookStale}>
        <div className="fb-title"><h2>{selectedRow?.name ?? selected} <small>{selected}</small></h2><span>最佳五檔</span></div>
        <div className="fb-book-status"><strong>{selectedRow?.bookPhase ? phaseLabels[selectedRow.bookPhase] : "等待資料"}</strong><span>{bookStale ? "資料未更新，請勿視為即時" : "已收到最新五檔"}</span></div>
        <div className="fb-ladder-scroll" role="region" aria-label="五檔買賣明細，可橫向捲動" tabIndex={0}><table className="fb-table fb-ladder"><thead><tr><th>委買量</th><th>委買價</th><th>委賣價</th><th>委賣量</th></tr></thead><tbody>
          {Array.from({ length: 5 }, (_, i) => <BookRow key={i} row={selectedRow} index={i} />)}
        </tbody></table></div>
        <p className="fb-note">五檔時間：{stamp(selectedRow?.bookTime)}<br />空白代表券商未提供該檔，保留單邊或空簿。數量為券商原值，未換算股或張。</p>
        <div className="fb-readonly">真實下單已封鎖<br /><small>本頁只讀取行情，點選價格不會送出委託。</small></div>
      </section>
    </div>
  </main>;
}

function BookRow({ row, index }: { row?: FubonRow; index: number }) {
  const bid = row?.bids[index], ask = row?.asks[index];
  return <tr><td>{number(bid?.size)}</td><td data-tone={tone(bid?.price ?? null, row?.reference ?? null)}>{number(bid?.price)}</td><td data-tone={tone(ask?.price ?? null, row?.reference ?? null)}>{number(ask?.price)}</td><td>{number(ask?.size)}</td></tr>;
}
