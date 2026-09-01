import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, LogOut, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useGate } from "@/lib/gate/context";

const VERSION = "2026-08-31 討論稿";
const PDF_HREF = "/daytrade-tycoon-manual.pdf";
const GITHUB = "https://github.com/Kevin-Power/day-trade-tycoon";

const TOC = [
  { id: "brief", n: "00", label: "給石大哥看的一頁" },
  { id: "what", n: "01", label: "這是什麼、給誰用" },
  { id: "play", n: "02", label: "學員怎麼玩" },
  { id: "lessons", n: "03", label: "本週課綱" },
  { id: "data", n: "04", label: "資料哪裡來" },
  { id: "broker", n: "05", label: "模擬盤與之後的實盤" },
  { id: "offline", n: "06", label: "地端教室" },
  { id: "rules", n: "07", label: "規則與成本" },
  { id: "risk", n: "08", label: "不承諾什麼" },
  { id: "agenda", n: "09", label: "跟石大哥要對的五件事" },
] as const;

export function ManualPage() {
  const { lock } = useGate();
  return (
    <div className="manual-sheet min-h-dvh bg-bg text-fg">
      <header className="no-print sticky top-0 z-20 border-b border-border bg-bg/92 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <Link
            to="/"
            className="inline-flex h-9 items-center gap-1.5 rounded-sm px-2 text-xs text-muted hover:bg-elevated hover:text-fg"
          >
            <ArrowLeft className="size-3.5" />
            回大廳
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={PDF_HREF}
              download="當沖大富翁-說明書.pdf"
              className="inline-flex h-9 items-center gap-1.5 rounded-sm border border-border-strong bg-surface px-3 text-xs text-fg hover:bg-elevated"
            >
              <Download className="size-3.5" />
              下載 PDF
            </a>
            <Button
              type="button"
              size="sm"
              variant="header"
              onClick={() => window.print()}
            >
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
        <span className="ml-auto hidden rounded-xs bg-tape/15 px-1.5 py-0.5 text-2xs tracking-wide text-tape sm:inline">
          模擬盤
        </span>
      </div>
      <p className="mb-3 text-xs tracking-[0.28em] text-muted">{VERSION}</p>
      <h1 className="text-balance text-4xl font-medium leading-tight tracking-tight sm:text-5xl">
        當沖大富翁
      </h1>
      <p className="mt-4 max-w-2xl text-pretty text-base leading-relaxed text-muted">
        給石大哥與講師坐下來對的那一份。盤面像券商現股當沖；加權用證交所每 5 秒指數；撮合是教室的；實盤 API 還沒接。
      </p>
      <ul className="mt-6 flex flex-wrap gap-2 text-micro">
        <Chip>模擬撮合已開</Chip>
        <Chip tone="warn">實盤尚未接線</Chip>
        <Chip>課綱凍結 8/24–8/26</Chip>
        <Chip>非投資建議</Chip>
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
    <Section id="brief" n="00" title="給石大哥看的一頁">
      <p className="text-pretty leading-relaxed text-muted">
        股文觀指要的不是再做一個看盤軟體，是讓學員在像真的盤面上，把判斷、費稅、停損、部位、收盤平倉練到肌肉記得。這套就是那間教室。
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <tbody>
            <Row k="產品" v="台股現股當沖模擬教室。盤面比照券商：自選、江波、五檔、委託、庫存／成交。" />
            <Row k="現況" v="模擬撮合已開。學員可上課、可地端離線打、線上教室交易日 13:50 後可練最新完整盤。" />
            <Row k="還沒有" v="券商實盤下單、學員帳號登入、真錢、保證獲利。" />
            <Row k="資料邊界" v="加權＝證交所官方 5 秒指數。個股＝公開日成交套上同一條大盤節奏，不是逐筆成交。" />
            <Row k="之後接實盤" v="下單畫面已共用。接上券商只換 adapter，不必重做盤室。" />
            <Row k="商業用途" v="教室授權、班費、地端包。不是投顧、不是訊號、不是代操。" />
          </tbody>
        </table>
      </div>
      <blockquote className="mt-6 border-l-2 border-tape pl-4 text-sm leading-relaxed text-fg">
        一句話：路徑用官方指數、盤面像真的、下單是教室的。石大哥如果聽到「已經可以實盤下單」，那是講錯了。
      </blockquote>
    </Section>
  );
}

function What() {
  return (
    <Section id="what" n="01" title="這是什麼、給誰用">
      <p className="text-pretty leading-relaxed text-muted">
        學員先過入場密碼，再進大廳選一盤。進盤室後看到的是國票風格的現股當沖：黃帶、紫量、紅漲綠跌、1 張＝1,000 股。時間軸從 09:00 走到 13:30，可加速、可暫停。課綱會在關鍵分鐘自動停下來講。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
        <Fact label="給誰" body="股文觀指常態班／每日學習班學員。講師帶打、學員自己復盤。" />
        <Fact label="不給誰" body="要跟單、要保證獲利、要把教室當券商下單的人。那不是這份產品。" />
        <Fact label="戰績怎麼存" body="進教室要入場密碼（講師發，全班同一組）。戰績存在該機瀏覽器，沒有雲端帳號。" />
      </div>
    </Section>
  );
}

function Play() {
  return (
    <Section id="play" n="02" title="學員怎麼玩">
      <ol className="space-y-4 text-sm leading-relaxed">
        <Step n="1" title="大廳選課">
          建議依序：開盤觀察 → 週一殺盤 → 早盤下殺 → V 轉 → 週三攻高 → 期末考。線上教室另外有「自由練習」，是教材週之後的完整交易日。
        </Step>
        <Step n="2" title="先聽講解，再動手">
          進盤室會先暫停。黃虛線是昨收、藍線是均價。Space 繼續。教學模式會在關鍵分鐘再停一次，把該看的指給你。
        </Step>
        <Step n="3" title="看盤，再下單">
          左欄自選、中間江波／分價、右欄五檔與內外盤。委託單選買進或賣出、限價或市價、張數、價格。Enter 送單，Space 暫停。模擬盤目前只吃 ROD。
        </Step>
        <Step n="4" title="部位與出場">
          單檔建議不超過權益 30%。進場同時寫停損。13:20 還沒平，就是紀律破了；系統會在收盤前市價清倉。
        </Step>
        <Step n="5" title="復盤">
          收盤後對照課綱：有沒有追價、有沒有被費稅吃掉、有沒有攤平。戰績寫進生涯損益，用來升段位，不是用來對外吹牛。
        </Step>
      </ol>
      <div className="mt-6 overflow-hidden rounded-lg border border-border">
        <div className="pane-title flex h-7 items-center px-3 text-xs">盤室快捷</div>
        <table className="w-full text-left text-sm">
          <tbody>
            <Row k="Space" v="暫停／繼續。講解卡片出現時，Space 是「我看完了」。" mono />
            <Row k="Enter" v="送出目前委託。講解未關時不會送。" mono />
            <Row k="買進／賣出" v="委託單上方切換。紅色買、綠色賣，跟台股習慣一致。" />
            <Row k="通路 實盤" v="現在點了只會提示尚未接線，不會真的送到券商。" />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Lessons() {
  return (
    <Section id="lessons" n="03" title="本週課綱">
      <p className="text-pretty leading-relaxed text-muted">
        教材凍結在 2026/08/24–08/26 三個交易日。路徑不改，是因為暫停點綁在真實分鐘：週三 09:00:20 的低點、週二 11:00 的低點，不能每天被新盤蓋掉。
      </p>
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-xl text-left text-sm">
          <thead className="bg-surface-2 text-micro tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">課</th>
              <th className="px-3 py-2 font-medium">盤</th>
              <th className="px-3 py-2 font-medium">練什麼</th>
              <th className="px-3 py-2 font-medium">加權重點</th>
            </tr>
          </thead>
          <tbody className="text-fg">
            <Tr cells={["第 1 課", "8/26 開盤 45 分", "成本與第一槍", "09:00:20 探 44,926 再拉回"]} />
            <Tr cells={["第 2 課", "8/24 全日", "不接飛刀", "開高走低，收在最低 44,762"]} />
            <Tr cells={["第 3 課", "8/25 早盤 90 分", "停損寫在進場", "開盤 20 秒殺到 44,422"]} />
            <Tr cells={["第 4 課", "8/25 10:00 起", "順勢抱單", "11:00 印出 44,210，收在最高"]} />
            <Tr cells={["第 5 課", "8/26 全日", "停利比停損難", "收 45,833，漲 663 點"]} />
            <Tr cells={["期末考", "8/26 全日 × 2 倍額度", "自己執行六式", "本金 500 萬，錯一次很痛"]} />
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        當沖六式每盤都用：先算成本、江波對昨收、五檔與分價、停損寫在進場、部位三成、收盤前平倉。
      </p>
    </Section>
  );
}

function Data() {
  return (
    <Section id="data" n="04" title="資料哪裡來">
      <p className="text-pretty leading-relaxed text-muted">
        跟石大哥討論時這張表最重要。教室用真實大盤當骨架，個股不是證交所逐筆。講成「跟券商看的一模一樣」，是誇大。
      </p>
      <div className="mt-5 overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-xl text-left text-sm">
          <thead className="bg-surface-2 text-micro tracking-wide text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">項目</th>
              <th className="px-3 py-2 font-medium">真實來源</th>
              <th className="px-3 py-2 font-medium">教室怎麼用</th>
            </tr>
          </thead>
          <tbody>
            <Tr
              cells={[
                "加權指數",
                "證交所 MI_5MINS，09:00–13:30 每 5 秒，3,241 筆",
                "原樣重播。開盤價用官方 09:00:05",
              ]}
            />
            <Tr
              cells={[
                "大盤成交金額",
                "證交所 FMTQIK 全日成交金額",
                "顯示為億。盤中量能曲線是教室配的",
              ]}
            />
            <Tr
              cells={[
                "個股開高低收",
                "公開日成交（FinMind TaiwanStockPrice）",
                "釘在當日 O/H/L/C。17 檔權值與觀察股",
              ]}
            />
            <Tr
              cells={[
                "個股分鐘／逐筆",
                "沒有官方 1 分 K、沒有逐筆成交",
                "用大盤 5 秒節奏投影，再收到當日收盤",
              ]}
            />
            <Tr
              cells={[
                "五檔、內外盤、分價",
                "不是行情商後台",
                "依流動性與成交模擬。用來練讀盤，不是用來對價",
              ]}
            />
            <Tr
              cells={[
                "教材週 8/24–26",
                "上述官方數列，已內建",
                "凍結。每日更新不會覆蓋這三天",
              ]}
            />
            <Tr
              cells={[
                "自由練習",
                "每個交易日收盤後（約 13:50）再抓完整盤",
                "線上教室自動更新。地端包不連網，只用教材週",
              ]}
            />
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        個股江波看起來會跟大盤呼吸在一起，因為本來就是用指數當節奏。台積電、台達電、鴻海當日收盤是公開數字；盤中每一跳不是交易所那一筆。
      </p>
    </Section>
  );
}

function Broker() {
  return (
    <Section id="broker" n="05" title="模擬盤與之後的實盤">
      <p className="text-pretty leading-relaxed text-muted">
        委託單已經做成券商那張：帳號、盤別現股當沖、通路模擬／實盤、TIF ROD／IOC／FOK、買進賣出、限價市價、張數與價格。現在通路停在模擬，帳號 CLASSROOM-SIM。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Fact
          label="現在（模擬）"
          body="教室引擎撮合。TIF 只吃 ROD。費稅、漲跌停、收盤強平都在教室裡算完。點實盤會提示，不會送出。"
        />
        <Fact
          label="之後（實盤）"
          body="只換 src/lib/broker 這層。金鑰放伺服器，不進瀏覽器。上實盤前一定要先做學員登入。還沒接哪一家券商。"
        />
      </div>
      <ol className="mt-5 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>簽券商 API 合約，拿到測試帳再拿正式帳。</li>
        <li>伺服器環境變數設定券商位址。不要寫進前端。</li>
        <li>把 liveBroker 接到現有的下單入口。回傳碼對齊教室的成功／失敗。</li>
        <li>先做登入與權限。沒有身份的實盤，等於把金鑰敞著。</li>
        <li>先小額、先白名單學員，再談全班。</li>
      </ol>
      <p className="mt-4 text-sm leading-relaxed text-muted">
        這條路是有的，但不是這份說明書要賣的現況。現況能賣的是教室。
      </p>
    </Section>
  );
}

function Offline() {
  return (
    <Section id="offline" n="06" title="地端教室">
      <p className="text-pretty leading-relaxed text-muted">
        教室電腦常常不能連外網。大廳可下載地端包，解壓後雙擊 START.bat，瀏覽器開起來就能打。不必安裝、不必帳號、不必網路。
      </p>
      <ul className="mt-4 space-y-2 text-sm leading-relaxed text-muted">
        <li>地端只內建教材週 8/24–8/26。不會去抓最新盤，免得教室斷線或被擋。</li>
        <li>戰績存在那台電腦的瀏覽器。換機、清資料就沒了。</li>
        <li>線上教室才有每日自由練習。兩個版本同一套規則，課不會講兩套話。</li>
      </ul>
    </Section>
  );
}

function Rules() {
  return (
    <Section id="rules" n="07" title="規則與成本">
      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-sm">
          <tbody>
            <Row k="顏色" v="紅漲綠跌。跟台股習慣，不跟美股。" />
            <Row k="單位" v="1 張 = 1,000 股。價格跳動依證交所檔距。" />
            <Row k="漲跌停" v="±10%。掛在停板外的單不會成交。" />
            <Row k="時間" v="09:00–13:30。可 4x／6x／8x。教材開盤那課最慢。" />
            <Row k="手續費" v="約 0.0855%（1.425‰ × 六折），最低 20 元。" />
            <Row k="當沖稅" v="賣出 0.15%。" />
            <Row k="來回成本" v="約 0.32%。價差不夠這條線，這筆就不該出手。" />
            <Row k="強平" v="收盤前未平倉，系統市價出場。當沖不是投資。" />
          </tbody>
        </table>
      </div>
    </Section>
  );
}

function Risk() {
  return (
    <Section id="risk" n="08" title="不承諾什麼">
      <ul className="space-y-3 text-sm leading-relaxed text-muted">
        <li>這不是投資建議，不是獲利保證，不是代操。</li>
        <li>教室成績不能外推到實盤。實盤有滑價、排隊、斷線、情緒，教室沒有全部模擬到。</li>
        <li>個股盤中路徑不是交易所逐筆。用它練節奏可以，用它對價不行。</li>
        <li>實盤按鈕看得到，是為了以後接線；現在按了不會下真單。</li>
        <li>沒有向金管會申請的證券業務。產品定位是教學模擬。</li>
      </ul>
    </Section>
  );
}

function Agenda() {
  return (
    <Section id="agenda" n="09" title="跟石大哥要對的五件事">
      <ol className="space-y-4 text-sm leading-relaxed">
        <Step n="1" title="先賣教室，還是先等實盤？">
          建議先賣教室。課綱、地端包、每日練習已經能開班。實盤是下一張合約，不該擋這一期開課。
        </Step>
        <Step n="2" title="授權怎麼算？">
          可以談：班級授權、地端包授權、講師帳。現在是全班同一組入場密碼，還沒有按人頭雲端帳號。
        </Step>
        <Step n="3" title="要不要接哪一家券商？">
          下單畫面已預留。選哪一家、測試帳、正式帳、誰付 API 費，是石大哥跟券商的事。教室端只換 adapter。
        </Step>
        <Step n="4" title="學員資料放哪？">
          入場之後戰績仍放本機。若要跨機戰績、排行、繳費，再做每人帳號。沒有身份就上實盤，不建議。
        </Step>
        <Step n="5" title="對外怎麼講？">
          可以講：真實加權 5 秒、真實當日開高低收、券商風格盤面、課綱帶打。不可以講：逐筆行情、已經能實盤下單、保證會賺。
        </Step>
      </ol>
    </Section>
  );
}

function Colophon() {
  return (
    <footer className="mt-16 border-t border-border pt-6 text-micro leading-relaxed text-subtle">
      <p>當沖大富翁 · 股文觀指教室 · {VERSION}</p>
      <p className="mt-1">
        原始碼 {GITHUB}
      </p>
      <p className="mt-1">本文件可列印、可下載 PDF，給石大哥與講師當面過。內容以產品現況為準，實盤未接線前請勿對外宣稱可下真單。</p>
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
      <th className={cn("w-28 px-3 py-2 align-top font-medium text-muted sm:w-36", mono && "font-mono")}>
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

