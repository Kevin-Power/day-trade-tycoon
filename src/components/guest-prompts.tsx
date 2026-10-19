import { useState } from "react";
import { UserPlus } from "@/lib/icons";
import { authClient } from "@/lib/auth/client";
import { PRACTICE_PATH } from "@/lib/morning-access";
import { loginHref } from "@/lib/safe-next";
import type { LinkNotice } from "@/lib/guest-link";

const SIGN_UP = loginHref({ next: PRACTICE_PATH, mode: "up" });

/** Non-blocking reminder shown above the desk while practising as a guest. */
export function GuestBanner() {
  const [switching, setSwitching] = useState(false);
  async function switchLearner() {
    setSwitching(true);
    try {
      await authClient.signOut();
    } finally {
      window.location.assign(PRACTICE_PATH);
    }
  }
  return (
    <div role="status" className="td-banner td-guest">
      <p>目前是訪客，建立帳號才會保存練習與之後的連續天數</p>
      <div className="td-banner-actions">
        <a className="td-button" data-variant="primary" href={SIGN_UP}>
          <UserPlus aria-hidden />
          建立帳號
        </a>
        <button type="button" className="td-button" disabled={switching} onClick={() => void switchLearner()}>
          {switching ? "正在換人…" : "換人練習"}
        </button>
      </div>
    </div>
  );
}

/** Large invitation after a guest finishes a round; "later" only hides it for this page. */
export function GuestSaveCard() {
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;
  return (
    <section className="td-guest-save" aria-labelledby="guest-save-title">
      <h2 id="guest-save-title">建立帳號，保存這次的練習</h2>
      <p>現在建立帳號，這一輪的計畫、操作與復盤都會搬進你的帳號。</p>
      <div className="td-banner-actions">
        <a className="td-button" data-variant="primary" href={SIGN_UP}>
          建立帳號
        </a>
        <button type="button" className="td-button" onClick={() => setHidden(true)}>
          之後再說
        </button>
      </div>
    </section>
  );
}

const LINK_NOTICE_TEXT: Record<LinkNotice, string> = {
  skipped: "你的帳號在這一天已有練習，訪客那一輪沒有保存。",
  failed: "訪客的練習這次沒有搬進帳號，請告訴講師。",
};

export function LinkNoticeBanner({ notice, onDismiss }: { notice: LinkNotice; onDismiss: () => void }) {
  return (
    <div role="status" className="td-banner td-guest">
      <p>{LINK_NOTICE_TEXT[notice]}</p>
      <div className="td-banner-actions">
        <button type="button" className="td-button" onClick={onDismiss}>
          知道了
        </button>
      </div>
    </div>
  );
}
