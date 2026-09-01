export async function submitPassword(password: string): Promise<{ ok: boolean; reason?: string }> {
  const code = password.trim();
  if (!code) return { ok: false, reason: "請輸入入場密碼" };

  if (import.meta.env.BASE_URL === "./") {
    const { offlineUnlock } = await import("./offline-unlock");
    return offlineUnlock(code);
  }

  try {
    const res = await fetch("/api/gate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password: code }),
    });
    const payload = (await res.json()) as { ok?: boolean; reason?: string };
    if (payload?.ok) return { ok: true };
    return { ok: false, reason: payload?.reason || "密碼錯誤" };
  } catch {
    return { ok: false, reason: "教室入口暫時連不上，再試一次。" };
  }
}
