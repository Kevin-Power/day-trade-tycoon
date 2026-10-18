import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Award, Lock } from "lucide-react";
import { AccessCard } from "@/components/access-card";
import { DisplayControls } from "@/components/display-controls";
import { useGuestBootstrap } from "@/components/use-guest-bootstrap";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { useTerminalLayout } from "@/lib/use-terminal-layout";
import { describeAccessProblem } from "@/lib/morning-access";
import { dataDateText } from "@/lib/daily/reveal";
import { levelProgress, progressText } from "@/lib/discipline/copy";
import { LEVELS, type DisciplineSummary } from "@/lib/discipline/score";

type Problem = { status: number; message: string };

const RULES: { source: string; rows: [string, string][] }[] = [
  {
    source: "每日一題",
    rows: [
      ["完成作答", "+10"],
      ["說出理由（選一個理由標籤）", "+5"],
      ["眼力：判讀和後來的走勢一致", "+3"],
    ],
  },
  {
    source: "模擬練習（每天算最好的一輪）",
    rows: [
      ["完成一輪並寫下復盤", "+15"],
      ["只下計畫寫的那檔股票（沒下單也算）", "+5"],
      ["收盤前不留倉（沒下單也算）", "+5"],
    ],
  },
];

/** 我的紀律: level, how points are earned, badges, recent points and the level table. */
export function DisciplinePage() {
  const { status, retry } = useGuestBootstrap();
  const mode = useDisplayPreferences((state) => state.mode);
  const layout = useTerminalLayout(mode === "senior");
  const [data, setData] = useState<DisciplineSummary | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/discipline", { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message : "";
        return setProblem({ status: response.status, message });
      }
      setProblem(null);
      setData((await response.json()) as DisciplineSummary);
    } catch {
      setProblem({ status: 503, message: "暫時連不上教室，請稍後再試。" });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (status === "ready") void load();
  }, [status, load]);

  return (
    <div className="trading-desk td-daily td-progress" data-layout={layout} data-market-theme="dark">
      <header className="td-daily-head">
        <Link to="/" className="td-home" aria-label="返回教室大廳">
          <ArrowLeft aria-hidden />
          <span>大廳</span>
        </Link>
        <div className="td-daily-title">
          <h1>我的紀律</h1>
          <p>分數只看練習習慣與紀律，不看賺賠</p>
        </div>
        <DisplayControls compact className="td-size" />
      </header>
      <main className="td-daily-main">
        {status === "pending" && <p role="status" className="td-daily-card">正在準備…</p>}
        {status === "failed" && <AccessCard problem={describeAccessProblem(401, "")} busy={false} onRetry={retry} />}
        {status === "ready" && problem && (
          <AccessCard problem={describeAccessProblem(problem.status, problem.message)} busy={busy} onRetry={() => void load()} />
        )}
        {status === "ready" && !problem && !data && <p role="status" className="td-daily-card">正在讀取…</p>}
        {data && !problem && <DisciplineBody data={data} />}
      </main>
    </div>
  );
}

function DisciplineBody({ data }: { data: DisciplineSummary }) {
  const { level } = data;
  const earned = data.badges.filter((badge) => badge.earned).length;
  return (
    <>
      <section className="td-progress-level" aria-labelledby="progress-level-title">
        <div className="td-progress-level-head">
          <span className="td-level-chip">Lv{level.no}</span>
          <h2 id="progress-level-title">{level.title}</h2>
        </div>
        <dl className="td-progress-scores">
          <div>
            <dt>總分</dt>
            <dd>{data.total}</dd>
          </div>
          <div>
            <dt>紀律分</dt>
            <dd>{data.discipline}</dd>
          </div>
          <div>
            <dt>眼力分</dt>
            <dd>{data.eye}</dd>
          </div>
        </dl>
        <div
          className="td-celebrate-bar"
          role="progressbar"
          aria-label="升級進度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(levelProgress(level, data.total) * 100)}
          aria-valuetext={progressText(level, data.total)}
        >
          <span style={{ "--to": `${levelProgress(level, data.total) * 100}%` } as CSSProperties} />
        </div>
        <p className="td-progress-next">{progressText(level, data.total)}</p>
      </section>

      <section className="td-progress-card" aria-labelledby="progress-rules-title">
        <h2 id="progress-rules-title">怎麼得分</h2>
        {RULES.map((group) => (
          <table key={group.source} className="td-progress-rules">
            <caption>{group.source}</caption>
            <tbody>
              {group.rows.map(([label, points]) => (
                <tr key={label}>
                  <th scope="row">{label}</th>
                  <td>{points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        <p className="td-progress-note">有設停損、說出理由才是主要分數；眼力只是加分。分數不會扣，等級不會掉。</p>
      </section>

      <section className="td-progress-card" aria-labelledby="progress-badges-title">
        <h2 id="progress-badges-title">
          徽章 <span className="td-progress-count">{earned}／{data.badges.length}</span>
        </h2>
        <ul className="td-progress-badges">
          {data.badges.map((badge) => (
            <li key={badge.id} data-earned={badge.earned}>
              {badge.earned ? <Award aria-hidden /> : <Lock aria-hidden />}
              <div>
                <strong>{badge.title}</strong>
                <small>{badge.rule}</small>
                <small className="td-progress-badge-state">
                  {badge.earned && badge.earnedOn ? `${dataDateText(badge.earnedOn)} 取得` : `目前 ${badge.have}／${badge.need}`}
                </small>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="td-progress-card" aria-labelledby="progress-recent-title">
        <h2 id="progress-recent-title">最近得分</h2>
        {data.recent.length ? (
          <ul className="td-progress-recent">
            {data.recent.map((event) => (
              <li key={event.key}>
                <span>
                  {dataDateText(event.date)} {event.source === "daily" ? "每日一題" : "模擬練習"}
                </span>
                <b>+{event.points}</b>
              </li>
            ))}
          </ul>
        ) : (
          <p className="td-progress-note">還沒有得分。做一題每日一題，或完成一輪模擬練習，就會出現在這裡。</p>
        )}
        <div className="td-daily-next">
          <Link to="/daily" className="td-button">去做每日一題</Link>
          <Link to="/morning" search={{ panel: "trade" }} className="td-button" data-variant="primary">去模擬練習</Link>
        </div>
      </section>

      <section className="td-progress-card" aria-labelledby="progress-levels-title">
        <h2 id="progress-levels-title">等級表</h2>
        <ol className="td-progress-levels">
          {LEVELS.map((item) => (
            <li key={item.no} aria-current={item.no === level.no ? "step" : undefined}>
              <span>Lv{item.no}</span>
              <strong>{item.title}</strong>
              <small>{item.min} 分</small>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
