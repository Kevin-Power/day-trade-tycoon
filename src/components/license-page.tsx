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
  { id: "brief", n: "00", label: "課程怎麼進行" },
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
    <Section id="brief" n="00" title="課程怎麼進行">
      <p className="text-pretty leading-relaxed text-muted">
        講師帶領學員完成模擬練習，逐步理解判斷、費稅、停損、部位與收盤平倉。每堂課結束後，透過交易紀錄與復盤整理自己的決策。
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <tbody>
            <Row k="這包有" v="模擬教室、課綱、地端包、說明書。" />
            <Row k="這包沒有" v="實盤下單、投顧、訊號、代操、保證獲利。" />
            <Row k="學員帳號" v="先使用教室入場碼，再登入個人帳號保存成績與復盤。報名資格由教室另行核對。" />
            <Row k="課程費用" v={`${LICENSE_QUOTE}。開課日期、費用與名額以教室確認內容為準。`} />
            <Row k="付款方式" v="請向教室確認報名與付款方式；網站目前沒有線上結帳。" />
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
        課程搭配以下練習工具與教材，供講師帶班和學員課後複習。
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
        本教室提供模擬教學，以下服務不包含在產品內。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        {LICENSE_EXCLUDED.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        網站提供個人帳號、講師班級檢視與練習排行；目前沒有教室聊天或線上付款功能。
      </p>
    </Section>
  );
}

function Seats() {
  return (
    <Section id="seats" n="03" title="席次怎麼算">
      <div className="grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Fact label="今天" body={SEAT_TODAY} />
        <Fact label="帳號與報名" body={SEAT_ROADMAP} />
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        班級名額與開課安排由教室確認。建立網站帳號不代表已完成報名或付款，請以教室確認的學員名單為準。
      </p>
    </Section>
  );
}

function Skus() {
  return (
    <Section id="skus" n="04" title="線上與地端">
      <p className="text-pretty leading-relaxed text-muted">
        線上教室可保存帳號成績與復盤；地端包可在自己的電腦練習教材情境。兩者使用相同的模擬規則。
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
            <Row k="帳號與課程名額" v="請向教室確認課程包含的使用期間、教材與名額；建立帳號不會自動扣款。" />
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
        <li>所有下單均為模擬，沒有連接券商真實交易帳戶。</li>
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
        課程、授權與地端包：{LICENSE_QUOTE}。本產品供教學模擬與復盤使用。
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
