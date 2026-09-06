import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

/**
 * Navigates to a document page in whichever way the current build supports.
 *
 * The online build mounts a TanStack router, so `/manual` and `/handbook` are
 * real routes. The offline classroom pack (`src/offline/main.tsx`) renders
 * `AppShell` with NO RouterProvider — rendering a `<Link>` there throws
 * ("Cannot read properties of null (reading 'stores')") and blanks the page.
 * So when a caller passes `onOpen`, we render a plain button instead.
 */
export function DocLink({
  to,
  onOpen,
  className,
  children,
}: {
  to: string;
  onOpen?: () => void;
  className?: string;
  children: ReactNode;
}) {
  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className={className}>
        {children}
      </button>
    );
  }
  return (
    <Link to={to} className={className}>
      {children}
    </Link>
  );
}
