// Return only bounded diagnostic fields; never include the URL, response body,
// headers, or raw fetch/parse error text in runtime state or logs.
export async function probeHealth(url, { fetchImpl = fetch, timeoutMs = 4000, now = () => performance.now() } = {}) {
  const started = now();
  const signal = AbortSignal.timeout(timeoutMs);
  const result = (ok, kind, status) => ({ ok, kind, durationMs: Math.max(0, Math.round(now() - started)), ...(status == null ? {} : { status }) });
  let parsing = false;
  try {
    const response = await fetchImpl(url, { signal, cache: 'no-store', redirect: 'error' });
    if (!response.ok) {
      // Release the failed response without parsing or retaining its body.
      try { await response.body?.cancel(); } catch { /* HTTP status is sufficient. */ }
      return result(false, 'http-error', response.status);
    }
    parsing = true;
    const value = await response.json();
    const ok = value?.ok === true || value?.status === 'ok' || value?.status === 'healthy';
    return result(ok, ok ? 'healthy' : 'unhealthy-payload', response.status);
  } catch (error) {
    const kind = signal.aborted || error?.name === 'TimeoutError' || error?.name === 'AbortError'
      ? 'timeout'
      : parsing && error instanceof SyntaxError ? 'invalid-json' : 'request-error';
    return result(false, kind);
  }
}
