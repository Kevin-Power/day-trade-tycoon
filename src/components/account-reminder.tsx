import { loginHref } from "@/lib/safe-next";

/**
 * Lobby, first card for a visitor who passed the entry code but is not logged in (2026-11-11, the owner:
 * 「提醒同學登入使用請申請帳號 以便協助記錄下次登入即可繼續」). Guests can still practise; this only says what they lose.
 */
export function AccountReminder() {
  return (
    <section className="account-reminder" aria-labelledby="account-reminder-title">
      <h2 id="account-reminder-title">請先登入再練習</h2>
      <p>第一次來請先申請帳號。登入後練習紀錄會保存，下次登入就能接著練。</p>
      <div className="account-reminder-actions">
        <a href={loginHref({ next: "/", mode: "up" })} className="academy-button-primary">
          申請帳號
        </a>
        <a href={loginHref({ next: "/" })} className="academy-button-secondary">
          登入
        </a>
      </div>
    </section>
  );
}
