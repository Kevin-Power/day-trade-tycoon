import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { DisplayControls, DisplayPreferencesEffect } from "@/components/display-controls";
import { GateProvider } from "@/lib/gate/context";
import { createHashHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { ManualPage } from "@/components/manual-page";
import { LicensePage } from "@/components/license-page";
import { TryExperience } from "@/components/try-experience";
import { SessionReport } from "@/components/session-report";
import { loadProfile, loadReviewState, saveReview } from "@/lib/game/persist";
import { reviewSaveMessage } from "@/lib/game/review-storage-status";
import "@/styles.css";

const el = document.getElementById("app");
if (!el) throw new Error("missing #app");
// Manual/license section anchors must scroll without replacing the hash route.
document.addEventListener("click", (event) => {
  const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="#"]') : null;
  const href = anchor?.getAttribute("href");
  if (!href || href.startsWith("#/") || href.length < 2) return;
  const section = document.getElementById(decodeURIComponent(href.slice(1)));
  if (section) { event.preventDefault(); section.scrollIntoView({ behavior: "smooth" }); }
});

const rootRoute = createRootRoute({ component: () => <><DisplayPreferencesEffect /><GateProvider><Outlet /></GateProvider></> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: OfflineHome });
const manualRoute = createRoute({ getParentRoute: () => rootRoute, path: "/manual", component: ManualPage });
const licenseRoute = createRoute({ getParentRoute: () => rootRoute, path: "/license", component: LicensePage });
const tryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/try", component: TryExperience });
const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/session/$id/review", component: OfflineReview });
function OfflineHome() {
  const [profile] = useState(loadProfile);
  return (
    <main className="min-h-dvh bg-bg px-4 py-8 text-fg sm:px-8">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold">當沖大富翁 · 離線閱讀</h1>
          <DisplayControls />
        </header>
        <section className="rounded-2xl border border-border bg-surface p-5 sm:p-7">
          <h2 className="text-xl font-semibold">交易練習全面使用真實 K 線</h2>
          <p className="mt-3 text-base leading-8 text-muted">真實行情由線上教室逐分鐘揭露，避免提前看到後續走勢。請連上網路，登入教室開始練習。離線包不再啟動合成行情，也不包含尚未揭露的完整分鐘資料。</p>
          <a href="https://rich.yilutek.com/morning" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-brand px-4 py-3 text-base font-semibold text-brand-fg">開啟線上真實 K 線練習</a>
        </section>
        <nav aria-label="離線閱讀" className="flex flex-wrap gap-3">
          <Link to="/manual" className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 py-3">閱讀使用說明</Link>
          <Link to="/try" className="inline-flex min-h-12 items-center rounded-xl border border-border px-4 py-3">固定委託示例（非行情）</Link>
        </nav>
        <section className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-xl font-semibold">這台裝置的舊版復盤</h2>
          <p className="mt-2 text-base leading-7 text-muted">已保存的紀錄仍可閱讀；舊情境使用合成行情，不能視為真實市場驗證或重新啟動。紀錄不會自動同步到線上帳號。</p>
          {profile.history.length ? <ul className="mt-4 space-y-2">{profile.history.map(record => <li key={record.id}><Link to="/session/$id/review" params={{ id: record.id }} className="inline-flex min-h-12 items-center break-all py-2 text-brand underline underline-offset-4">查看復盤 · {record.scenarioId}</Link></li>)}</ul> : <p className="mt-4 text-base text-muted">目前沒有本機歷史紀錄。</p>}
        </section>
      </div>
    </main>
  );
}
function OfflineReview() {
  const { id } = reviewRoute.useParams();
  const [, refreshStorage] = useState(0);
  const review = loadReviewState(id);
  const bundle = review?.bundle;
  if (!bundle) return <main className="min-h-dvh bg-bg p-8 text-fg"><h1>本機沒有這份復盤</h1><p className="mt-3 text-sm text-muted">請回到原本練習的瀏覽器；離線紀錄不會自動同步。</p><Link to="/" className="mt-4 inline-block text-tape">回大廳</Link></main>;
  return <><div className="bg-surface px-4 py-3 text-center text-base leading-7 text-muted"><p role="status">離線復盤 · {reviewSaveMessage("local", review.localSaved)}</p>{!review.localSaved && <button type="button" className="mt-2 min-h-12 px-3 text-base text-tape" onClick={() => { saveReview(bundle); refreshStorage(value => value + 1); }}>重試保存到此裝置</button>}</div><SessionReport key={id} bundle={bundle} /></>;
}
const router = createRouter({ routeTree: rootRoute.addChildren([indexRoute, manualRoute, licenseRoute, tryRoute, reviewRoute]), history: createHashHistory(), defaultPreload: false });

createRoot(el).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
