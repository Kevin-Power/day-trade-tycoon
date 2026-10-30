import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  LogOut,
  Monitor,
  Printer,
  ScanLine,
  Smartphone,
  Tablet,
  TextCursorInput,
} from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { BrandMark } from "@/components/brand-mark";
import { CourseInquiryForm } from "@/components/course-inquiry-form";
import { DisplayControls } from "@/components/display-controls";
import { SimChip } from "@/components/provenance";
import { DISCLAIMER } from "@/lib/provenance";
import { useGate } from "@/lib/gate/context";
import { MORNING_EXERCISES } from "@/lib/morning-exercises";
import {
  LICENSE_DATA,
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

const TOC = [
  { id: "audience", label: "適合誰來練" },
  { id: "courses", label: "三階段課程" },
  { id: "practice", label: "怎麼上課" },
  { id: "devices", label: "裝置與操作" },
  { id: "enrollment", label: "報名與入場" },
  { id: "included", label: "教材與授權" },
  { id: "risk", label: "模擬範圍" },
] as const;

const STAGES = [
  { title: "入門操作", description: "從看懂畫面，到核對第一筆模擬委託。", number: "01" },
  { title: "風險紀律", description: "練習等待條件、管理部位與執行出場。", number: "02" },
  { title: "自主練習", description: "完成收尾與復盤，為下次選一個重點。", number: "03" },
] as const;

export function LicensePage() {
  const { lock, unlocked } = useGate();
  return (
    <div className="academy-page premium-course-page manual-sheet min-h-dvh bg-bg text-base leading-relaxed text-fg [overflow-wrap:anywhere]">
      <header className="no-print top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm sm:sticky">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-lg px-3 py-2 text-base text-muted hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft className="shrink-0" aria-hidden="true" />
            {unlocked ? "回大廳" : "回入場"}
          </Link>
          <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
            <DisplayControls compact />
            {unlocked ? (
              <Link
                to="/manual"
                className="inline-flex min-h-12 max-w-full items-center gap-2 rounded-lg border border-border-strong bg-surface px-3 py-2 text-base text-fg hover:bg-elevated"
              >
                <BookOpen className="shrink-0" aria-hidden="true" />
                說明書
              </Link>
            ) : null}
            <Button
              type="button"
              size="sm"
              variant="header"
              className="h-auto min-h-12 max-w-full whitespace-normal py-2 text-base"
              onClick={() => window.print()}
            >
              <Printer className="shrink-0" aria-hidden="true" />
              列印
            </Button>
            {unlocked ? (
              <button
                type="button"
                onClick={lock}
                className="icon-only inline-flex size-12 shrink-0 items-center justify-center rounded-lg border border-border-strong bg-surface text-muted hover:bg-elevated hover:text-fg"
                aria-label="登出"
              >
                <LogOut aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      </header>
      <article className="mx-auto w-full max-w-6xl px-4 pb-20 pt-8 sm:px-6 sm:pt-12">
        <Cover unlocked={unlocked} />
        <nav aria-label="課程說明章節" className="premium-toc mb-16 border-y border-border py-3">
          <p className="mb-2 px-3 text-sm font-medium text-subtle">課程導覽</p>
          <ol className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-4">
            {TOC.map((item, index) => (
              <li key={item.id} className="min-w-0">
                <a
                  href={`#${item.id}`}
                  className="group flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-base text-muted hover:bg-elevated hover:text-fg"
                >
                  <span className="font-mono text-xs text-subtle" aria-hidden="true">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span>{item.label}</span>
                  <ArrowRight className="ml-auto shrink-0 text-brand" aria-hidden="true" />
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <Audience />
        <Courses />
        <Practice />
        <Devices />
        <Enrollment />
        <Included />
        <Risk />
        <section className="premium-course-closing rounded-3xl border border-brand/25 bg-brand/5 p-5 sm:p-8 lg:p-10">
          <p className="academy-eyebrow">先熟悉，再開始</p>
          <h2 className="mt-3 text-2xl font-semibold tracking-tight">
            先練一輪，看看自己卡在哪一步
          </h2>
          <p className="mt-3 max-w-2xl text-base leading-7 text-muted">
            免費體驗會帶你核對委託、查看成交與理解成本。不用準備交易帳戶，也不會送出真實委託。
          </p>
          <EntryActions unlocked={unlocked} />
        </section>
        <footer className="mt-12 border-t border-border pt-6 text-sm leading-7 text-subtle">
          <p>當沖大富翁 · 股文觀指教室 · 課程與授權說明 · {LICENSE_VERSION}</p>
          <p>課程、授權與地端包：{LICENSE_QUOTE}。本產品供教學模擬與復盤使用。</p>
        </footer>
      </article>
    </div>
  );
}

function Cover({ unlocked }: { unlocked: boolean }) {
  return (
    <section className="premium-course-cover mb-10 grid items-center gap-8 pb-5 lg:grid-cols-[1.15fr_1fr] lg:gap-14">
      <div className="min-w-0">
        <div className="mb-8 flex items-center gap-3">
          <BrandMark className="size-12 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-medium tracking-[0.16em] text-muted">DAY TRADE TYCOON</p>
            <p className="text-base font-medium">當沖大富翁 · 講師帶班 × 模擬練習</p>
          </div>
        </div>
        <h1 className="max-w-[13em] text-balance text-4xl font-semibold leading-[1.25] tracking-tight sm:text-5xl">
          {LICENSE_TITLE}
        </h1>
        <p className="mt-5 max-w-2xl text-pretty text-base leading-8 text-muted">{LICENSE_LEAD}</p>
        <EntryActions unlocked={unlocked} />
        <p className="mt-3 text-base leading-7 text-muted">
          免費體驗不用帳號 · 不限時，可依自己的步調操作
        </p>
        <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-6">
          <div className="flex items-baseline gap-2">
            <dt className="order-2 text-sm text-muted">學習階段</dt>
            <dd className="font-mono text-3xl font-medium text-brand">
              {String(STAGES.length).padStart(2, "0")}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="order-2 text-sm text-muted">規劃課程任務</dt>
            <dd className="font-mono text-3xl font-medium text-brand">
              {String(MORNING_EXERCISES.length).padStart(2, "0")}
            </dd>
          </div>
        </dl>
      </div>
      <div className="premium-outcome-panel min-w-0 rounded-3xl border border-brand/20 bg-surface p-5 sm:p-7 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-5">
          <p className="text-sm font-medium tracking-wider">你的學習收穫</p>
          <SimChip />
        </div>
        <h2 className="mb-7 mt-6 text-balance text-2xl font-semibold leading-relaxed">
          一次練習，
          <br className="hidden sm:block" />
          三個帶得走的收穫
        </h2>
        <div className="space-y-7">
          <Outcome number="01" icon={<ClipboardList />} title="說得出自己的計畫">
            操作前寫下條件與張數，讓每個決定有依據。
          </Outcome>
          <Outcome number="02" icon={<ScanLine />} title="看得懂自己的紀錄">
            把委託、成交與庫存對起來，知道發生了什麼。
          </Outcome>
          <Outcome number="03" icon={<BookOpen />} title="選得出下一次的重點">
            復盤留下觀察，一次練好一個動作。
          </Outcome>
        </div>
        <p className="mt-7 border-t border-border pt-5 text-base leading-7 text-muted">
          學習足跡呈現有紀錄的操作。條件未到，可以先觀察，不必為了完成課程硬下單。
        </p>
      </div>
    </section>
  );
}

function EntryActions({ unlocked }: { unlocked: boolean }) {
  return (
    <div className="no-print mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
      <Link to="/try" className="academy-button-primary !min-h-14 !text-base">
        體驗固定委託示例
        <ArrowRight className="shrink-0" aria-hidden="true" />
      </Link>
      <Link
        to="/"
        className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-5 py-3 text-center text-base font-semibold text-fg hover:bg-elevated"
      >
        {unlocked ? "回到我的教室" : "已有入場碼，進入教室"}
      </Link>
    </div>
  );
}

function Audience() {
  return (
    <Section id="audience" eyebrow="從自己的起點開始" title="適合誰來練？">
      <div className="grid gap-4 md:grid-cols-3">
        <Fact
          label="第一次接觸下單畫面"
          body="想先弄懂買賣方向、張數、委託與成交，不急著投入真實資金。"
        />
        <Fact
          label="操作過，想建立紀律"
          body="想把進出場條件寫清楚，練習等待、停損與收盤前的部位核對。"
        />
        <Fact
          label="想有人一起看復盤"
          body="願意回看自己的紀錄、說明操作理由，再和講師討論下一次要練什麼。"
        />
      </div>
    </Section>
  );
}

function Courses() {
  return (
    <Section id="courses" eyebrow="三階段 · 六組課程任務" title="從跟著做，到自己完成復盤">
      <p className="max-w-3xl text-base leading-8 text-muted">
        六個主題用富邦的真實逐筆行情練習。從 2026/10/21 起，每個交易日收盤後多一堂早盤教材（09:00–10:30），每局 1 到 80
        檔股票。主題共用當天行情，並非六種預設走勢；實際堂數、上課節奏與講師回饋安排，由開課班級確認。
      </p>
      <div className="mt-8 space-y-8">
        {STAGES.map((stage, stageIndex) => {
          const courses = MORNING_EXERCISES.slice(stageIndex * 2, stageIndex * 2 + 2);
          return (
            <section
              key={stage.title}
              className="premium-course-stage grid gap-5 border-t border-border pt-7 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8"
              aria-labelledby={`stage-${stage.number}`}
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-brand">階段 {stage.number}</p>
                <h3
                  id={`stage-${stage.number}`}
                  className="mt-2 text-2xl font-semibold tracking-tight"
                >
                  {stage.title}
                </h3>
                <p className="mt-3 text-base leading-7 text-muted">{stage.description}</p>
                <p className="mt-4 text-sm text-subtle">{courses.length} 組課程任務</p>
              </div>
              <div className={`grid min-w-0 gap-4 ${courses.length > 1 ? "md:grid-cols-2" : ""}`}>
                {courses.map((course) => {
                  const index = MORNING_EXERCISES.indexOf(course);
                  return (
                    <section
                      key={course.id}
                      className="premium-course-card premium-catalog-card min-w-0 rounded-2xl border border-border bg-surface p-5 sm:p-6"
                    >
                      <div className="flex items-center gap-3 text-sm text-muted">
                        <span
                          className="premium-course-number font-mono text-3xl text-brand"
                          aria-hidden="true"
                        >
                          {String(index + 1).padStart(2, "0")}
                        </span>
                        <span>任務 {String(index + 1).padStart(2, "0")} · 真實 K 練習</span>
                      </div>
                      <h4 className="mt-4 text-xl font-semibold leading-snug">{course.title}</h4>
                      <p className="mt-3 text-base leading-7 text-muted">{course.principle}</p>
                      <details className="mt-4 border-t border-border pt-1">
                        <summary className="min-h-12 cursor-pointer py-3 text-base font-medium text-brand">
                          看這一課的三個步驟
                        </summary>
                        <ol className="list-decimal space-y-2 pl-6 text-base leading-7 text-muted">
                          {course.prep.map((step) => (
                            <li key={step}>{step}</li>
                          ))}
                        </ol>
                        <p className="mt-4 rounded-xl bg-surface-2 p-3 text-base leading-7">
                          <span className="font-medium">復盤想一想：</span>
                          {course.review[0]}
                        </p>
                      </details>
                      <a
                        className="academy-button-primary mt-4 !min-h-12"
                        href={`${import.meta.env.BASE_URL === "./" ? "https://rich.yilutek.com" : ""}/morning?exercise=${encodeURIComponent(course.id)}`}
                      >
                        練習這個主題 <ArrowRight aria-hidden />
                      </a>
                    </section>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </Section>
  );
}

function Practice() {
  return (
    <Section id="practice" eyebrow="每次都知道現在要做什麼" title="上課與練習，照這個節奏走">
      <ol className="grid gap-4 md:grid-cols-2">
        {[
          {
            title: "先定一個小目標",
            body: "講師說明情境與觀察重點。開始前，選好這次要練的動作，寫下操作條件。",
          },
          {
            title: "自己操作，逐步核對",
            body: "逐分鐘觀看真實行情。紙上委託量夠才成交：委託後碰到價格的真實成交累計到委託張數，才一次成交，不考慮排隊；條件沒出現時，也可以選擇等待。",
          },
          {
            title: "打開復盤，看見足跡",
            body: "查看自己的計畫、成交與結束時庫存，對照交易成本並保存觀察。真實早盤紀錄目前在該練習頁查看；舊課程講師回饋另外保留。",
          },
          {
            title: "帶著一個重點再練",
            body: "把下一次只想改善的一件事寫進本次復盤，保存後可回真實早盤頁查看。重練已看過的行情，不等於首次未知行情的表現。",
          },
        ].map((step, index) => (
          <li
            key={step.title}
            className="flex min-w-0 gap-4 rounded-2xl border border-border bg-surface p-5"
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/10 font-mono text-base text-brand">
              {index + 1}
            </span>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold">{step.title}</h3>
              <p className="mt-2 text-base leading-7 text-muted">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <p className="mt-5 border-l-2 border-brand pl-4 text-base leading-8">{LICENSE_ONE_LINER}</p>
    </Section>
  );
}

function Devices() {
  return (
    <Section id="devices" eyebrow="用熟悉的裝置，照自己的步調" title="手機、iPad 與桌機都能練">
      <div className="grid gap-4 sm:grid-cols-2">
        <Device
          icon={<Smartphone size={30} />}
          title="手機"
          body="盤面分區切換，查看行情、委託與庫存；直向拿著也能跟著步驟操作。"
        />
        <Device
          icon={<Tablet size={30} />}
          title="iPad／平板"
          body="畫面依可用寬度調整，橫向與直向都能瀏覽課程、盤面和復盤。"
        />
        <Device
          icon={<Monitor size={30} />}
          title="桌機"
          body="較寬的畫面方便並排查看圖表與操作資訊，適合講師示範和課後複習。"
        />
        <Device
          icon={<TextCursorInput size={30} />}
          title="大字模式"
          body="可把文字大小切到「大字」，放大文字和主要操作區；不用趕，先看清楚再操作。"
        />
      </div>
      <p className="mt-4 text-base leading-7 text-muted">
        真實行情版使用逐分鐘紙上委託與閃電下單（僅教室模擬）。五檔在有錄到的日子顯示真實五檔，其他日子只有買一賣一。
      </p>
    </Section>
  );
}

function Enrollment() {
  return (
    <Section id="enrollment" eyebrow="體驗後，再確認適合自己的班級" title="從體驗到正式入場">
      <ol className="grid gap-4 md:grid-cols-3">
        <li className="academy-card p-5">
          <p className="text-sm font-medium text-brand">01 / 先體驗</p>
          <h3 className="mt-3 text-lg font-semibold">熟悉模擬操作</h3>
          <p className="mt-2 text-base leading-7 text-muted">
            先使用免費體驗，了解畫面與練習方式，不用帳號即可開始。
          </p>
        </li>
        <li className="academy-card p-5">
          <p className="text-sm font-medium text-brand">02 / 確認班級</p>
          <h3 className="mt-3 text-lg font-semibold">和授課講師確認安排</h3>
          <p className="mt-2 text-base leading-7 text-muted">{LICENSE_PRICING_NOTE}</p>
        </li>
        <li className="academy-card p-5">
          <p className="text-sm font-medium text-brand">03 / 正式練習</p>
          <h3 className="mt-3 text-lg font-semibold">取得入場碼，建立帳號</h3>
          <p className="mt-2 text-base leading-7 text-muted">
            報名確認後依講師提供的方式入場，再登入個人帳號，提交自己的模擬復盤。
          </p>
        </li>
      </ol>
      <CourseInquiryForm />
      <div className="mt-5 rounded-2xl border border-border bg-surface-2 p-5">
        <h3 className="text-base font-semibold">報名前，一起確認這些內容</h3>
        <ul className="mt-3 grid gap-3 text-base leading-7 text-muted sm:grid-cols-2">
          {[
            "課程日期、實際堂數與上課方式",
            "費用、付款方式與取消退費約定",
            "帳號使用期間與包含的教材",
            "講師回饋方式、次數與提交期限",
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <Check className="mt-1 shrink-0 text-brand" aria-hidden="true" />
              {item}
            </li>
          ))}
        </ul>
        <p className="mt-4 border-t border-border pt-4 text-base leading-7 text-muted">
          {LICENSE_PAYMENT_NOTE} 建立帳號不代表已完成報名或付款。
        </p>
      </div>
    </Section>
  );
}

function Included() {
  return (
    <Section id="included" eyebrow="教材與使用範圍" title="教室授權／班級方案">
      <div className="grid gap-4 sm:grid-cols-2">
        {LICENSE_INCLUDED.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2" aria-label="行情資料與授權">
        {LICENSE_DATA.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
      <details className="mt-5 rounded-2xl border border-border bg-surface p-5">
        <summary className="min-h-12 cursor-pointer py-3 text-base font-semibold">
          查看線上／地端授權與帳號說明
        </summary>
        <div className="mt-3 grid gap-4 md:grid-cols-3">
          {LICENSE_SKUS.map((sku) => (
            <div key={sku.id} className="rounded-xl bg-surface-2 p-4">
              <h3 className="text-base font-semibold">{sku.name}</h3>
              <p className="mt-2 text-base leading-7 text-muted">{sku.includes}</p>
              <p className="mt-3 text-base font-medium text-brand">{sku.quote}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-base leading-7 text-muted">{SEAT_TODAY}</p>
        <p className="mt-3 text-base leading-7 text-muted">{SEAT_ROADMAP}</p>
      </details>
    </Section>
  );
}

function Risk() {
  return (
    <Section id="risk" eyebrow="先了解模擬教室的範圍" title="練習成果，回到紀錄來看">
      <p className="max-w-3xl text-base leading-8 text-muted">{DISCLAIMER}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        {LICENSE_EXCLUDED.map((item) => (
          <Fact key={item.id} label={item.title} body={item.body} />
        ))}
      </div>
    </Section>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="manual-section mb-14 scroll-mt-6 sm:scroll-mt-24">
      <div className="premium-section-heading mb-6">
        <p className="academy-eyebrow">{eyebrow}</p>
        <h2 className="mt-3 text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function Fact({ label, body }: { label: string; body: string }) {
  return (
    <div className="academy-card min-w-0 p-5">
      <h3 className="text-lg font-semibold">{label}</h3>
      <p className="mt-3 text-base leading-7 text-muted">{body}</p>
    </div>
  );
}

function Outcome({
  number,
  icon,
  title,
  children,
}: {
  number: string;
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="premium-outcome-row flex min-w-0 gap-4">
      <span
        className="premium-outcome-icon flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand/10 text-brand"
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="mb-1 font-mono text-xs text-muted" aria-hidden="true">
          {number}
        </p>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 text-base leading-7 text-muted">{children}</p>
      </div>
    </div>
  );
}

function Device({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="academy-card flex min-w-0 items-start gap-4 p-5">
      <span className="mt-1 shrink-0 text-brand" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-2 text-base leading-7 text-muted">{body}</p>
      </div>
    </div>
  );
}
