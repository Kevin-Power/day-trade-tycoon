import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, LogOut, Printer } from "@/lib/icons";
import { Button } from "@/components/ui/button";
import { DisplayControls } from "@/components/display-controls";
import { SimChip } from "@/components/provenance";
import { cn } from "@/lib/utils";
import { useGate } from "@/lib/gate/context";
import { MORNING_EXERCISES } from "@/lib/morning-exercises";

export const MANUAL_VERSION = "2026-10-28-lessons1";
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
        <Chip>富邦逐筆 · 紙上委託</Chip>
        <Chip tone="warn">實盤尚未接線</Chip>
        <Chip>每日真實教材 · 六個練習主題</Chip>
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
        從富邦的真實逐筆行情開始，先寫計畫，再逐分鐘觀察，最後留下自己的復盤。
      </p>
      <div className="mt-5 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-left text-base">
          <tbody>
            <Row
              k="目前開放"
              v="每日真實教材：從 2026/10/21 起，每個交易日收盤後、資料上架，就多一堂早盤練習。回放時段只有 09:00–10:30，只收上市普通股，不含上櫃與 ETF。"
            />
            <Row
              k="練習方式"
              v="登入後選交易日、練習主題與股票，寫計畫、逐分鐘回放、紙上委託、保存復盤。六個主題共用當天行情，只揭露目前已播放到的部分。"
            />
            <Row
              k="行情來源"
              v="富邦逐筆：富邦收盤後提供的逐筆成交與 1 分 K，分鐘 K 與逐筆成交逐分鐘核對過才開放。依真實成交的秒數重播，不是即時行情。"
            />
            <Row
              k="大盤指數"
              v="證交所每 5 秒發行量加權股價指數（MI_5MINS_INDEX）。每分鐘揭露後依當時真實的 5 秒值重播；09:00:00 是前一日收盤的佔位值，不列入，開盤取 09:00:05。"
            />
            <Row
              k="自選與選股"
              v="自選預設是前一交易日的熱門當沖名單，只顯示代號與名稱，收盤後才給學員看；上櫃股和當天沒有可練習資料的股票不放進預設，畫面會註明。前一交易日沒有名單，改用當天成交值前 5 名。體驗訪客不看名單，預設也是成交值前 5 名。每局 1 到 80 檔，開局前可以自己加減。"
            />
            <Row
              k="自選江波圖"
              v="自選報價每列右側的小江波圖：已揭露的每分鐘收盤價，昨收在中間。預設「放大」：每列依到目前為止的漲跌，自動用昨收 ±1%、2%、3%、5% 或 10% 的刻度，起伏比較明顯；切到「±10%」則和主圖同一刻度，各列可以直接比強弱。滑鼠停在小圖上會顯示刻度，每台裝置會記住自己的選擇。"
            />
            <Row
              k="舊情境與紀錄"
              v="先前的歷史分鐘課與舊劇本情境已停用。沒做完的舊局仍可打開，只能完成並復盤或放棄這局，不能前進或下單；歷史紀錄保留。六個主題不代表六種預定走勢。"
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
          label="真實逐筆回放"
          body="每個交易日一堂、90 分鐘；同一天切換股票共用一個時鐘，不能預看尚未揭露的 K 線與成交。"
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
          先選交易日、本輪主題與要練的股票（預設是前一交易日的熱門當沖名單，可自己加減，每局 1 到 80
          檔，開局後不能再改），查看規則。選擇觀察方向與商品後，可直接套用計畫範本（突破前高、回測平盤、先看不做）按「用這個計畫開始」，或選「自己寫」填寫理由、進場及停止條件後保存。
        </Step>
        <Step n="2" title="逐分鐘看真實行情">
          09:00 尚無完整分鐘 K。按頁首「+1 分」才揭露第一根，連同這一分鐘的真實成交；也可按「播放」連續前進（1x 每 2 秒、2x 每 1
          秒一分鐘）。離開分頁或重新進入會保持暫停。切換股票不改變時鐘。
        </Step>
        <Step n="3" title="核對紙上委託">
          先看完第一根完整 K，再決定是否送出紙上委託，每筆 1–400 張（可直接打數字，或按「快選」點選）。同時最多一筆待處理委託，可先撤回。送出不等於成交：量夠才成交，委託後碰到價格的真實成交累計到委託張數，才一次全部成交；不考慮排隊，所以對學員稍微有利。成交時再檢核資金與庫存。
        </Step>
        <Step n="4" title="查看成交與庫存">
          買進後才可依持有張數賣出。核對成交價、成交時間（到秒）、費稅、剩餘庫存與現金。10:00
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
        桌機是券商式四格：左上自選報價（第一列是加權指數），右上大盤，左下個股的圖、報價明細與五檔，右下下單、委託回報和委託／成交／庫存紀錄。平板把自選放在上方、個股與下單左右並排。手機照券商
        App 分成自選、行情、下單、庫存四頁，大按鈕可換行。可在頁首把文字大小切到「大字」。鍵盤用 Tab
        聚焦按鈕，再按 Enter 或 Space 啟動該按鈕。
      </p>
    </Section>
  );
}

function Lessons() {
  return (
    <Section id="lessons" n="03" title="六個真實回放練習">
      <p className="text-base leading-7 text-muted">
        六個主題共用當天的真實行情，沒有預定走勢或標準進場答案。只依當下已揭露的 K
        線、成交與昨收判斷；條件未成立可以等待，整段不交易也能完成練習。
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
              v="富邦的 1 分 K，每根直接使用開高低收，並和逐筆成交逐分鐘核對；時間標籤是分鐘起點，整根在該分鐘結束後才揭露。揭露後交易台把這一分鐘的真實逐筆成交，照真實的秒數在幾秒內重播，收在真實收盤價。這是歷史行情的重播，不是即時行情。"
            />
            <Row
              k="成交明細"
              v="富邦逐筆：每一筆都是真實成交，顯示時間（到秒）、價格與單量（張）。成交價等於當時賣價記外盤、等於買價記內盤，其他不標。"
            />
            <Row
              k="五檔"
              v="有錄到的日子顯示真實五檔（價格與掛單量，跟著成交一起跳動）；其他日子只有買一、賣一（取自最近一筆成交當時的買賣價），旁邊註明「這天沒有五檔掛單資料」。五檔掛單量不用於撮合。"
            />
            <Row
              k="熱門當沖名單"
              v="自選預設用前一交易日收盤後定格的熱門當沖名單，只顯示代號與名稱。要等課程日收盤後才練得到，看到名單時那天已經結束，所以不是對未來走勢的預測。上櫃股和當天沒有可練習資料的股票不放進預設；沒有名單時改用成交值前 5 名。"
            />
            <Row
              k="江波圖"
              v="連接已完成分鐘的收盤價，點位標在分鐘結束時間；刻度固定為昨收上下 10%，並標出漲停、跌停價。這不是分鐘內的逐筆江波路徑，缺漏不以生成價格補齊。"
            />
            <Row
              k="參考均值"
              v="前 5 個完整交易日收盤均值，不含本日，不是當日 SMA5。"
            />
            <Row
              k="EMA11／EMA24"
              v="交易台的江波圖與 K 線都畫 EMA11（淺藍）和 EMA24（紫）：以已揭露的一分鐘收盤價計算，從當天 09:00 第一分鐘起算（第一分鐘的收盤價當起始值）。只供觀察，不是買賣訊號；講師若有不同的計算方式，以講師說明為準。"
            />
            <Row
              k="未提供資料"
              v="沒有即時行情，也沒有實盤下單。只收上市普通股，上櫃股與 ETF 不在教材範圍；一檔股票當天的資料對不起來，就不開放練習，不會用生成價格補齊。"
            />
            <Row
              k="舊版紀錄"
              v="大廳保留的舊課成績來自先前教室生成行情，不會重新標成真實行情成果。"
            />
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-base leading-7 text-muted">
        只開放從 2026/10/21 起有完整逐筆的交易日，資料上架後才出現在日期清單；來源若缺漏，需先補齊並核對，不能用日開高低收推算一條分鐘路徑代替。
      </p>
    </Section>
  );
}

function Broker() {
  return (
    <Section id="broker" n="05" title="紙上委託與真實交易的差異">
      <p className="text-base leading-7 text-muted">
        真實的是富邦的逐筆成交與 1 分 K。紙上成交採教材規則「量夠才成交」：委託後碰到價格的真實成交累計到委託張數，才一次全部成交，市價用吃掉的那些成交的平均價；不考慮排隊，所以對學員稍微有利。這不是券商回報，也沒有重現真實排隊、流動性或滑價。
      </p>
      <div className="mt-5 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        <Fact
          label="目前可做"
          body="查看富邦的真實成交與 1 分 K、真實大盤，逐分鐘前進，用下單票或五檔（左買右賣）送紙上委託、買進持倉後賣出、撤回等待中的委託、核對委託回報與成交及保存復盤。"
        />
        <Fact
          label="目前未提供"
          body="券商下單、真錢交易與即時行情。真實五檔只有錄到的日子才有，其他日子只有買一賣一；舊版生成行情已停止提供。"
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
              v="每輪新臺幣 1,000 萬元；每筆 1–400 張，1 張為 1,000 股。張數欄可直接輸入或用上下鍵加減，也可按「快選」：1–7、10–70、15–75、100–400 四排格子，點一下就填好。先買進持有後才能賣出，不提供融資或放空。"
            />
            <Row
              k="委託"
              v="同時最多一筆等待中的紙上委託；可撤回。撮合只看委託送出之後才揭露的真實成交，送出當下不代表成交；等待中的委託顯示累計進度，例如「已累計 120／400 張」。到 10:30 量還不夠就取消：下單後一筆成交都沒有，原因寫「之後沒有成交」；有成交但都沒碰到委託價，寫「教材結束，委託未成交」；有碰到但量不夠，寫「成交量不足」。"
            />
            <Row
              k="市價與限價"
              v="量夠才成交：只算委託後碰到價格的真實成交（市價每一筆都算；限價買進成交價不高於限價、賣出不低於限價），累計到委託張數時整筆一次成交，不做部分成交。市價用吃掉的那些成交的平均價，最後一筆只算需要的張數；限價送出時就碰到價格（委託後的第一筆成交就碰到），一樣用平均價、不會比限價差；先掛著、之後才碰到，用限價。不考慮排隊順序，所以對學員稍微有利；五檔掛單量不用於撮合。限價須符合跳動單位，並在昨收上下 10% 內；成交時重新檢核資金與庫存。"
            />
            <Row
              k="成交時間"
              v="成交紀錄顯示到秒（時:分:秒），是累計到足量的那一筆真實成交的時間。多筆累計的平均價不在跳動單位上時，顯示到小數兩位。"
            />
            <Row
              k="五檔點價"
              v="五檔左邊是委買、右邊是委賣：點左邊的價格是以該價限價買進，點右邊的價格是以該價限價賣出（需有庫存）。沒開「閃電即送」時只帶入下單票，核對後才送出；開啟後點一下就送出。五檔下方的「每筆張數」和下單票的張數相同，也可按「快選」。手機行情頁的五檔只把價格帶到下單頁。"
            />
            <Row
              k="大額委託"
              v="買進參考金額達可用資金一半以上，確認卡會標出金額與占比，要勾選「我已確認這是大額委託」才能送出；開啟閃電即送時也不直接送出，改打開確認卡。賣出不受此限。"
            />
            <Row
              k="委託回報"
              v="下單票下方依時間列出最近 5 筆：委託成功、成交、撤回、未成交，以及送出失敗（紅字）。連線中斷或逾時改列「回覆不明」（黃字）：教室可能已收到這筆委託。「重試這次操作」重送的是同一筆，不會重複下單；按「重新載入進度」後，教室已收到的委託會列為委託成功，這一列隨之消失。送出失敗與回覆不明只記在這次瀏覽，重新整理後消失；畫面上的錯誤提示照舊。"
            />
            <Row
              k="時間"
              v="每個交易日 09:00–10:30；只揭露完整分鐘。10:00 暫停提示後可繼續觀察；最後一分鐘之後不能再前進。"
            />
            <Row
              k="教材手續費"
              v="買賣各 0.0855%（1.425‰ × 六折），每筆最低 20 元，逐筆四捨五入。這是固定教材估算，實際券商費率另行核對。"
            />
            <Row k="教材交易稅" v="賣出另估 0.15%，逐筆四捨五入；不是實際帳戶稅額確認。" />
            <Row
              k="估值"
              v="庫存按目前播放到的最新成交價估值（播完一分鐘後是該分鐘收價）；平均成本未含費用。仍需核對每筆費稅及現金。"
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
        <li>市場上真的有成交，不代表你的委託也成交；紙上模型沒有完整重現滑價、排隊、斷線或流動性，量夠就成交、不必排隊，結果對學員稍微有利。</li>
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
          向講師確認開課安排。每個交易日收盤後多一堂早盤教材（從 2026/10/21 起），每局 1 到 80 檔，六個主題共用當天行情；舊劇本情境仍停用。
        </Step>
        <Step n="2" title="確認自己的帳號">
          入場碼與個人帳號用途不同；註冊不代表繳費，講師權限由管理員核准。課程安排與費用請看{" "}
          <Link to="/license" className="underline underline-offset-4">
            課程說明
          </Link>{" "}
          並向講師確認。
        </Step>
        <Step n="3" title="準備連線裝置">
          手機、平板及桌機可使用真實早盤頁；需要網路及登入。頁首可調整顯示模式，離線包只供閱讀，沒有每日教材。
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
