/** Legacy preview route remains inert after standalone migration. */
export async function handleAuthPopupRequest(_request: Request): Promise<Response> {
  return new Response(null, { status: 302, headers: { location: "/login", "cache-control": "no-store" } });
}
