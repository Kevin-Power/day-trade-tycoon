import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadReview } from "@/lib/game/persist";
import { SessionReport } from "@/components/result-screen";

export const Route = createFileRoute("/session/$id/review")({ component: ReviewRoute });

function ReviewRoute() {
  const { id } = Route.useParams();
  const [bundle, setBundle] = useState(() => loadReview(id) ?? loadReview());

  useEffect(() => {
    setBundle(loadReview(id) ?? loadReview());
  }, [id]);

  if (!bundle) {
    return (
      <main className="grid min-h-dvh place-items-center bg-bg p-6 text-fg">
        <div className="text-center">
          <p>找不到這份復盤。請從盤室結算後再開。</p>
          <Link to="/" className="mt-4 inline-block text-tape">
            回課綱
          </Link>
        </div>
      </main>
    );
  }

  return <SessionReport bundle={bundle} />;
}
