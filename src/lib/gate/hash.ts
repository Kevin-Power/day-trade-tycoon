/** Classroom gate digest. The plaintext code is not stored in source. */
export const GATE_HASH =
  "eba099de32d91b3c2e9377940f056dc61eec072d5d496c4a878a92352a78323d";

export async function digest(password: string): Promise<string> {
  const data = new TextEncoder().encode(password.trim());
  const buf = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function hashesMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
