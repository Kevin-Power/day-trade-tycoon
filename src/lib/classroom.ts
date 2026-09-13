import { UNIVERSE } from "@/lib/market/universe";

/** 當沖大富翁盤室目前可下單的現貨宇宙。名稱／族群一律從 symbols.json 取。 */
export const CLASSROOM_URL = "https://rich.yilutek.com/";

export const CLASSROOM_CODES = UNIVERSE.map((s) => s.code);

export const CLASSROOM_SET = new Set<string>(CLASSROOM_CODES);

export const CLASSROOM_SECTOR: Record<string, string> = Object.fromEntries(
  UNIVERSE.map((s) => [s.code, s.sectorLabel]),
);

export type ClassroomRole = "attack" | "wait" | "avoid" | "plan";

export function isClassroomTradable(code: string): boolean {
  return CLASSROOM_SET.has(code);
}

export function tagClassroomSector<T extends { code: string; sector: string }>(row: T): T {
  const sector = CLASSROOM_SECTOR[row.code];
  if (!sector || sector === row.sector) return row;
  return { ...row, sector };
}

export function classroomHref(opts?: { codes?: string[]; date?: string; role?: ClassroomRole }): string {
  const u = new URL(CLASSROOM_URL);
  const codes = (opts?.codes ?? []).filter(isClassroomTradable);
  if (codes.length) u.searchParams.set("watch", [...new Set(codes)].join(","));
  if (opts?.date) u.searchParams.set("date", opts.date);
  if (opts?.role) u.searchParams.set("role", opts.role);
  return u.toString();
}
