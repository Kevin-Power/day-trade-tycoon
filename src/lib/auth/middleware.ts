import { createMiddleware } from "@tanstack/react-start";

export const authMiddleware = createMiddleware({ type: "function" })
  .server(async ({ next }) => {
    const { getRequest } = await import("@tanstack/react-start/server");
    const { assertSameSiteRequest } = await import("./isolation.server");
    const { requireAuthenticatedUser } = await import("./verify.server");
    const { requireGateSession } = await import("../gate/session.server");
    assertSameSiteRequest();
    requireGateSession(getRequest().headers);
    const user = await requireAuthenticatedUser();
    return next({ context: { userId: user.id, user } });
  });
