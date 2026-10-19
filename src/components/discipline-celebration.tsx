import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "@tanstack/react-router";
import { Award, Sparkles } from "@/lib/icons";
import { SoundSwitch } from "@/components/display-controls";
import { useSay } from "@/components/use-speech";
import { playChime } from "@/lib/celebration-sound";
import { useDisplayPreferences } from "@/lib/display-preferences";
import { celebrationHeadline, celebrationSpeech, cheerFor, levelProgress, progressText } from "@/lib/discipline/copy";
import type { Celebration } from "@/lib/discipline/score";

/**
 * Shown in the page after a daily answer or a finished round: the points and why, the level bar, a
 * level-up banner and new badges. It never blocks the next step; reduced motion shows the end state.
 */
export function DisciplineCelebration({ celebration }: { celebration: Celebration }) {
  const sound = useDisplayPreferences((state) => state.sound);
  const setSound = useDisplayPreferences((state) => state.setSound);
  const say = useSay();
  const { after, total, gained, newBadges } = celebration;
  const levelUp = after.no > celebration.before.no;
  const announced = useRef<Celebration | null>(null);
  // Filled a tick after the card appears: screen readers announce a status region whose text changes.
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    if (announced.current === celebration) return;
    // Next tick: a parent's effect (the reveal headline) runs after this one and interrupts what is
    // queued, so the points are queued only once the page's own line has started.
    const timer = window.setTimeout(() => {
      announced.current = celebration;
      setAnnouncement(celebrationSpeech(celebration));
      say(celebrationSpeech(celebration), false);
      if (sound && celebration.points > 0) playChime(levelUp ? "level-up" : "points");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [celebration, levelUp, say, sound]);

  const from = levelUp ? 0 : levelProgress(after, celebration.beforeTotal);
  const to = levelProgress(after, total);
  const next = progressText(after, total);
  return (
    <section className="td-celebrate" data-level-up={levelUp ? "true" : undefined} aria-labelledby="td-celebrate-title">
      <p role="status" className="sr-only">
        {announcement}
      </p>
      {levelUp && (
        <div className="td-celebrate-levelup">
          <Sparkles aria-hidden className="td-celebrate-spark" />
          <p className="td-celebrate-kicker">升級！</p>
          <p className="td-celebrate-new">
            Lv{after.no} {after.title}
          </p>
          <p className="td-celebrate-cheer">{cheerFor(after.no)}</p>
        </div>
      )}
      <h3 id="td-celebrate-title">
        {celebrationHeadline(celebration)}
      </h3>
      {celebration.alreadyCounted && (
        <p className="td-celebrate-note">同一天的練習分只算最好的一輪；再練一輪是為了自己。</p>
      )}
      {gained.length > 0 && (
        <ul className="td-celebrate-lines">
          {gained.map((line) => (
            <li key={line.id} data-kind={line.kind}>
              <span>{line.label}</span>
              <b>+{line.points}</b>
            </li>
          ))}
        </ul>
      )}
      <div className="td-celebrate-level">
        <span className="td-level-chip">Lv{after.no}</span>
        <strong>{after.title}</strong>
        <span className="td-celebrate-total">總分 {total}</span>
      </div>
      <div
        className="td-celebrate-bar"
        role="progressbar"
        aria-label="升級進度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(to * 100)}
        aria-valuetext={next}
      >
        <span style={{ "--from": `${from * 100}%`, "--to": `${to * 100}%` } as CSSProperties} />
      </div>
      <p className="td-celebrate-next">{next}</p>
      {newBadges.length > 0 && (
        <ul className="td-celebrate-badges" aria-label="新徽章">
          {newBadges.map((badge) => (
            <li key={badge.id}>
              <Award aria-hidden />
              <span>
                <b>拿到徽章：{badge.title}</b>
                <small>{badge.rule}</small>
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="td-celebrate-foot">
        <p>分數只看練習習慣與紀律，不看賺賠。</p>
        <div className="td-celebrate-actions">
          <Link to="/progress" className="td-button">
            看我的紀律
          </Link>
          <SoundSwitch on={sound} onChange={setSound} className="td-celebrate-sound" />
        </div>
      </div>
    </section>
  );
}
