import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@/components/app-shell";
import { GateProvider } from "@/lib/gate/context";
import { createHashHistory, createRootRoute, createRoute, createRouter, Link, Outlet, RouterProvider } from "@tanstack/react-router";
import { ManualPage } from "@/components/manual-page";
import { LicensePage } from "@/components/license-page";
import { TryExperience } from "@/components/try-experience";
import { SessionReport } from "@/components/session-report";
import { loadReviewState, saveReview } from "@/lib/game/persist";
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

const rootRoute = createRootRoute({ component: () => <GateProvider><Outlet /></GateProvider> });
const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: AppShell });
const manualRoute = createRoute({ getParentRoute: () => rootRoute, path: "/manual", component: ManualPage });
const licenseRoute = createRoute({ getParentRoute: () => rootRoute, path: "/license", component: LicensePage });
const tryRoute = createRoute({ getParentRoute: () => rootRoute, path: "/try", component: TryExperience });
const reviewRoute = createRoute({ getParentRoute: () => rootRoute, path: "/session/$id/review", component: OfflineReview });
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
