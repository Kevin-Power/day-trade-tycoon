// Turns the lesson content into the digital edition's forms and completion rules.
// One source for the page, the in-browser progress logic and the regression tests.
//
// A task's `parts` describe what is shown and entered; `req` lists only the items that decide
// whether the task is done. Optional items (想一想、評量自我檢查、講師確認) never enter `req`.
import * as digital from "../../content/digital.mjs";

export const STOCKS = [
  ["2330", "台積電"],
  ["2317", "鴻海"],
  ["2454", "聯發科"],
  ["2382", "廣達"],
  ["2308", "台達電"],
];
export const TRI = [
  ["yes", "是"],
  ["no", "否"],
  ["na", "不適用"],
];

const plain = (text) => String(text ?? "").replace(/[「」『』`*]/g, "").replace(/\{\{page:[^}]+\}\}/g, "").trim();

/** Input spec from the short names used in content/digital.mjs. */
function input(spec) {
  if (Array.isArray(spec)) return { type: "select", options: spec.map((value) => [value, value]) };
  if (spec === "stock") return { type: "select", options: STOCKS.map(([code, name]) => [code, `${name} ${code}`]) };
  if (spec === "tri") return { type: "tri" };
  if (spec === "label+text") return { type: "text", labelled: true };
  return { type: spec };
}

/** A content record／worksheet／ledger as a table part. */
function tableFrom(task, rule) {
  const prefix = `${task.id}:${rule.key}`;
  let title = "";
  let columns = [];
  let rowLabels = null;
  let rowCount = 0;
  let example = null;
  let note = "";
  let sources = null;
  if (task.ledger) {
    title = "對帳表";
    columns = ["項目", "資料來源／算法", "金額（元）"];
    rowLabels = task.ledger.rows.map(([name]) => name);
    sources = task.ledger.rows.map(([, source]) => source);
  } else if (task.worksheet) {
    title = task.worksheet.title;
    columns = task.worksheet.head ?? ["項目", "我的紀錄"];
    const labelled = task.worksheet.head ? task.worksheet.rows.every((row) => row[0]) : true;
    if (labelled) rowLabels = task.worksheet.rows.map((row) => row[0]);
    rowCount = task.worksheet.rows.length;
  } else if (task.record) {
    title = task.record.title;
    columns = task.record.columns;
    example = task.record.example ?? null;
    note = task.record.note ?? "";
    if (Array.isArray(task.record.rows)) rowLabels = task.record.rows;
    else rowCount = task.record.rows ?? 2;
  }
  const cols = columns.map((label, index) => ({ id: String(index), label: plain(label), ...input(rule.inputs[index] ?? "text") }));
  if (rowLabels) {
    // The first column is the row label; content strings such as 「價格：」 stay as the label text.
    cols[0] = { ...cols[0], type: cols[0].labelled ? "text" : "label" };
    rowCount = rowLabels.length;
  }
  if (rule.lastRowText && rowLabels) cols.forEach((col) => col.type === "num" && (col.lastRowType = "text"));
  return {
    kind: "table",
    prefix,
    title,
    note: plain(note),
    cols,
    rowLabels: rowLabels?.map(plain) ?? null,
    labelledFirst: Boolean(rowLabels && cols[0].type === "text"),
    sources,
    example,
    exampleNote: task.record?.exampleNote ? plain(task.record.exampleNote) : example ? "範例（不是你的答案）" : "",
    rows: rowCount,
    dynamic: rule.dynamic ?? null,
    fixedCells: rule.fixedCells ?? {},
    verify: rule.verify ?? null,
  };
}

function rowsReq(part, need, label) {
  const target = need.rows === "all" ? part.rows : need.rows;
  return {
    t: "rows",
    prefix: part.prefix,
    label,
    rows: target,
    cols: need.cols.map(String),
    count: part.dynamic ? { min: part.dynamic.min, initial: part.dynamic.initial ?? part.dynamic.min } : part.rows,
    skip: Object.keys(part.fixedCells),
  };
}

function rowsLabel(part, need) {
  if (need.rows === "all") return `完成「${part.title}」`;
  if (Array.isArray(need.rows)) return `填完「${part.title}」的必填列`;
  return `「${part.title}」至少 ${need.rows} 列`;
}

/** Parts and requirements of one task. */
export function taskForm(task) {
  const parts = [];
  const req = [];
  const id = task.id;
  const rule = digital.sheets[id];
  if (rule) {
    const part = tableFrom(task, rule);
    parts.push(part);
    req.push(rowsReq(part, rule.need, rowsLabel(part, rule.need)));
  }
  if (task.record?.list) {
    const key = `${id}:habit`;
    parts.push({ kind: "choice", key, title: plain(task.record.title), options: task.record.list.map(plain), other: true });
    req.push({ t: "choice", key, label: "選定一個要檢查的習慣", other: `${key}:other` });
  }
  if (task.adherence) {
    const prefix = `${id}:adh`;
    parts.push({ kind: "pnl", ...digital.pnlCheck, prefix: `${id}:${digital.pnlCheck.key}` });
    for (const field of digital.pnlCheck.fields.filter((item) => item.need))
      req.push(field.input === "tri"
        ? { t: "tri", key: `${id}:${digital.pnlCheck.key}:${field.id}`, label: field.label, why: null }
        : { t: "field", key: `${id}:${digital.pnlCheck.key}:${field.id}`, label: `填寫${field.label.replace(/（元）/, "")}` });
    parts.push({ kind: "tri-list", prefix, title: "遵守計畫檢查", items: task.adherence.map(plain) });
    task.adherence.forEach((item, index) => req.push({ t: "tri", key: `${prefix}:${index}`, label: `第 ${index + 1} 題：選是／否／不適用（選否或不適用要寫原因）`, why: `${prefix}:${index}:why` }));
  }
  if (task.layout === "final-brief") {
    const key = `${id}:check:confirm`;
    parts.push({ kind: "evidence", items: task.evidence.map(plain), key: `${id}:evidence` });
    req.push({ t: "check", key, label: digital.finals[id].confirm, self: true });
  }
  if (task.layout === "rubric") req.push({ t: "check", key: `${id}:check:confirm`, label: digital.finals[id].confirm, self: true });
  if (task.layout === "sheet-plan") finalPlan(task, parts, req);
  if (task.layout === "sheet-log") finalLog(task, parts, req);
  if (task.layout === "sheet-report") finalReport(task, parts, req);
  (task.checks ?? []).forEach((item, index) => req.push({ t: "check", key: `${id}:check:${index}`, label: plain(item), self: true }));
  return { parts, req };
}

function fieldsPart(prefix, title, fields, req, extraNeed = () => false) {
  const items = fields.map((field) => ({ ...field, key: `${prefix}:${field.id}`, ...input(field.input) }));
  for (const field of items) {
    if (!(field.need || extraNeed(field))) continue;
    if (field.type === "tri") req.push({ t: "tri", key: field.key, label: field.label, why: null });
    else req.push({ t: "field", key: field.key, label: `填寫「${field.label.replace(/（元）|＝.*$/, "")}」`, unlessNoTrade: Boolean(field.needUnlessNoTrade) });
  }
  return { kind: "fields", prefix, title, fields: items };
}

const RISK_ROWS = ["① 預計進場價", "② 停損（失效）價", "③ 每股風險 = ① − ②", "④ 每張價差風險 = ③ × 1,000", "⑤ 每張來回費稅（下單票）", "⑥ 每張總風險 = ④ + ⑤", "⑦ 可承受模擬損失", "⑧ 最多張數 = ⑦ ÷ ⑥（捨去，最多 3）"];

function finalPlan(task, parts, req) {
  const spec = digital.finals[task.id];
  parts.push({ kind: "intro", text: spec.intro });
  parts.push(fieldsPart(`${task.id}:plan`, "計畫", spec.fields, req));
  const risk = {
    kind: "table",
    prefix: `${task.id}:risk`,
    title: "風險預算表",
    note: "",
    cols: [{ id: "0", label: "項目", type: "label" }, { id: "1", label: "我的紀錄", type: "num" }],
    rowLabels: RISK_ROWS,
    labelledFirst: false,
    sources: null,
    example: null,
    exampleNote: "",
    rows: RISK_ROWS.length,
    dynamic: null,
    fixedCells: {},
    verify: { kind: "risk" },
  };
  parts.push(risk);
  req.push({ t: "rows", prefix: risk.prefix, label: "填寫 ⑦ 可承受模擬損失與 ⑧ 最多張數", rows: [6, 7], cols: ["1"], count: RISK_ROWS.length, skip: [] });
  parts.push(fieldsPart(`${task.id}:th`, "費稅門檻與結束時間", spec.threshold, req));
  const key = `${task.id}:check:confirm`;
  parts.push({ kind: "confirm", key, label: spec.confirm });
  req.push({ t: "check", key, label: spec.confirm, self: true });
}

function finalLog(task, parts, req) {
  const spec = digital.finals[task.id];
  parts.push({ kind: "intro", text: spec.intro });
  const log = spec.log;
  const part = {
    kind: "table",
    prefix: `${task.id}:log`,
    title: "決策日誌",
    note: "",
    cols: log.columns.map((label, index) => ({ id: String(index), label, ...input(log.inputs[index]) })),
    rowLabels: null,
    labelledFirst: false,
    sources: null,
    example: null,
    exampleNote: "",
    rows: log.dynamic.min,
    dynamic: log.dynamic,
    fixedCells: {},
    verify: null,
  };
  parts.push(part);
  req.push(rowsReq(part, log.need, "決策日誌至少 3 列（時間、決定、理由）"));
}

function finalReport(task, parts, req) {
  const spec = digital.finals[task.id];
  const fills = {
    kind: "table",
    prefix: `${task.id}:fills`,
    title: "成交與對帳",
    note: "照系統「成交」分頁抄寫，一筆成交一列。",
    cols: spec.fills.columns.map((label, index) => ({ id: String(index), label, ...input(spec.fills.inputs[index]) })),
    rowLabels: null,
    labelledFirst: false,
    sources: null,
    example: null,
    exampleNote: "",
    rows: spec.fills.dynamic.initial,
    dynamic: spec.fills.dynamic,
    fixedCells: {},
    verify: { kind: "fills" },
  };
  const noTrade = `${task.id}:notrade`;
  parts.push(fills);
  parts.push({ kind: "toggle", key: noTrade, label: spec.noTrade });
  req.push({
    t: "any",
    label: "至少抄一筆成交，或勾選「這一輪沒有成交」",
    of: [
      { t: "check", key: noTrade },
      { t: "rows", prefix: fills.prefix, rows: 1, cols: ["0", "1", "3"], count: { min: 0, initial: spec.fills.dynamic.initial }, skip: [] },
    ],
  });
  parts.push(fieldsPart(`${task.id}:totals`, "對帳結果", spec.totals, req, (field) => Boolean(field.needUnlessNoTrade)));
  const prefix = `${task.id}:adh`;
  parts.push({ kind: "tri-list", prefix, title: "遵守計畫檢查", items: spec.adherence });
  spec.adherence.forEach((item, index) => req.push({ t: "tri", key: `${prefix}:${index}`, label: `遵守計畫檢查第 ${index + 1} 題：選是／否／不適用（選否或不適用要寫原因）`, why: `${prefix}:${index}:why` }));
  parts.push(fieldsPart(`${task.id}:reflect`, "失誤與改善", spec.reflect.map((item) => ({ ...item, input: "area" })), req));
  const key = `${task.id}:check:confirm`;
  parts.push({ kind: "confirm", key, label: spec.confirm });
  req.push({ t: "check", key, label: spec.confirm, self: true });
  parts.push({ kind: "teacher", label: spec.teacher });
  // F-5 net result is required unless the round had no fills.
  for (const item of req) if (item.unlessNoTrade) item.unless = noTrade;
}

/** The mini task's single result card. */
export function quickForm() {
  const q = digital.quickstart;
  const prefix = "Q:card";
  const part = {
    kind: "table",
    prefix,
    title: "我的第一張成果卡",
    note: "",
    cols: q.form.columns.map((label, index) => ({ id: String(index), label, ...input(q.form.inputs[index]) })),
    rowLabels: null,
    labelledFirst: false,
    sources: null,
    example: null,
    exampleNote: "",
    rows: 1,
    dynamic: null,
    fixedCells: {},
    verify: { kind: "quote", stockCol: 0, dayCol: 1, timeCol: 2, priceCol: 3, changeCol: 4 },
  };
  return { parts: [part], req: [{ t: "rows", prefix, label: "填好股票、交易日、時間與最新價", rows: 1, cols: q.form.need.map(String), count: 1, skip: [] }] };
}
