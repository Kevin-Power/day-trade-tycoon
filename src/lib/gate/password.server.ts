import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password.trim(), salt, 64,
    { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
    (error, key) => error ? reject(error) : resolve(key)));
}
export function isGateHash(value: string | undefined): value is string {
  return typeof value === "string" && /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
}
/** Use locally to provision an environment file. Never log input or output. */
export async function createGatePasswordHash(password: string): Promise<string> {
  if (password.trim().length < 10 || password.length > 256) throw new Error("Entry code must be 10 to 256 characters");
  const salt = randomBytes(16).toString("hex");
  return ["scrypt", salt, (await derive(password, salt)).toString("hex")].join("$");
}
export async function verifyGatePassword(password: string, hash: string): Promise<boolean> {
  if (!isGateHash(hash) || !password.trim() || password.length > 256) return false;
  const [, salt, expected] = hash.split("$");
  return timingSafeEqual(await derive(password, salt), Buffer.from(expected, "hex"));
}
