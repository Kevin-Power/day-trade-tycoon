import { useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChartNoAxesCombined } from "@/lib/icons";
import { useCurrentUserState } from "@/lib/auth/use-current-user";
import { loadMyProfile } from "@/lib/classroom-db";
import { fubonEntryAllowed } from "@/lib/broker/fubon-entry";

/**
 * The owner's 富邦唯讀行情 link, a tool in the desk bar (2026-10-27: it used to take a row of its own). Nobody
 * else sees it, students and guests never ask the broker route, and the feed page itself leaves it out.
 * The access check reveals only owner eligibility; it never starts the SDK.
 */
export function FubonEntry() {
  const { user } = useCurrentUserState();
  const userId = user?.id ?? null;
  const onFeed = useLocation({ select: (location) => (location.search as { feed?: string }).feed === "fubon" });
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let current = true;
    const abort = new AbortController();
    void fubonEntryAllowed({
      signedIn: userId !== null,
      loadRole: async () => (await loadMyProfile())?.role,
      probe: async () =>
        (await fetch("/api/broker/quotes?access=1", { cache: "no-store", signal: abort.signal, credentials: "same-origin" })).ok,
    }).then((ok) => {
      if (current) setAllowed(ok);
    });
    return () => {
      current = false;
      abort.abort();
    };
  }, [userId]);
  if (!allowed || onFeed) return null;
  return (
    <Link className="td-tool td-fubon-entry" to="/morning" search={{ feed: "fubon" }} aria-label="富邦唯讀行情" title="富邦唯讀行情（只有業主看得到）">
      <ChartNoAxesCombined aria-hidden />
      <span>富邦行情</span>
    </Link>
  );
}
