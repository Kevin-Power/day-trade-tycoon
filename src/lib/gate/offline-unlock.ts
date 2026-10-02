/** Offline packages contain simulation only; access is granted when the package is delivered. */
export async function offlineUnlock(_password: string): Promise<{ ok: boolean; reason?: string }> {
  return { ok: true };
}
