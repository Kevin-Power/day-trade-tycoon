import test from "node:test";
import assert from "node:assert/strict";
import {
  ABANDON_CONFIRM_TEXT,
  FULL_LIST_TEXT,
  MAX_RUN_CODES,
  addCode,
  carryHeld,
  dateOptions,
  formatPnl,
  formatPreviousValue,
  lessonDayLabel,
  openableRecords,
  previewCatalog,
  recordStatus,
  removeCode,
  sameCodes,
  searchSymbols,
} from "./lesson-choice.ts";
import type { PickerSymbol, RunRecord } from "./lessons/types.ts";
import type { MorningCatalog } from "./morning.ts";
import type { DeskResponse } from "./market/real-replay.ts";

const symbol = (code: string, name: string, extra: Partial<PickerSymbol> = {}): PickerSymbol => ({
  code,
  name,
  referencePrice: 100,
  previousValue: null,
  disposition: false,
  ...extra,
});
const SYMBOLS = [
  symbol("1101", "台泥"),
  symbol("2303", "聯電"),
  symbol("2330", "台積電"),
  symbol("2331", "精英"),
  symbol("3008", "大立光"),
  symbol("6488", "環球晶"),
];

test("the copy the desk shows is exact", () => {
  assert.equal(FULL_LIST_TEXT, "最多 80 檔");
  assert.equal(MAX_RUN_CODES, 80);
  assert.equal(ABANDON_CONFIRM_TEXT, "確定放棄這局？放棄後不計紀律分數，可以重新選股。");
  assert.equal(lessonDayLabel("2026-10-27"), "10/27 早盤");
  assert.equal(lessonDayLabel("2026-11-05"), "11/5 早盤");
});

test("date menus list the open days and add the lesson on screen when it is not one (a retired one)", () => {
  const lessons = [
    { lessonId: "fubon-20261027-am", date: "2026-10-27", title: "10/27 早盤" },
    { lessonId: "fubon-20261022-am", date: "2026-10-22", title: "10/22 早盤" },
  ];
  assert.deepEqual(dateOptions(lessons, { lessonId: "fubon-20261022-am", date: "2026-10-22" }), [
    { lessonId: "fubon-20261027-am", label: "10/27 早盤" },
    { lessonId: "fubon-20261022-am", label: "10/22 早盤" },
  ]);
  assert.deepEqual(
    dateOptions(lessons, { lessonId: "morning-20261005-v1-bd566804b809", date: "2026-10-05", retired: true })[0],
    { lessonId: "morning-20261005-v1-bd566804b809", label: "10/5 舊課（已停用）" },
  );
  assert.deepEqual(dateOptions([], { lessonId: "fubon-20261021-am", date: "2026-10-21" }), [
    { lessonId: "fubon-20261021-am", label: "10/21 早盤" },
  ]);
});

test("the previous day's turnover reads in 億 or 萬, and unknown is a dash", () => {
  assert.equal(formatPreviousValue(31_245_000_000), "312.45 億");
  assert.equal(formatPreviousValue(100_000_000), "1.00 億");
  assert.equal(formatPreviousValue(85_000_000), "8,500 萬");
  assert.equal(formatPreviousValue(null), "—");
  assert.equal(formatPreviousValue(Number.NaN), "—");
});

test("a run holds 1 to 80 stocks, by code, without repeats", () => {
  assert.deepEqual(addCode(["2330", "2317"], "1101"), ["1101", "2317", "2330"]);
  assert.deepEqual(addCode(["2330"], "2330"), ["2330"]);
  const full = Array.from({ length: MAX_RUN_CODES }, (_, index) => String(1000 + index));
  assert.equal(addCode(full, "9999").length, MAX_RUN_CODES);
  assert.ok(!addCode(full, "9999").includes("9999"));
  assert.deepEqual(removeCode(["1101", "2330"], "1101"), ["2330"]);
  assert.deepEqual(removeCode(["2330"], "2330"), ["2330"], "the last stock stays");
  assert.deepEqual(removeCode(["1101", "2330"], "9999"), ["1101", "2330"]);
});

test("same stocks in any order", () => {
  assert.ok(sameCodes(["2330", "1101"], ["1101", "2330"]));
  assert.ok(!sameCodes(["2330"], ["2330", "1101"]));
  assert.ok(!sameCodes(["2330", "2330"], ["2330", "1101"]));
});

test("search: a code from its start or part of a name, exact code first, at most the limit", () => {
  assert.deepEqual(searchSymbols(SYMBOLS, "").shown, []);
  assert.deepEqual(searchSymbols(SYMBOLS, "  ").total, 0);
  assert.deepEqual(searchSymbols(SYMBOLS, "233").shown.map((item) => item.code), ["2330", "2331"]);
  assert.deepEqual(searchSymbols(SYMBOLS, "2331").shown.map((item) => item.code), ["2331"]);
  assert.deepEqual(searchSymbols(SYMBOLS, "30").shown.map((item) => item.code), ["3008"], "codes match from their start only");
  assert.deepEqual(searchSymbols(SYMBOLS, "台").shown.map((item) => item.code), ["1101", "2330"]);
  assert.deepEqual(searchSymbols(SYMBOLS, "環球").shown.map((item) => item.code), ["6488"]);
  const many = Array.from({ length: 30 }, (_, index) => symbol(String(2000 + index), `股${index}`));
  const found = searchSymbols([...many, symbol("20", "x")], "20", 5);
  assert.equal(found.total, 31);
  assert.deepEqual(found.shown.map((item) => item.code), ["20", "2000", "2001", "2002", "2003"]);
});

test("search: full-width digits and letters (a Chinese keyboard's) match as the half-width ones (NFKC)", () => {
  assert.deepEqual(searchSymbols(SYMBOLS, "２３３０").shown.map((item) => item.code), ["2330"]);
  assert.deepEqual(searchSymbols(SYMBOLS, "２３３").shown.map((item) => item.code), ["2330", "2331"]);
  assert.deepEqual(searchSymbols(SYMBOLS, "　２３３１　").shown.map((item) => item.code), ["2331"], "full-width spaces trimmed");
  // Names are normalised the same way, both ways round.
  const names = [symbol("2002", "中鋼"), symbol("3231", "緯創"), symbol("2357", "ＡＳＵＳ華碩"), symbol("2409", "AUO友達")];
  assert.deepEqual(searchSymbols(names, "asus").shown.map((item) => item.code), ["2357"]);
  assert.deepEqual(searchSymbols(names, "ａｕｏ").shown.map((item) => item.code), ["2409"]);
  assert.equal(searchSymbols(SYMBOLS, "２３３０").shown[0]?.code, "2330", "an exact full-width code comes first");
});

const record = (id: string, lessonId: string, extra: Partial<RunRecord> = {}): RunRecord => ({
  id,
  lessonId,
  date: "2026-10-27",
  codes: 5,
  pnl: 0,
  reflected: false,
  abandoned: false,
  retired: false,
  completed: false,
  ...extra,
});

test("records: status, signed result, and only each lesson's newest run opens", () => {
  assert.equal(recordStatus({ completed: true, reflected: true, abandoned: false }), "已復盤");
  assert.equal(recordStatus({ completed: true, reflected: false, abandoned: true }), "已放棄");
  assert.equal(recordStatus({ completed: false, reflected: false, abandoned: false }), "未完成");
  assert.equal(recordStatus({ completed: true, reflected: false, abandoned: false }), "未復盤");
  assert.equal(formatPnl(12_345.4), "+12,345");
  assert.equal(formatPnl(-800), "-800");
  assert.equal(formatPnl(0), "0");
  const ids = openableRecords([
    record("c", "fubon-20261027-am"),
    record("b", "fubon-20261027-am"),
    record("r", "morning-20261005-v1-bd566804b809", { retired: true }),
    record("a", "fubon-20261022-am"),
  ]);
  assert.deepEqual([...ids], ["c", "r", "a"]);
});

const catalog = (lessonId: string, closes: Record<string, number>): MorningCatalog => ({
  lessonId,
  title: "10/27 早盤",
  date: "2026-10-27",
  start: "09:00",
  end: "10:30",
  maxCursor: 90,
  symbols: Object.entries(closes).map(([code, previousClose]) => ({ code, name: code, previousClose, previous5CloseMean: null })),
  context: [],
  strategy: [],
  notices: [],
  videoUrl: null,
});
const run = (lessonId: string, extra: Partial<NonNullable<DeskResponse["state"]>> = {}): NonNullable<DeskResponse["state"]> => ({
  id: "run-1",
  lessonId,
  cursor: 3,
  revision: 4,
  plan: { bias: "observe", focusCode: "2330", reason: "r", entry: "e", stop: "s" },
  codes: ["2330", "2317"],
  bars: {},
  startingCash: 10_000_000,
  cash: 10_000_000,
  equity: 10_000_000,
  positions: [],
  orders: [],
  fills: [],
  completed: false,
  reflection: "",
  nextAdvanceAt: 0,
  ...extra,
});
const LESSONS = [{ lessonId: "fubon-20261027-am", date: "2026-10-27", title: "10/27 早盤" }];
const PICKER = {
  lessonId: "fubon-20261027-am",
  date: "2026-10-27",
  symbols: [],
  defaults: ["2317", "2330"],
  note: { title: "預設：成交值前 5 名", detail: null },
  booksAvailable: false,
  taiexAvailable: true,
};

test("a start or step reply keeps the held date list, records and the day's picker", () => {
  const held: DeskResponse = {
    catalog: catalog("fubon-20261027-am", { 2330: 1000, 2317: 200 }),
    state: null,
    lessons: LESSONS,
    records: [record("old", "fubon-20261022-am")],
    picker: PICKER,
  };
  const started = carryHeld(held, { catalog: catalog("fubon-20261027-am", { 2330: 1000, 2317: 200 }), state: run("fubon-20261027-am") });
  assert.equal(started.lessons, LESSONS);
  assert.equal(started.records, held.records);
  assert.equal(started.picker, PICKER);
  // A GET brings its own records (even none) and lessons; a picker of another day is not carried.
  const other = carryHeld(started, {
    catalog: catalog("fubon-20261022-am", { 1101: 30 }),
    state: run("fubon-20261022-am"),
    lessons: [],
    records: [],
  });
  assert.deepEqual(other.records, []);
  assert.deepEqual(other.lessons, []);
  assert.equal(other.picker, undefined);
  assert.equal(carryHeld(null, held), held);
});

test("a text-only catalog gives way to the held catalog of the same stocks, never to another", () => {
  const real = catalog("fubon-20261027-am", { 2330: 1000, 2317: 200 });
  const held: DeskResponse = { catalog: real, state: run("fubon-20261027-am") };
  const textOnly = catalog("fubon-20261027-am", { 2330: 0, 2317: 0 });
  const finished = carryHeld(held, { catalog: textOnly, state: run("fubon-20261027-am", { completed: true }) });
  assert.equal(finished.catalog, real);
  assert.ok(finished.catalog.symbols.every((item) => item.previousClose > 0));
  const otherStocks = carryHeld(held, { catalog: catalog("fubon-20261027-am", { 2330: 0, 2454: 0 }), state: run("fubon-20261027-am") });
  assert.ok(otherStocks.catalog.symbols.every((item) => item.previousClose === 0), "different stocks: the reply's own");
  const retired = carryHeld(held, { catalog: textOnly, state: run("fubon-20261027-am"), retired: true });
  assert.equal(retired.catalog, textOnly, "a retired run is text only by design");
  assert.equal(retired.picker, undefined);
});

test("the desk before a run shows the picked stocks, and the 「預設」 note only on the day's defaults", () => {
  const defaults = { ...catalog("fubon-20261027-am", { 2317: 200, 2330: 1000 }), note: { title: "預設：成交值前 5 名", detail: null } };
  const picker = {
    symbols: [symbol("1101", "台泥", { referencePrice: 31.5 }), symbol("2317", "鴻海"), symbol("2330", "台積電")],
    defaults: ["2317", "2330"],
    note: { title: "預設：成交值前 5 名", detail: null },
  };
  const same = previewCatalog(defaults, picker, ["2317", "2330"]);
  assert.deepEqual(same.symbols, defaults.symbols);
  assert.deepEqual(same.note, picker.note);
  const edited = previewCatalog(defaults, picker, ["1101", "2330"]);
  assert.deepEqual(edited.symbols.map((item) => [item.code, item.name, item.previousClose]), [
    ["1101", "台泥", 31.5],
    ["2330", "2330", 1000],
  ]);
  assert.equal(edited.note, undefined);
  assert.equal(defaults.note.title, "預設：成交值前 5 名", "the held catalog is not changed");
  assert.deepEqual(previewCatalog(defaults, picker, ["9999"]).symbols, [], "a code the day does not offer is left out");
});
