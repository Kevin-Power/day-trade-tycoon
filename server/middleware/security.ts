interface SecurityEvent { req: { method: string }; }

export default async function securityHeaders(_event: SecurityEvent, next: () => unknown | Promise<unknown>) {
  const response = await next();
  if (!(response instanceof Response)) return response;
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set("Content-Security-Policy", "frame-ancestors 'self'; base-uri 'self'; object-src 'none'");
  if (process.env.BETTER_AUTH_URL?.startsWith("https://")) headers.set("Strict-Transport-Security", "max-age=31536000");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
