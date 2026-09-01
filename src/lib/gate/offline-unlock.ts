import { GATE_HASH, digest, hashesMatch } from "@/lib/gate/hash";

/** Used only by the unzip-and-start pack, which has no API server. */
export async function offlineUnlock(password: string): Promise<{ ok: boolean; reason?: string }> {
  const hashed = await digest(password);
  if (!hashesMatch(hashed, GATE_HASH)) return { ok: false, reason: "密碼錯誤" };
  return { ok: true };
}
