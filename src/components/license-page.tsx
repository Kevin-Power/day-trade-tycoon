import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, BookOpen, LogOut, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SimChip } from "@/components/provenance";
import { DISCLAIMER } from "@/lib/provenance";
import { useGate } from "@/lib/gate/context";
import {
  LICENSE_EXCLUDED,
  LICENSE_INCLUDED,
  LICENSE_LEAD,
  LICENSE_ONE_LINER,
  LICENSE_PAYMENT_NOTE,
  LICENSE_PRICING_NOTE,
  LICENSE_QUOTE,
  LICENSE_SKUS,
  LICENSE_TITLE,
  LICENSE_VERSION,
  SEAT_ROADMAP,
  SEAT_TODAY,
} from "@/lib/license";
import { cn } from "@/lib/utils";

const TOC = [
  { id: "brief", n: "00", label: "給金主看的一頁" },
  { id: "included", n: "01", label: "這包有什麼" },
  { id: "excluded", n: "02", label: "這包沒有什麼" },
  { id: "seats", n: "03", label: "席次怎麼算" },
  { id: "skus", n: "04", label: "線上與地端" },
  { id: "quote", n: "05", label: "報價欄位" },
  { id: "risk", n: "06", label: "不承諾什麼" },
] as const;

export function LicensePage() {
  const { lock, unlocked } = useGate();
  return (
    <div className="manual-sheet min-h-dvh bg-bg text-fg">
      <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft className="size-3.5" />
            {unlocked ? "回大廳" : "回入場"}
          </Link>
          <div className="flex items-center gap-2">
            {unlocked ? (
              <Link
                to="/manual"
                className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs text-fg hover:bg-elevated"
              >
                <BookOpen className="size-3.5" />
                說明書
              </Link>
            ) : null}
            <Button type="button" size="sm" variant="header" onClick={() => window.print()}>
              <Printer className="size-3.5" />
              列印
            </Button>
            {unlocked ? (
              <button
                type="button"
                onClick={lock}
                className="inline-flex size-9 items-center justify-center rounded-sm border border-border-strong bg-surface text-muted hover:bg-elevated hover:text-fg"
                aria-label="登出"
              >
                <LogOut className="size-3.5" />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <article className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <Cover />
        <Nav />
        <Brief />
        <Included />
        <Excluded />
        <Seats />
        <Skus />
        <Quote />
        <Risk />
        <Colophon />
      </article>
    </div>
  );
}

function Cover() {
  return (
    <section className="mb-12 border-b border-border pb-10">
      <div className="mb-6 flex items-center gap-3">
        <Mark />
        <div>
          <div className="text-xs tracking-[0.22em] text-muted">DAY TRADE TYCOON</div>
          <div className="text-sm text-fg">股文觀指教室 · 授權說明</div>
        </div>
        <SimChip className="ml-auto hidden sm:inline" />
      </div>
      <p className="mb-3 text-xs tracking-[0.28em] text-muted">{LICENSE_VERSION}</p>
      <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
        {LICENSE_TITLE}
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">{LICENSE_LEAD}</p>
      <ul className="mt-6 flex flex-wrap gap-2 text-micro">
        <Chip>模擬教室</Chip>
        <Chip>課綱</Chip>
        <Chip>地端包</Chip>
        <Chip>說明書</Chip>
        <Chip tone="warn">實盤尚未接線</Chip>
        <Chip tone="warn">非投顧 · 非保證獲利</Chip>
      </ul>
    </section>
  );
}

function Nav() {
  return (
    <nav className="mb-14 grid gap-1 sm:grid-cols-2 print:mb-8">
      {TOC.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="flex items-baseline gap-3 rounded-sm px-2 py-1.5 text-sm text-muted hover:bg-elevated hover:text-fg"
        >
          <span className="font-mono text-micro text-subtle">{t.n}</span>
          {t.label}
        </a>
      ))}
    </nav>
  );
}

function Brief() {
  return (
    <Section id="brief" n="00" title="給金主看的一頁">
      <p className="text-pretty leading-relaxed text-muted">
        股文觀指要的不是再做一個看盤軟體，是讓學員在像真的盤面上，把判斷、費稅、停損、部位、收盤平倉練到肌肉記得。授權賣的就是那間教室，不是實盤通道。
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <tbody>
            <Row k="這包有" v="模擬教室、課綱、地端包、說明書。" />
            <Row k="這包沒有" v="實盤下單、投顧、訊號、代操、保證獲利。" />
            <Row k="席次現況" v="全班同一組入場密碼。還沒有按人頭帳號，軟體也不卡人數。" />
            <Row k="報價" v={`${LICENSE_QUOTE}。這一頁不寫新台幣數字。`} />
            <Row k="金流" v="沒有線上刷卡、沒有 LINE Pay。班費怎麼收，教室自己定。" />
          </tbody>
        </table>
      </div>
      <blockquote className="mt-6 border-l-2 border-tape pl-4 text-sm leading-relaxed text-fg">
        {LICENSE_ONE_LINER}
      </blockquote>
    </Section>
  );
}

function Included() {
  return (
    <Section id="included" n="01" title="這包有什麼">
      <p className="text-pretty leading-relaxed text-muted">
        能開班的是這四樣。講成「已經可以實盤下單」或「保證會賺」，是講錯了。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {LICENSE_INCLUDED.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
    </Section>
  );
}

function Excluded() {
  return (
    <Section id="excluded" n="02" title="這包沒有什麼">
      <p className="text-pretty leading-relaxed text-muted">
        下面這些不是這份產品。對外簡報請直接劃掉，免得學員或金主以為已經買到。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {LICENSE_EXCLUDED.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        另外也還沒有：學員雲端帳號、講師後台、班級排行、教室聊天。那是後面的路，不是現況。
      </p>
    </Section>
  );
}

function Seats() {
  return (
    <Section id="seats" n="03" title="席次怎麼算">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Fact label="今天" body={SEAT_TODAY} />
        <Fact label="之後（路線圖）" body={SEAT_ROADMAP} />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        跟講師談人數時，以教室現場為準，不是以這個網站的登入數為準。在每人帳號做好之前，席次是班務，不是軟體功能。
      </p>
    </Section>
  );
}

function Skus() {
  return (
    <Section id="skus" n="04" title="線上與地端">
      <p className="text-pretty leading-relaxed text-muted">
        兩個方案可以只談一個，也可以一起談。地端＝教材週、線上＝每日練習。不要講成兩套規則。
      </p>
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-xl text-left text-sm">
          <thead className="bg-surface-2 text-micro tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">方案</th>
              <th className="px-3 py-2 font-medium">含什麼</th>
              <th className="px-3 py-2 font-medium">報價</th>
            </tr>
          </thead>
          <tbody>
            {LICENSE_SKUS.map((sku) => (
              <tr key={sku.id} className="border-t border-border">
                <td className="px-3 py-2 text-pretty font-medium">{sku.name}</td>
                <td className="px-3 py-2 text-pretty">{sku.includes}</td>
                <td className="px-3 py-2">
                  <QuoteChip />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Quote() {
  return (
    <Section id="quote" n="05" title="報價欄位">
      <p className="text-pretty leading-relaxed text-muted">{LICENSE_PRICING_NOTE}</p>
      <div className="mt-5 overflow-hidden rounded-lg border border-dashed border-border-strong">
        <table className="w-full text-left text-sm">
          <tbody>
            {LICENSE_SKUS.map((sku) => (
              <Row key={sku.id} k={sku.name} v={LICENSE_QUOTE} />
            ))}
            <Row k="講師帳／每人帳號" v="尚未開賣。那是路線圖，這一欄也是洽教室／講師報價，不是官價。" />
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">{LICENSE_PAYMENT_NOTE}</p>
    </Section>
  );
}

function Risk() {
  return (
    <Section id="risk" n="06" title="不承諾什麼">
      <p className="mb-4 text-pretty text-sm leading-relaxed text-muted">{DISCLAIMER}</p>
      <ul className="space-y-3 text-sm leading-relaxed text-muted">
        <li>這不是投資建議，不是獲利保證，不是代操。</li>
        <li>教室成績不能外推到實盤。實盤有滑價、排隊、斷線、情緒，教室沒有全部模擬到。</li>
        <li>沒有向金管會申請的證券業務。產品定位是教學模擬。</li>
        <li>石大哥如果聽到「已經可以實盤下單」或「買了就會賺」，那是講錯了。</li>
      </ul>
    </Section>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-micro leading-relaxed text-subtle">
      <p>
        當沖大富翁 · 股文觀指教室 · {LICENSE_VERSION} · {LICENSE_TITLE}
      </p>
      <p className="mt-1">
        要開班、要授權、要地端包：{LICENSE_QUOTE}。內容以產品現況為準，實盤未接線前請勿對外宣稱可下真單。
      </p>
    </footer>
  );
}

function QuoteChip() {
  return (
    <span className="inline-flex rounded-xs border border-dashed border-border-strong bg-elevated px-1.5 py-0.5 text-micro text-muted">
      {LICENSE_QUOTE}
    </span>
  );
}

function Section({
  id,
  n,
  title,
  children,
}: {
  id: string;
  n: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="manual-section mb-14 scroll-mt-20">
      <h2 className="mb-4 flex items-baseline gap-3 text-xl font-medium tracking-tight">
        <span className="font-mono text-xs text-subtle">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Chip({ children, tone }: { children: ReactNode; tone?: "warn" }) {
  return (
    <span
      className={cn(
        "rounded-xs px-1.5 py-0.5 tracking-wide",
        tone === "warn" ? "bg-warn/15 text-warn" : "bg-elevated text-muted",
      )}
    >
      {children}
    </span>
  );
}

function Fact({ label, body }: { label: string; body: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-micro text-muted">{label}</div>
      <p className="mt-1 text-pretty text-sm leading-relaxed">{body}</p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <th className="w-28 px-3 py-2 align-top font-medium text-muted sm:w-40">{k}</th>
      <td className="px-3 py-2 text-pretty">{v}</td>
    </tr>
  );
}

function Mark() {
  return (
    <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden className="rounded-sm">
      <rect width="36" height="36" fill="#163a6b" />
      <path d="M8 24 V14 H11 V24 Z" fill="#ff3b3b" />
      <path d="M9.5 10 V14 M9.5 24 V28" stroke="#ff3b3b" strokeWidth="1.4" />
      <path d="M16 24 V18 H19 V24 Z" fill="#8b9bb0" />
      <path d="M17.5 15 V18 M17.5 24 V26" stroke="#8b9bb0" strokeWidth="1.4" />
      <path d="M24 24 V11 H27 V24 Z" fill="#17c964" />
      <path d="M25.5 8 V11 M25.5 24 V30" stroke="#17c964" strokeWidth="1.4" />
    </svg>
  );
}
