import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, LogOut, Printer } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { DisplayControls } from "@/components/display-controls";
import { SimChip } from "@/components/provenance";
import { cn } from "@/lib/utils";
import { useGate } from "@/lib/gate/context";
import { MORNING_EXERCISES } from "@/lib/morning-exercises";

export const MANUAL_VERSION = "2026-10-07-realk2";
const PDF_HREF = `/daytrade-tycoon-manual.pdf?v=${MANUAL_VERSION}`;
const GITHUB = "https://github.com/Kevin-Power/day-trade-tycoon";

const TOC = [
  { id: "brief", n: "00", label: "先認識你的教室" },
  { id: "what", n: "01", label: "這是什麼、給誰用" },
  { id: "play", n: "02", label: "學員怎麼玩" },
  { id: "lessons", n: "03", label: "教材課綱" },
  { id: "data", n: "04", label: "資料哪裡來" },
  { id: "broker", n: "05", label: "紙上委託與真實交易" },
  { id: "offline", n: "06", label: "地端教室" },
  { id: "rules", n: "07", label: "規則與成本" },
  { id: "risk", n: "08", label: "不承諾什麼" },
  { id: "agenda", n: "09", label: "上課前的五件事" },
] as const;

export function ManualPage() {
  const { lock } = useGate();
  return (
    <div className="academy-page manual-sheet min-h-dvh bg-bg text-fg">
      <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft />
            回大廳
          </Link>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <DisplayControls compact />
            <a
              href={PDF_HREF}
              download="當沖大富翁-說明書.pdf"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs text-fg hover:bg-elevated"
            >
              <Download />
              下載真實 K 教材 PDF
            </a>
            <Button type="button" size="sm" variant="header" onClick={() => window.print()}>
              <Printer />
              列印
            </Button>
            <button
              type="button"
              onClick={lock}
              className="icon-only inline-flex size-9 items-center justify-center rounded-sm border border-border-strong bg-surface text-muted hover:bg-elevated hover:text-fg"
              aria-label="登出"
            >
              <LogOut />
            </button>
          </div>
        </div>
      </header>

      <article className="mx-auto w-full max-w-5xl px-4 pb-24 pt-8 sm:px-6 sm:pt-12">
        <Cover />
        <Nav />
        <Brief />
        <What />
        <Play />
        <Lessons />
        <Data />
        <Broker />
        <Offline />
        <Rules />
        <Risk />
        <Agenda />
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
          <div className="text-sm text-fg">股文觀指教室 · 說明書</div>
        </div>
        <SimChip className="ml-auto hidden sm:inline" />
      </div>
      <p className="mb-3 text-xs tracking-[0.28em] text-muted">{MANUAL_VERSION}</p>
      <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
        當沖大富翁
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
        第一次使用，從「學員怎麼玩」開始。這份教材帶你認識下單、停損與復盤，也說明教室資料和真實市場的差異。
      </p>
      <ul className="mt-6 flex flex-wrap gap-2 text-micro">
        <Chip>真實分鐘 K · 紙上委託</Chip>
        <Chip tone="warn">實盤尚未接線</Chip>
        <Chip>兩日行情 · 六個練習主題</Chip>
        <Chip>非投資建議</Chip>
      </ul>
    </section>
  );
}

function Nav() {
  return (
    <nav
      aria-label="教材章節"
      className="academy-card mb-12 grid gap-1 p-4 sm:grid-cols-2 print:mb-8"
    >
      {TOC.map((t) => (
        <a
          key={t.id}
          href={`#${t.id}`}
          className="flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted hover:bg-elevated hover:text-fg"
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
    <Section id="brief" n="00" title="先認識你的教室">
      <p className="text-base leading-7 text-muted">
        從真實歷史分鐘行情開始，先寫計畫，再逐分鐘觀察，最後留下自己的復盤。
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-base">
          <tbody>
            <Row
              k="目前開放"
              v="真實早盤練習：2026/10/05、10/06，每日 5 檔各 90 根，共 900 根分鐘 K。回放時段 09:00–10:30，不是全日、全市場或每日自動更新。"
            />
            <Row
              k="練習方式"
              v="登入後選交易日與練習主題，寫計畫、逐分鐘回放、紙上委託、保存復盤。六個主題共用兩日行情，只揭露目前已完成分鐘。"
            />
            <Row
              k="行情來源"
              v="Yahoo Finance 歷史 1 分鐘 OHLC；保留來源開、高、低、收，不用日資料或大盤路徑生成個股 K 線。"
            />
            <Row
              k="舊情境與紀錄"
              v="舊情境仍停止啟動，歷史紀錄保留。六個新主題不是把舊劇本換成原日真實 K，也不代表六種預定走勢。"
            />
            <Row k="服務範圍" v="歷史行情教學與紙上模擬，沒有券商實盤下單、真錢交易或保證獲利。" />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function What() {
  return (
    <Section id="what" n="01" title="這是什麼、給誰用">
      <p className="text-base leading-7 text-muted">
        完成教室入場及個人帳號登入後，從大廳選擇練習主題，再選交易日。適合講師帶班，也可自行逐步觀察；等待條件出現可以是一次練習的選擇。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <Fact
          label="先熟悉操作"
          body="公開三分鐘體驗是固定委託範例，不顯示行情圖，也不使用真實行情或真實委託。"
        />
        <Fact
          label="真實 K 回放"
          body="兩個交易日各有 5 檔、90 分鐘資料；同一天切換商品共用一個時鐘，不能預看尚未揭露的 K 線。"
        />
        <Fact
          label="紀錄分開保存"
          body="真實早盤依帳號及交易日保存主題、計畫、進度與復盤；換日保留進度，回來保持暫停。舊版本機紀錄仍在大廳，兩套紀錄不混算。"
        />
      </div>
    </Section>
  );
}

function Play() {
  return (
    <Section id="play" n="02" title="學員怎麼玩">
      <ol className="space-y-5 text-base leading-7">
        <Step n="1" title="選交易日與主題，寫下計畫">
          先選 2026/10/05 或 10/06 及本輪主題，查看背景與規則。背景是事後蒐集的歷史參考，未驗證每筆在當日 09:00
          前已可取得。選擇觀察方向與商品，填寫理由、進場條件及停止條件，再保存計畫。
        </Step>
        <Step n="2" title="逐分鐘看真實 K">
          09:00 尚無完整分鐘 K。按「前進 1 分鐘」才揭露第一根；也可選每 2
          秒前進一分鐘的自動播放。離開分頁或重新進入會保持暫停。切換商品不改變時鐘。
        </Step>
        <Step n="3" title="核對紙上委託">
          先看完第一根完整 K，再決定是否送出 1–3
          張紙上委託。同時最多一筆待處理委託，可先撤回。送出不等於成交；下一分鐘資料到達後，才以該分鐘開盤價及資金、庫存條件處理。
        </Step>
        <Step n="4" title="查看成交與庫存">
          買進後才可依持有張數賣出。核對成交價、費稅、剩餘庫存與現金。10:00
          會先停下來，可寫復盤或延伸到 10:30；本課不會自動平倉。
        </Step>
        <Step n="5" title="保存復盤">
          填寫自己的觀察與下次重點，再結束並保存。等待中的委託會取消，剩餘庫存保留；取消與庫存狀態會如實記錄。完成計畫、曾經等待及完成復盤是操作紀錄，不是獲利能力認證。
        </Step>
      </ol>
      <p className="mt-5 text-base leading-7 text-muted">
        換日不會刪除原進度，回到原日期會恢復該日最新一輪與原主題。已有未完成練習時，先完成本輪復盤，再寫新計畫選另一主題；從大廳點選主題不會覆寫原計畫。
      </p>
      <p className="mt-3 text-base leading-7 text-muted">
        網路回覆失敗時，依頁面提示重試同一筆操作或重新載入進度；先確認已保存的狀態，再做下一步。不同分頁同時操作時，系統會要求重新載入最新進度。
      </p>
      <p className="mt-3 text-base leading-7 text-muted">
        手機使用可換行的大按鈕；桌機可並排查看圖表與紙上委託。可在頁首把文字大小切到「大字」。鍵盤用 Tab
        聚焦按鈕，再按 Enter 或 Space 啟動該按鈕。
      </p>
    </Section>
  );
}

function Lessons() {
  return (
    <Section id="lessons" n="03" title="六個真實回放練習">
      <p className="text-base leading-7 text-muted">
        六個主題共用 2026/10/05、10/06 的真實行情，沒有預定走勢或標準進場答案。只依當下已揭露的 K
        線與昨收判斷；條件未成立可以等待，整段不交易也能完成練習。
      </p>
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-xl text-left text-base">
          <thead className="bg-surface-2 text-muted">
            <tr>
              <th className="px-3 py-3">練習主題</th>
              <th className="px-3 py-3">練習原則</th>
              <th className="px-3 py-3">復盤想一想</th>
            </tr>
          </thead>
          <tbody>
            {MORNING_EXERCISES.map((exercise) => (
              <Tr
                key={exercise.id}
                cells={[
                  exercise.no + " · " + exercise.title,
                  exercise.principle,
                  exercise.review.join(" "),
                ]}
              />
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-base leading-7 text-muted">
        舊版 2026/08/24–08/26 的劇本情境仍停用；歷史復盤保留，不會重新標成真實行情成果。新的六個主題也不代表舊情境已取得原日真實分鐘資料。
      </p>
    </Section>
  );
}

function Data() {
  return (
    <Section id="data" n="04" title="資料哪裡來">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-base">
          <tbody>
            <Row
              k="分鐘 K"
              v="Yahoo Finance 歷史 1 分鐘 OHLC。每根直接使用來源開高低收；時間標籤是分鐘起點，整根在該分鐘結束後才揭露。不是即時或逐筆報價。"
            />
            <Row
              k="收價連線"
              v="只連接已完成分鐘的收盤價，點位標在分鐘結束時間；不能當作分鐘內逐筆江波路徑。缺漏不以生成價格補齊。"
            />
            <Row
              k="參考均值"
              v="前 5 個完整交易日收盤均值，不含本日，不是當日 SMA5。EMA11 只出現在教學文字，尚未計算或畫線。"
            />
            <Row
              k="未提供資料"
              v="分鐘成交量尚未核對，不顯示量柱、均價或量能訊號；沒有真實五檔或逐筆成交資料。"
            />
            <Row
              k="歷史背景"
              v="教材背景是事後蒐集的歷史參考，未驗證每筆在當日 09:00 前可取得，不是嚴格的盤前快照。"
            />
            <Row
              k="舊版紀錄"
              v="大廳保留的舊課成績來自先前教室生成行情，不會重新標成真實行情成果。"
            />
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-base leading-7 text-muted">
        目前只提供上述兩個交易日；來源若缺漏，需先補齊並核對，不能用日開高低收推算一條分鐘路徑代替。
      </p>
    </Section>
  );
}

function Broker() {
  return (
    <Section id="broker" n="05" title="紙上委託與真實交易的差異">
      <p className="text-base leading-7 text-muted">
        真實的是已提供的歷史分鐘開高低收。紙上成交採教材模型：送出後等待下一分鐘開盤，依可用資金與持有庫存處理。這不是券商回報，也沒有重現真實五檔排隊、流動性或滑價。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Fact
          label="目前可做"
          body="查看歷史 K、逐分鐘前進、買進持倉後賣出、撤回等待中的委託、核對成交及保存復盤。"
        />
        <Fact
          label="目前未提供"
          body="券商下單、真錢交易、即時行情、真實逐筆與五檔。舊版生成行情和閃電下單已停止提供。"
        />
      </div>
    </Section>
  );
}

function Offline() {
  return (
    <Section id="offline" n="06" title="地端教室">
      <p className="text-base leading-7 text-muted">
        新版離線包只提供使用手冊、固定委託操作範例與既有歷史復盤閱讀。生成行情練習已停止；離線包不包含真實分鐘回放，也不會下載整日未揭露行情供預看。
      </p>
      <p className="mt-4 text-base leading-7 text-muted">
        要進行真實 K
        練習，請連線後按大廳主題卡的「連線開始練習」，前往正式教室並登入個人帳號。舊版本機歷史紀錄保存在原瀏覽器；換裝置或清除資料可能無法再讀取。
      </p>
    </Section>
  );
}

function Rules() {
  return (
    <Section id="rules" n="07" title="規則與成本">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-base">
          <tbody>
            <Row
              k="紙上資金"
              v="每輪新臺幣 1,000 萬元；每筆 1–3 張，1 張為 1,000 股。先買進持有後才能賣出，不提供融資或放空。"
            />
            <Row
              k="委託"
              v="同時最多一筆等待中的紙上委託；可撤回。下一分鐘開盤資料到達後才處理，送出當下不代表成交。"
            />
            <Row
              k="時間"
              v="2026/10/05、10/06 各為 09:00–10:30；只揭露完整分鐘。10:00 暫停提示後可繼續觀察；最後一分鐘之後不能再前進。"
            />
            <Row
              k="教材手續費"
              v="買賣各 0.0855%（1.425‰ × 六折），每筆最低 20 元，逐筆四捨五入。這是固定教材估算，實際券商費率另行核對。"
            />
            <Row k="教材交易稅" v="賣出另估 0.15%，逐筆四捨五入；不是實際帳戶稅額確認。" />
            <Row
              k="估值"
              v="庫存按目前已揭露的分鐘收價估值；平均成本未含費用。仍需核對每筆費稅及現金。"
            />
            <Row
              k="結束練習"
              v="必須填寫復盤。系統取消等待中的委託，不強制平倉；剩餘庫存與取消紀錄會保留。"
            />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Risk() {
  return (
    <Section id="risk" n="08" title="不承諾什麼">
      <ul className="list-disc space-y-3 pl-5 text-base leading-7 text-muted">
        <li>這是教學與紙上模擬，不是投資建議、獲利保證或代操。</li>
        <li>真實歷史 K 不等於真實成交；紙上模型沒有完整重現滑價、排隊、斷線或流動性。</li>
        <li>重看同一天可能記得後續走勢，熟悉教材不代表能判斷未知行情。</li>
        <li>課程成績、等待與復盤紀錄不代表能力合格，也不能用來承諾未來報酬。</li>
      </ul>
    </Section>
  );
}

function Agenda() {
  return (
    <Section id="agenda" n="09" title="上課前的五件事">
      <ol className="space-y-5 text-base leading-7">
        <Step n="1" title="確認教材範圍">
          向講師確認開課安排。本版六個新主題共用 2026/10/05、10/06 的 5 檔早盤教材；舊劇本情境仍停用。
        </Step>
        <Step n="2" title="確認自己的帳號">
          入場碼與個人帳號用途不同；註冊不代表繳費，講師權限由管理員核准。課程安排與費用請看{" "}
          <Link to="/license" className="underline underline-offset-4">
            課程說明
          </Link>{" "}
          並向講師確認。
        </Step>
        <Step n="3" title="準備連線裝置">
          手機、平板及桌機可使用真實早盤頁；需要網路及登入。頁首可調整顯示模式，離線包只供閱讀。
        </Step>
        <Step n="4" title="先寫計畫">
          填寫觀察方向、商品、理由、進場與停止條件。這是復盤用文字，不是自動停損或下單訊號。
        </Step>
        <Step n="5" title="留時間做復盤">
          核對實際紙上委託、成交、費稅和剩餘庫存，再寫下這次觀察。確認保存完成後才離開；新一輪不會改寫已完成的紀錄。
        </Step>
      </ol>
    </Section>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-micro leading-relaxed text-subtle">
      <p>當沖大富翁 · 股文觀指教室 · {MANUAL_VERSION}</p>
      <p className="mt-1">原始碼 {GITHUB}</p>
      <p className="mt-1">
        本文件可列印、可下載 PDF，供課前準備與課後複習。內容以教學模擬功能為準。
      </p>
    </footer>
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

function Step({ n, title, children }: { n: string; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 font-mono text-micro text-subtle">{n}</span>
      <div>
        <div className="font-medium">{title}</div>
        <p className="mt-1 text-pretty text-muted">{children}</p>
      </div>
    </li>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <tr className="border-t border-border first:border-t-0">
      <th
        className={cn(
          "w-28 px-3 py-2 align-top font-medium text-muted sm:w-36",
          mono && "font-mono",
        )}
      >
        {k}
      </th>
      <td className="px-3 py-2 text-pretty">{v}</td>
    </tr>
  );
}

function Tr({ cells }: { cells: string[] }) {
  return (
    <tr className="border-t border-border">
      {cells.map((c, i) => (
        <td key={i} className="px-3 py-2 text-pretty">
          {c}
        </td>
      ))}
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
