import { createFileRoute, redirect } from "@tanstack/react-router";

// The course and licence page is gone (2026-11-02, no prices or paid-course copy); old links land in the classroom.
export const Route = createFileRoute("/license")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
});
