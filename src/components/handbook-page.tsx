import type { ReactNode } from "react";
import { ArrowLeft, LogOut, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocLink } from "@/components/doc-link";
import { useGate } from "@/lib/gate/context";
import { cn } from "@/lib/utils";
import { LESSONS, PRINCIPLES } from "@/lib/game/curriculum";
import { SCENARIOS } from "@/lib/game/scenarios";
import { formatMoney } from "@/lib/utils";
import { HANDBOOK } from "@/lib/handbook/content";

const VERSION = "2026-09 課堂版";

const TOC: { id: string; n: string; label: string; has: boolean }[] = [
  { id: "start", n: "00", label: "開始之前", has: !!HANDBOOK.start },
  { id: "cost", n: "01", label: "成本：先算再做", has: !!HANDBOOK.cost },
  { id: "six", n: "02", label: "當沖六式", has: true },
  { id: "glossary", n: "03", label: "名詞表", has: true },
  { id: "mistakes", n: "04", label: "賠錢的做法", has: !!HANDBOOK.mistakes },
  { id: "syllabus", n: "05", label: "本週課綱", has: true },
  { id: "plans", n: "06", label: "講師教案", has: !!HANDBOOK.plans },
  { id: "forms", n: "07", label: "計畫表與復盤表", has: !!HANDBOOK.worksheet },
];

/**
 * 教材。學員講義（00–05、07）＋ 講師教案（06）。
 *
 * 課綱、六式與關卡設定直接讀 `curriculum.ts` / `scenarios.ts`，所以教材與盤面
 * 不會各講各的。`onBack` 是給沒有 router 的地端教室包用的（見 DocLink）。
 */
export function HandbookPage({ onBack }: { onBack?: () => void } = {}) {
  const { lock } = useGate();
  return (
    <div className="manual-sheet min-h-dvh bg-bg text-fg">
      <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <DocLink
            to="/"
            onOpen={onBack}
            className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft className="size-3.5" />
            回大廳
          </DocLink>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="header" onClick={() => window.print()}>
              <Printer className="size-3.5" />
              列印
            </Button>
            <button
              type="button"
              onClick={lock}
              className="inline-flex size-9 items-center justify-center rounded-sm border border-border-strong bg-surface text-muted hover:bg-elevated hover:text-fg"
              aria-label="登出"
            >
              <LogOut className="size-3.5" />
            </button>
          </div>
        </div>
      </header>

      <article className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <Cover />
        <Nav />
        <Start />
        <Cost />
        <Six />
        <GlossarySection />
        <Mistakes />
        <Syllabus />
        <Plans />
        <Forms />
        <Colophon />
      </article>
    </div>
  );
}

function Cover() {
  return (
    <section className="mb-12 border-b border-border pb-10">
      <p className="text-xs tracking-[0.28em] text-muted">DAY TRADE TYCOON · 教材</p>
      <h1 className="mt-3 text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
        當沖大富翁 教材
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-sm leading-relaxed text-muted sm:text-base">
        給股文觀指教室。00 到 05 與 07 是學員講義，06 是講師教案。整份可以直接列印成 A4 發下去。
      </p>
      <div className="mt-6 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <Box k="學員拿到什麼" v="規則、成本算式、六式、名詞表、常見錯誤、計畫表" />
        <Box k="講師拿到什麼" v="六堂課的流程、板書、提問與要盯的錯誤" />
        <Box k="版本" v={VERSION} />
      </div>
      <p className="mt-4 text-micro leading-relaxed text-subtle">
        教材的費率與課綱直接取自程式碼（`src/lib/market/ticks.ts`、`src/lib/game/curriculum.ts`），
        改盤面就會一起改，講義不會跟螢幕講不一樣。
      </p>
    </section>
  );
}

function Box({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-micro text-muted">{k}</div>
      <div className="mt-1 text-pretty text-sm leading-relaxed">{v}</div>
    </div>
  );
}

function Nav() {
  return (
    <nav className="mb-14 grid gap-1 sm:grid-cols-2 print:mb-8">
      {TOC.filter((t) => t.has).map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="flex items-baseline gap-3 rounded-sm px-2 py-1.5 text-sm hover:bg-elevated"
        >
          <span className="font-mono text-micro text-muted">{t.n}</span>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}

function Start() {
  const START = HANDBOOK.start;
  if (!START) return null;
  return (
    <Section id="start" n="00" title="開始之前">
      <P>{START.whatIsDaytrade}</P>
      <H3>台股當沖的硬規則</H3>
      <RateTable rows={START.rules} />
      <H3>先講清楚風險</H3>
      <Bullets items={START.risk} tone="warn" />
      <H3>這個教室跟真實市場的差別</H3>
      <Bullets items={START.classroomBoundary} />
      <H3>第一次上課，照這個順序做</H3>
      <Ordered items={START.firstDay} />
    </Section>
  );
}

function Cost() {
  const COST = HANDBOOK.cost;
  if (!COST) return null;
  return (
    <Section id="cost" n="01" title="成本：先算再做">
      <P>{COST.intro}</P>
      <H3>費率</H3>
      <RateTable rows={COST.rates} />
      <H3>手算三題</H3>
      <div className="grid gap-3">
        {COST.worked.map((w) => (
          <div key={w.title} className="rounded-md border border-border bg-surface p-4">
            <div className="text-sm font-medium">{w.title}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">{w.setup}</p>
            <ol className="mt-3 space-y-1 border-l border-border pl-3 font-mono text-micro leading-relaxed text-muted">
              {w.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 text-sm font-medium text-warn">{w.answer}</p>
          </div>
        ))}
      </div>
      <H3>打平要幾檔</H3>
      <Table
        head={["股價", "一檔", "一張來回成本", "要幾檔才打平"]}
        rows={COST.breakeven.map((b) => [b.price, b.tick, b.cost, b.ticksToBreakeven])}
        cols={[{ strong: true, mono: true }, { mono: true }, { mono: true }, { mono: true }]}
      />
      <Callout>{COST.takeaway}</Callout>
    </Section>
  );
}

function Six() {
  const notes = HANDBOOK.principles;
  const noteFor = (no: string) => notes?.items.find((i) => i.no === no);
  return (
    <Section id="six" n="02" title="當沖六式">
      {notes && <P>{notes.intro}</P>}
      <div className="grid gap-3">
        {PRINCIPLES.map((p) => {
          const note = noteFor(p.no);
          return (
            <div
              key={p.no}
              className="manual-section rounded-md border border-border bg-surface p-4"
            >
              <div className="flex items-baseline gap-3">
                <span className="font-mono text-micro text-muted">{p.no}</span>
                <span className="text-base font-medium">{p.title}</span>
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{p.body}</p>
              {note && (
                <dl className="mt-3 grid gap-2 border-t border-border pt-3 text-xs leading-relaxed sm:grid-cols-2">
                  <Def k="為什麼" v={note.why} />
                  <Def k="盤面看哪裡" v={note.howToSee} />
                  <Def k="做錯長這樣" v={note.wrongLooks} />
                  <Def k="怎麼練" v={note.drill} />
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function Def({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-micro tracking-wide text-muted">{k}</dt>
      <dd className="mt-0.5 text-pretty">{v}</dd>
    </div>
  );
}

function GlossarySection() {
  const GLOSSARY = HANDBOOK.glossary;
  return (
    <Section id="glossary" n="03" title="名詞表">
      <P>{GLOSSARY.intro}</P>
      {GLOSSARY.groups.map((g) => (
        <div key={g.group} className="mb-6">
          <H3>{g.group}</H3>
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border">
            {g.terms.map((t) => (
              <div key={t.term} className="manual-section bg-surface px-4 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="text-sm font-medium">{t.term}</span>
                  {t.en && <span className="font-mono text-micro text-subtle">{t.en}</span>}
                </div>
                <p className="mt-1 text-pretty text-sm leading-relaxed">{t.oneLine}</p>
                <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted">
                  <span className="mr-2 text-fg/70">盤面哪裡看</span>
                  {t.where}
                </p>
                <p className="mt-1 text-pretty text-xs leading-relaxed text-warn">
                  <span className="mr-2 opacity-70">常見誤解</span>
                  {t.misread}
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}
    </Section>
  );
}

function Mistakes() {
  const MISTAKES = HANDBOOK.mistakes;
  if (!MISTAKES) return null;
  return (
    <Section id="mistakes" n="04" title="賠錢的做法">
      <P>{MISTAKES.intro}</P>
      <div className="grid gap-3">
        {MISTAKES.items.map((m, i) => (
          <div
            key={m.name}
            className="manual-section rounded-md border border-border bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-micro text-muted">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-base font-medium">{m.name}</span>
              <span className="rounded-xs bg-elevated px-1.5 py-0.5 text-2xs text-muted">
                違反 {m.principle}
              </span>
            </div>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-fg/90">「{m.symptom}」</p>
            <p className="mt-1.5 text-pretty text-xs leading-relaxed text-muted">{m.why}</p>
            <p className="mt-2 text-pretty text-sm leading-relaxed text-warn">下次改成：{m.fix}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

/** 課綱直接讀 curriculum.ts，包含盤面上看不到的 prep（課前準備）。 */
function Syllabus() {
  const scenarioFor = (id: string) => SCENARIOS.find((s) => s.id === id);
  return (
    <Section id="syllabus" n="05" title="本週課綱">
      <P>
        六堂課用的是 2026/08/24–08/26 的實盤節奏。每堂課的「課前準備」請在進盤室前先讀完，
        盤中的提示會接著這三條講。
      </P>
      <div className="grid gap-3">
        {LESSONS.map((l) => {
          const sc = scenarioFor(l.id);
          return (
            <div
              key={l.id}
              className="manual-section rounded-md border border-border bg-surface p-4"
            >
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-mono text-micro text-muted">{l.no}</span>
                <span className="text-base font-medium">{l.skill}</span>
                {sc && (
                  <span className="font-mono text-micro text-subtle">
                    {sc.name} · {sc.minutes} 分 · {sc.speed}x · 本金 {formatMoney(sc.capital)} ·{" "}
                    {sc.leverage}x 額度 · {sc.allowShort ? "可先賣" : "僅先買"}
                  </span>
                )}
              </div>
              <p className="mt-1.5 text-sm leading-relaxed">{l.principle}</p>

              <H4>課前準備</H4>
              <Bullets items={l.prep} />

              <H4>盤中關鍵分鐘</H4>
              <div className="grid gap-2">
                {l.beats.map((b) => (
                  <div key={b.atMinute} className="rounded-sm border border-border bg-bg px-3 py-2">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-micro text-tape">
                        {clock(sc?.startMinute ?? 0, b.atMinute)}
                      </span>
                      <span className="text-sm font-medium">{b.title}</span>
                    </div>
                    <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">{b.body}</p>
                    <p className="mt-1 text-pretty text-xs leading-relaxed text-fg">
                      動作：{b.hint}
                    </p>
                  </div>
                ))}
              </div>

              <H4>課後檢討</H4>
              <Ordered items={l.review} />
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/** 盤中分鐘轉成時鐘時間，開盤為 09:00。 */
function clock(_startMinute: number, atMinute: number): string {
  const total = Math.max(0, Math.round(atMinute));
  const h = 9 + Math.floor(total / 60);
  const m = total % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function Plans() {
  const PLANS = HANDBOOK.plans;
  if (!PLANS) return null;
  return (
    <Section id="plans" n="06" title="講師教案">
      <P>{PLANS.intro}</P>
      <div className="grid gap-4">
        {PLANS.lessons.map((l) => (
          <div
            key={l.id}
            className="manual-section rounded-md border border-border-strong bg-surface p-4"
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-micro text-muted">{l.no}</span>
              <span className="text-base font-medium">{l.skill}</span>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed">
              <span className="mr-2 text-muted">目標</span>
              {l.goal}
            </p>

            <H4>板書</H4>
            <Bullets items={l.board} />

            <H4>開場提問</H4>
            <Quote>{l.openQuestion}</Quote>

            <H4>課堂流程</H4>
            <div className="grid gap-2">
              {l.timeline.map((t, i) => (
                <div key={i} className="rounded-sm border border-border bg-bg px-3 py-2">
                  <div className="font-mono text-micro text-tape">{t.at}</div>
                  <p className="mt-1 text-pretty text-xs leading-relaxed">
                    <span className="mr-2 text-muted">做</span>
                    {t.doWhat}
                  </p>
                  <p className="mt-1 text-pretty text-xs leading-relaxed text-muted">
                    <span className="mr-2 text-fg/70">說</span>
                    {t.sayWhat}
                  </p>
                </div>
              ))}
            </div>

            <H4>要盯的錯誤</H4>
            <Bullets items={l.watchFor} tone="warn" />

            <H4>收尾提問</H4>
            <Quote>{l.closeQuestion}</Quote>
          </div>
        ))}
      </div>
    </Section>
  );
}

function Forms() {
  const WORKSHEET = HANDBOOK.worksheet;
  if (!WORKSHEET) return null;
  return (
    <Section id="forms" n="07" title="計畫表與復盤表">
      <P>{WORKSHEET.intro}</P>

      <H3>送出前自我檢查</H3>
      <div className="grid gap-1.5 rounded-md border border-border bg-surface p-4">
        {WORKSHEET.checklist.map((c) => (
          <label key={c} className="flex items-start gap-2 text-sm leading-relaxed">
            <span
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 rounded-xs border border-border-strong"
            />
            <span className="text-pretty">{c}</span>
          </label>
        ))}
      </div>

      <Form title={WORKSHEET.planTitle} intro={WORKSHEET.planIntro} fields={WORKSHEET.planFields} />
      <Form
        title={WORKSHEET.reviewTitle}
        intro={WORKSHEET.reviewIntro}
        fields={WORKSHEET.reviewFields}
      />
    </Section>
  );
}

function Form({
  title,
  intro,
  fields,
}: {
  title: string;
  intro: string;
  fields: { label: string; hint: string; lines: number }[];
}) {
  return (
    <div className="manual-section mt-6 rounded-md border border-border-strong bg-surface p-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-border pb-2">
        <h3 className="text-base font-medium">{title}</h3>
        <span className="font-mono text-micro text-muted">
          日期 ____ / ____ <span className="ml-3">姓名 ________</span>
        </span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted">{intro}</p>
      <div className="mt-3 grid gap-3">
        {fields.map((f) => (
          <div key={f.label}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-medium">{f.label}</span>
              <span className="text-micro text-subtle">{f.hint}</span>
            </div>
            <div className="mt-1.5 grid gap-2">
              {Array.from({ length: Math.max(1, f.lines) }, (_, i) => (
                <div key={i} className="h-6 border-b border-dashed border-border-strong" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Colophon() {
  return (
    <section className="mt-16 border-t border-border pt-6 text-micro leading-relaxed text-subtle">
      <p>
        當沖大富翁 · 教材 {VERSION}。給股文觀指教室使用。教材內的費率與課綱由程式碼產生，
        修改盤面設定後請重新列印。
      </p>
      <p className="mt-1.5">
        本教材用於教學。模擬撮合不等於實盤成交，教材內的任何內容都不是投資建議。
      </p>
    </section>
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
    <section id={id} className="mb-14 scroll-mt-20">
      <h2 className="mb-4 flex items-baseline gap-3 text-xl font-medium tracking-tight">
        <span className="font-mono text-sm text-muted">{n}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-medium tracking-wide text-fg">{children}</h3>;
}

function H4({ children }: { children: ReactNode }) {
  return (
    <h4 className="mb-1.5 mt-3 text-micro font-medium tracking-[0.16em] text-muted">{children}</h4>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p className="mb-4 text-pretty text-sm leading-relaxed text-muted">{children}</p>;
}

function Quote({ children }: { children: ReactNode }) {
  return (
    <p className="border-l-2 border-header-2 pl-3 text-pretty text-sm leading-relaxed">
      {children}
    </p>
  );
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <p className="mt-4 rounded-md border border-warn/40 bg-elevated px-4 py-3 text-pretty text-sm leading-relaxed text-warn">
      {children}
    </p>
  );
}

function Bullets({ items, tone }: { items: string[]; tone?: "warn" }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((s) => (
        <li key={s} className="flex gap-2 text-pretty text-sm leading-relaxed">
          <span
            aria-hidden
            className={cn(
              "mt-2 size-1 shrink-0 rounded-full",
              tone === "warn" ? "bg-warn" : "bg-muted",
            )}
          />
          <span className={tone === "warn" ? "text-warn" : undefined}>{s}</span>
        </li>
      ))}
    </ul>
  );
}

function Ordered({ items }: { items: string[] }) {
  return (
    <ol className="grid gap-1.5">
      {items.map((s, i) => (
        <li key={s} className="flex gap-2 text-pretty text-sm leading-relaxed">
          <span className="font-mono text-micro text-muted">{String(i + 1).padStart(2, "0")}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function RateTable({ rows }: { rows: { label: string; value: string; note: string }[] }) {
  return (
    <Table
      head={["項目", "數字", "說明"]}
      rows={rows.map((r) => [r.label, r.value, r.note])}
      cols={[{ strong: true }, { mono: true }, { muted: true }]}
    />
  );
}

/** 欄位樣式由呼叫端指定；用欄位位置猜會把長句欄位設成不換行，撐爆表格。 */
type Col = { strong?: boolean; mono?: boolean; muted?: boolean; nowrap?: boolean };

function Table({ head, rows, cols }: { head: string[]; rows: string[][]; cols?: Col[] }) {
  return (
    <div className="term-scroll overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-border-strong text-micro tracking-wide text-muted">
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap py-1.5 pr-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border align-top">
              {r.map((c, j) => (
                <td
                  key={j}
                  className={cn(
                    "py-1.5 pr-3 leading-relaxed",
                    cols?.[j]?.strong && "font-medium",
                    cols?.[j]?.mono && "whitespace-nowrap font-mono tabular",
                    cols?.[j]?.muted && "text-muted",
                    cols?.[j]?.nowrap && "whitespace-nowrap",
                  )}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
