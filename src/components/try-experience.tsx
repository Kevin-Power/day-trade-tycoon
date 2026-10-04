import { useEffect, useReducer, useRef, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, ArrowRight, Check, CheckCircle2, ClipboardList, RotateCcw } from "lucide-react";
import { BrandMark } from "@/components/brand-mark";
import { DisplayControls } from "@/components/display-controls";
import {
  evaluateTrialAnswer,
  initialTrialPractice,
  trialPracticeReducer,
  type TrialQuestionStage,
  type TrialStage,
} from "@/lib/trial-practice";

const STEPS = ["確認委託", "查看成交", "看懂成本"];
const TOPICS: Record<TrialQuestionStage, { label: string; reminder: string }> = {
  review: { label: "確認張數", reminder: "1 張與 1 股不同，送出前先核對數量。" },
  waiting: { label: "查看成交", reminder: "已送出不等於已成交，先查原委託與手上張數。" },
  closed: { label: "計入成本", reminder: "先算買賣價差，再扣掉交易成本。" },
};
const PRIMARY =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-brand px-5 py-3 text-lg font-semibold text-brand-fg hover:brightness-95";
const SECONDARY =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-xl border border-border-strong bg-surface px-5 py-3 text-base font-medium text-fg hover:bg-elevated";
const TITLES: Record<TrialStage, string> = {
  review: "送出前，先看清楚這一張單",
  waiting: "已送出，還不代表已買到",
  filled: "看到成交，再確認手上張數",
  closed: "原價賣出，為什麼還是少了錢？",
  complete: "完成了！你剛剛練習了這三件事",
};

/** A fixed, memory-only example. It does not use the trading engine or learner records. */
export function TryExperience() {
  const [practice, dispatch] = useReducer(trialPracticeReducer, undefined, initialTrialPractice);
  const { stage, hintedTopics, restartedFrom } = practice;
  const heading = useRef<HTMLHeadingElement>(null);
  const previousStage = useRef(stage);
  const currentStep = stage === "review" ? 0 : stage === "waiting" || stage === "filled" ? 1 : 2;
  useEffect(() => {
    if (previousStage.current === stage) return;
    previousStage.current = stage;
    heading.current?.focus({ preventScroll: true });
    heading.current?.scrollIntoView({ block: "start" });
  }, [stage]);

  return (
    <div className="academy-page min-h-dvh bg-bg text-fg [overflow-wrap:anywhere]">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-3 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <BrandMark className="size-10" />
            <span className="text-lg font-semibold">當沖大富翁</span>
          </div>
          <DisplayControls />
          <Link
            to="/"
            className="flex min-h-12 items-center gap-2 text-base text-brand underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-5 shrink-0" aria-hidden="true" />
            教室入口
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-5 pb-12 pt-8 sm:px-8">
        <p className="text-base font-semibold text-brand">免費體驗 · 不用帳號</p>
        <h1 className="mt-3 text-3xl font-semibold leading-snug tracking-tight">
          照自己的步調，
          <br className="sm:hidden" />
          走完一次模擬操作
        </h1>
        <p className="mt-4 text-lg leading-8 text-muted">
          慢慢看、一步一步按。先練習確認委託、查看成交，再理解交易成本。
        </p>
        <p className="mt-3 text-base leading-7 text-muted">
          這是固定的教學範例，沒有真實下單，也不使用即時行情。不限時，可以重做。
        </p>
        <ol aria-label="體驗進度" className="my-7 grid grid-cols-3 gap-2">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={stage !== "complete" && currentStep === index ? "step" : undefined}
              className={`rounded-xl border px-2 py-3 text-center text-base leading-7 ${index <= currentStep ? "border-brand/30 bg-brand/10 text-brand" : "border-border bg-surface text-muted"}`}
            >
              <span className="mx-auto mb-1 flex size-7 items-center justify-center rounded-full bg-surface font-semibold">
                {index < currentStep || stage === "complete" ? (
                  <Check className="size-5" aria-label="已完成" />
                ) : (
                  index + 1
                )}
              </span>
              {label}
            </li>
          ))}
        </ol>
        <section aria-labelledby="try-step-title" className="academy-card p-5 sm:p-8">
          <p className="mb-2 text-base font-medium text-brand">
            {stage === "complete" ? "體驗完成" : `第 ${currentStep + 1} 步 / 共 3 步`}
          </p>
          <h2
            ref={heading}
            id="try-step-title"
            tabIndex={-1}
            className="scroll-mt-6 text-2xl font-semibold leading-snug focus:outline-none"
          >
            {TITLES[stage]}
          </h2>
          {restartedFrom && stage !== "complete" ? (
            <p className="mt-4 rounded-xl bg-bg p-4 text-base leading-7 text-muted">
              從「{TOPICS[restartedFrom].label}
              」再練，接著走完後面的步驟。本輪之前出現過的提示仍會保留，方便回看。
            </p>
          ) : null}
          {stage === "review" ? (
            <>
              <p className="mt-4 text-lg leading-8 text-muted">
                委託就是你送出的買賣要求。先確認名稱、方向、價格與數量。
              </p>
              <OrderCard status="尚未送出" />
              <Question
                key="review"
                topic="review"
                prompt="這張範例委託的數量是多少？"
                options={[
                  { value: "share", label: "1 股" },
                  { value: "lot", label: "1 張，也就是 1,000 股" },
                ]}
                feedback="看一下上方的「數量」。這個範例的 1 張是 1,000 股；張數與股數不同，送出前要先確認。"
                action="確認並送出範例委託"
                onAnswer={(choice) => dispatch({ type: "answer", stage: "review", choice })}
              />
            </>
          ) : null}
          {stage === "waiting" ? (
            <>
              <p className="mt-4 text-lg leading-8 text-muted">
                你已送出一筆範例委託，但還在等成交。此時手上仍是{" "}
                <strong className="text-fg">0 張</strong>。
              </p>
              <OrderCard status="等待成交" />
              <Question
                key="waiting"
                topic="waiting"
                prompt="接下來先做哪件事？"
                options={[
                  { value: "repeat", label: "再按一次買進" },
                  { value: "check", label: "查看這筆委託的成交狀態" },
                ]}
                feedback="先查看原來那筆委託。重複按買進會多送一張單；「已送出」和「已成交」是不同狀態。"
                action="查看這筆範例成交"
                onAnswer={(choice) => dispatch({ type: "answer", stage: "waiting", choice })}
              />
            </>
          ) : null}
          {stage === "filled" ? (
            <>
              <div className="mt-5 rounded-xl border border-brand/25 bg-brand/5 p-4">
                <p className="flex items-center gap-2 text-lg font-semibold text-brand">
                  <CheckCircle2 className="size-6 shrink-0" aria-hidden="true" />
                  範例買進已成交
                </p>
                <p className="mt-3 text-lg leading-8">教學範例股 · 每股 100 元 · 1 張</p>
                <p className="mt-2 text-lg leading-8">
                  手上張數：<strong>0 張 → 1 張</strong>
                </p>
              </div>
              <p className="mt-5 text-lg leading-8 text-muted">
                「平倉」是把手上的部位結清。接著把這 1 張以每股 100 元賣出，練習查看平倉後的結果。
              </p>
              <p className="mt-3 text-base leading-7 text-muted">
                本頁按下按鈕後會顯示預設的範例成交。正式練習時，仍要確認委託是否實際成交。
              </p>
              <button
                type="button"
                className={`${PRIMARY} mt-6`}
                onClick={() => dispatch({ type: "close-position" })}
              >
                範例平倉：賣出手上 1 張<ArrowRight className="size-5 shrink-0" aria-hidden="true" />
              </button>
            </>
          ) : null}
          {stage === "closed" ? (
            <>
              <p className="mt-4 text-lg leading-8 text-muted">
                範例賣出已成交，手上回到 <strong className="text-fg">0 張</strong>
                。買價和賣價相同，還要計入來回交易的成本。
              </p>
              <dl className="my-5 divide-y divide-border rounded-xl border border-border px-4 text-lg leading-8">
                <MoneyRow label="買進金額" value="100,000 元" />
                <MoneyRow label="賣出金額" value="100,000 元" />
                <MoneyRow label="買賣價差" value="0 元" />
                <MoneyRow label="範例來回總成本" value="100 元" />
              </dl>
              <p className="text-base leading-7 text-muted">
                為了練習計算，這裡假設來回總成本為 100
                元；不是實際費用或稅率。正式教室會另外列出費用與稅額。
              </p>
              <Question
                key="closed"
                topic="closed"
                prompt="扣除這筆範例成本後，結果是多少？"
                options={[
                  { value: "zero", label: "0 元，沒有賺也沒有賠" },
                  { value: "loss", label: "−100 元，少了交易成本" },
                  { value: "gain", label: "+100 元，多了交易成本" },
                ]}
                feedback="再看一次：買賣價差 0 元 − 來回總成本 100 元 = −100 元。成本會減少最後拿回的金額。"
                action="確認結果，完成體驗"
                onAnswer={(choice) => dispatch({ type: "answer", stage: "closed", choice })}
              />
            </>
          ) : null}
          {stage === "complete" ? (
            <>
              <ul className="my-6 space-y-4 text-lg leading-8">
                {[
                  "送出前，確認名稱、方向、價格與數量。",
                  "送出後，查看成交與手上張數，避免重複委託。",
                  "平倉後，把費用算進結果，留下復盤重點。",
                ].map((text) => (
                  <li key={text} className="flex items-start gap-3">
                    <CheckCircle2 className="mt-1 size-6 shrink-0 text-brand" aria-hidden="true" />
                    <span>{text}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-xl bg-bg p-4 text-base leading-7 text-muted">
                <p className="font-semibold text-fg">這次範例：價差 0 元 − 成本 100 元 = −100 元</p>
                <p className="mt-2">
                  完成體驗代表你走過一次操作流程。接著可以在講師帶領下，練習觀察、風險控管與復盤；這個範例不代表實際交易能力或獲利。
                </p>
              </div>
              <section
                aria-labelledby="trial-review-title"
                className="mt-6 rounded-xl border border-border p-4 sm:p-5"
              >
                <h3 id="trial-review-title" className="text-xl font-semibold leading-8">
                  回看這次的練習
                </h3>
                {hintedTopics.length > 0 ? (
                  <>
                    <p className="mt-3 text-base leading-7 text-muted">
                      這一輪曾顯示下面的說明提示。選一項再練，慢慢把步驟看清楚；這不是能力評分。
                    </p>
                    <ul className="mt-4 space-y-4">
                      {hintedTopics.map((topic) => (
                        <li key={topic} className="rounded-xl bg-bg p-4">
                          <p className="text-lg font-semibold">{TOPICS[topic].label}</p>
                          <p className="mt-2 text-base leading-7 text-muted">
                            {TOPICS[topic].reminder}
                          </p>
                          <button
                            type="button"
                            className={`${SECONDARY} mt-3`}
                            onClick={() => dispatch({ type: "retry-topic", stage: topic })}
                          >
                            <RotateCcw className="size-5 shrink-0" aria-hidden="true" />從
                            {TOPICS[topic].label}再練
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-3 text-base leading-7 text-muted">
                    這一輪沒有顯示答題提示。可以試著說出：送出前核對什麼、送出後查看什麼、平倉後怎麼算成本。
                  </p>
                )}
              </section>
              <Link to="/license" hash="course-inquiry" className={`${PRIMARY} mt-6`}>
                詢問課程與操作協助
                <ArrowRight className="size-5" aria-hidden="true" />
              </Link>
              <button
                type="button"
                className={`${SECONDARY} mt-3`}
                onClick={() => dispatch({ type: "restart" })}
              >
                <RotateCcw className="size-5" aria-hidden="true" />
                從頭開始新一輪
              </button>
              <Link to="/" className={`${SECONDARY} mt-3`}>
                已有入場碼，前往教室
              </Link>
            </>
          ) : null}
        </section>
        <p className="mt-6 text-base leading-7 text-muted">
          這段體驗不計入正式成績，也不儲存個人資料。提示紀錄只保留在這次開啟的頁面；重新整理或從頭開始新一輪，就會清空。
        </p>
      </main>
    </div>
  );
}

function OrderCard({ status }: { status: string }) {
  return (
    <div className="my-5 rounded-xl border border-border bg-bg p-4">
      <p className="flex items-center gap-2 text-base font-semibold text-brand">
        <ClipboardList className="size-5 shrink-0" aria-hidden="true" />
        範例委託 · {status}
      </p>
      <dl className="mt-3 divide-y divide-border text-lg leading-8">
        <MoneyRow label="名稱" value="教學範例股" />
        <MoneyRow label="方向" value="買進" />
        <MoneyRow label="每股價格" value="100 元" />
        <MoneyRow label="數量" value="1 張（1,000 股）" />
        <MoneyRow label="金額，不含成本" value="100,000 元" />
      </dl>
    </div>
  );
}
function MoneyRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold tabular-nums">{value}</dd>
    </div>
  );
}
function Question({
  topic,
  prompt,
  options,
  feedback,
  action,
  onAnswer,
}: {
  topic: TrialQuestionStage;
  prompt: string;
  options: readonly { value: string; label: string }[];
  feedback: string;
  action: string;
  onAnswer: (choice: string) => void;
}) {
  const [choice, setChoice] = useState("");
  const [message, setMessage] = useState("");
  return (
    <form
      className="mt-6"
      onSubmit={(event) => {
        event.preventDefault();
        const result = evaluateTrialAnswer(topic, choice);
        onAnswer(choice);
        if (result === "unanswered") {
          setMessage("先選一個答案，再按下面的按鈕。");
          return;
        }
        if (result === "hint") {
          setMessage(feedback);
          return;
        }
      }}
    >
      <fieldset>
        <legend className="mb-3 text-lg font-semibold leading-8">{prompt}</legend>
        <div className="space-y-3">
          {options.map((option) => (
            <label
              key={option.value}
              className={`flex min-h-14 cursor-pointer items-start gap-3 rounded-xl border p-4 text-lg leading-7 ${choice === option.value ? "border-brand bg-brand/5" : "border-border-strong hover:bg-bg"}`}
            >
              <input
                type="radio"
                name="answer"
                value={option.value}
                checked={choice === option.value}
                onChange={() => {
                  setChoice(option.value);
                  setMessage("");
                }}
                className="mt-1 size-5 shrink-0"
              />
              <span>{option.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {message ? (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-warn/25 bg-warn/5 p-4 text-base leading-7 text-fg"
        >
          {message}
        </p>
      ) : null}
      <button type="submit" className={`${PRIMARY} mt-5`}>
        {action}
        <ArrowRight className="size-5 shrink-0" aria-hidden="true" />
      </button>
    </form>
  );
}
