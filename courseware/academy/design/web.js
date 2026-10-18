// 學員實戰闖關手冊 · interactive edition.
// The learner's work lives only in this browser (localStorage). Every edit updates memory at once,
// is written shortly after, and is flushed on blur, page change, export, hide and unload. A failed
// write is shown on screen and never clears what is in memory. Nothing is sent anywhere.
(() => {
  "use strict";
  const M = window.ACADEMY;
  const VIEWS = window.ACADEMY_VIEWS || [];
  const SCHEMA = "dtt-academy-workbook";
  const VERSION = 2;
  const KEY = "dtt-academy-workbook-v2";
  const V1_KEY = "dtt-academy-workbook-v1";
  const BACKUP = "dtt-academy-workbook-backup:";
  const byId = new Map(VIEWS.map((view, index) => [view.id, index]));
  const TRI = { yes: "是", no: "否", na: "不適用" };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (text) => String(text ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
  const attr = (value) => (window.CSS && CSS.escape ? CSS.escape(value) : String(value).replace(/["\\]/g, "\\$&"));
  const clock = (date) => date.toLocaleTimeString("zh-TW", { hour12: false });
  /** Redraws only when the markup changes, so a link or button under the pointer is not replaced mid-tap. */
  const setHtml = (host, html) => {
    if (host.__html === html) return;
    host.__html = html;
    host.innerHTML = html;
  };
  const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

  /* ───────────── state, validation, migration ───────────── */
  const blank = () => ({ schema: SCHEMA, version: VERSION, createdAt: new Date().toISOString(), updatedAt: null, lastView: null, checks: {}, fields: {}, rows: {}, legacy: null });
  let state = blank();
  let dirty = false;
  let timer = 0;
  let mainKey = KEY;
  let saveFailed = "";
  let storageUsable = true;
  let unreadableRaw = null;

  const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  /**
   * Accepts a v2 state, a v2 export file, or a first-edition (v1) record; returns a clean v2 state and what was
   * dropped. Anything else — `{}`, another product's JSON, a wrong schema or version, containers of the wrong
   * type — is refused here, before anything can offer to replace the learner's record.
   */
  function validate(input) {
    if (!isPlain(input)) return { ok: false, why: "不是學習紀錄格式（應為 JSON 物件）" };
    if (input.schema !== undefined && input.schema !== SCHEMA) return { ok: false, why: `這不是闖關手冊的紀錄（schema: ${String(input.schema).slice(0, 40)}）` };
    // An export file wraps the state in `data`; a stored state is the object itself.
    if (input.schema === SCHEMA && input.data !== undefined && !isPlain(input.data)) return { ok: false, why: "紀錄內容（data）不是物件" };
    const source = input.schema === SCHEMA && isPlain(input.data) ? input.data : input;
    if (source.schema !== undefined && source.schema !== SCHEMA) return { ok: false, why: `這不是闖關手冊的紀錄（schema: ${String(source.schema).slice(0, 40)}）` };
    const declared = source.version ?? input.version;
    const v2 = input.schema === SCHEMA || source.schema === SCHEMA;
    if (v2) {
      if (declared !== VERSION) return { ok: false, why: typeof declared === "number" && declared > VERSION ? `這個檔案來自更新的講義版本（版本 ${declared}）` : `不支援的版本 ${String(declared ?? "（未標示）").slice(0, 20)}` };
      const wrong = ["checks", "fields", "rows"].filter((part) => !isPlain(source[part]));
      if (wrong.length) return { ok: false, why: `紀錄的 ${wrong.join("、")} 欄位缺少或不是物件` };
    } else {
      // The first edition stored { checks: {}, notes: {}, updatedAt } with no schema and no version: a plain
      // object without those containers is not a record of this workbook.
      if (!isPlain(source.checks) && !isPlain(source.notes)) return { ok: false, why: "不是學習紀錄格式（找不到勾選或筆記資料）" };
      if (declared !== undefined && declared !== 1) return { ok: false, why: `不支援的版本 ${String(declared).slice(0, 20)}` };
      const wrong = ["checks", "notes"].filter((part) => source[part] !== undefined && !isPlain(source[part]));
      if (wrong.length) return { ok: false, why: `紀錄的 ${wrong.join("、")} 欄位不是物件` };
    }
    const next = blank();
    let dropped = 0;
    const known = (key) => typeof key === "string" && key.length <= 200;
    if (!v2) {
      // v1 kept ticks and notes only. Habit and plan-check ticks had no clear meaning, so they are kept
      // in `legacy` (and in the export) instead of being guessed into answers.
      const legacy = { from: "v1", checks: {}, notes: {} };
      for (const [key, value] of Object.entries(isPlain(source.checks) ? source.checks : {})) {
        if (!known(key) || value !== true) { dropped++; continue; }
        if (/:check:\d+$/.test(key) || /:evidence:\d+$/.test(key)) next.checks[key] = true;
        else if (/^F-2:/.test(key)) next.checks[key.replace(/^F-2:/, "F-2:rubric:")] = true;
        else legacy.checks[key] = true;
      }
      for (const [key, value] of Object.entries(isPlain(source.notes) ? source.notes : {})) {
        if (!known(key) || typeof value !== "string") { dropped++; continue; }
        next.fields[key] = value.slice(0, 20000);
        legacy.notes[key] = value.slice(0, 20000);
      }
      next.legacy = legacy;
      next.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : null;
      return { ok: true, state: next, dropped, migrated: true };
    }
    for (const [key, value] of Object.entries(isPlain(source.checks) ? source.checks : {})) known(key) && value === true ? (next.checks[key] = true) : dropped++;
    for (const [key, value] of Object.entries(isPlain(source.fields) ? source.fields : {})) known(key) && typeof value === "string" ? (next.fields[key] = value.slice(0, 20000)) : dropped++;
    for (const [key, value] of Object.entries(isPlain(source.rows) ? source.rows : {})) known(key) && Number.isInteger(value) && value >= 0 && value <= 60 ? (next.rows[key] = value) : dropped++;
    next.lastView = typeof source.lastView === "string" && byId.has(source.lastView) ? source.lastView : null;
    next.createdAt = typeof source.createdAt === "string" ? source.createdAt : next.createdAt;
    next.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : null;
    next.legacy = isPlain(source.legacy) ? source.legacy : null;
    return { ok: true, state: next, dropped };
  }

  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      storageUsable = false;
      return null;
    }
  }
  function storageKeys() {
    try {
      return Object.keys(window.localStorage);
    } catch {
      return [];
    }
  }

  function load() {
    const raw = storageGet(KEY);
    if (raw == null) {
      const old = storageGet(V1_KEY);
      if (old != null) {
        try {
          const result = validate(JSON.parse(old));
          if (result.ok) {
            state = result.state;
            dirty = true;
            banner("已把這台裝置上的舊版勾選與筆記轉成新版格式。舊資料仍保留在瀏覽器中，沒有刪除；舊版「習慣全勾」等勾選放在匯出檔的 legacy 欄位，請重新選一次。");
            return;
          }
        } catch {
          /* fall through: an unreadable v1 entry is left untouched */
        }
      }
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return unreadable(raw, "內容不是有效的 JSON");
    }
    const result = validate(parsed);
    if (!result.ok) return unreadable(raw, result.why);
    state = result.state;
    if (result.dropped) {
      keepCopy(raw, "partial");
      banner(`有 ${result.dropped} 筆格式不正確的資料沒有載入；原始內容已另存一份備份（見「我的進度與紀錄」）。`);
    }
  }
  function keepCopy(raw, tag) {
    try {
      window.localStorage.setItem(`${BACKUP}${tag}:${stamp()}`, raw);
      return true;
    } catch {
      return false;
    }
  }
  /** Stored data that cannot be read is never overwritten: it is copied aside, or new data goes elsewhere. */
  function unreadable(raw, why) {
    unreadableRaw = raw;
    if (!keepCopy(raw, "unreadable")) mainKey = `${KEY}:recovered`;
    banner(`這台裝置上的紀錄無法讀取（${why}）。原始資料已保留，沒有刪除；你可以下載原始資料，或匯入先前匯出的備份檔。新的作答會另外保存。`, [["下載原始資料", () => download(unreadableRaw, `闖關手冊原始資料-${stamp()}.txt`, "text/plain")]]);
  }

  /* ───────────── saving ───────────── */
  function touch() {
    state.updatedAt = new Date().toISOString();
    dirty = true;
    setStatus("saving");
    clearTimeout(timer);
    timer = setTimeout(flush, 500);
  }
  /** Where the learner is reading: kept for 「繼續上次學習」 without counting as an edit (no 「儲存中…」, and the
   *  last-saved time stays the time of the last answer). A pending edit save writes it anyway. */
  function rememberView(id) {
    state.lastView = id;
    if (dirty) return;
    try {
      window.localStorage.setItem(mainKey, JSON.stringify(state));
    } catch {
      /* losing the reading position is harmless; saving answers reports its own failures */
    }
  }
  function flush() {
    clearTimeout(timer);
    if (!dirty) return !saveFailed;
    try {
      window.localStorage.setItem(mainKey, JSON.stringify(state));
      dirty = false;
      saveFailed = "";
      setStatus("saved");
      return true;
    } catch (error) {
      saveFailed = error && /quota/i.test(`${error.name} ${error.message}`) ? "這台裝置的儲存空間已滿" : "這個瀏覽器不允許保存（例如無痕視窗或封鎖網站資料）";
      setStatus("failed");
      return false;
    }
  }
  function setStatus(kind) {
    $$("[data-save-status]").forEach((element) => {
      element.dataset.state = kind;
      element.innerHTML = kind === "saving" ? "儲存中…" : kind === "saved" ? `已保存<span class="w-save-time"> ${clock(new Date())}</span>` : kind === "failed" ? "保存失敗" : "";
    });
    // Shown once per failure: re-drawing it on every retry would remove the button under the pointer.
    if (kind === "failed" && $("[data-banner]").dataset.kind !== "save") banner(`保存失敗：${saveFailed}。你剛寫的內容還在這個畫面上；請先按「匯出備份檔」下載一份，再重新整理或換瀏覽器。`, [["匯出備份檔", exportFile]]);
    else if (kind === "saved" && $("[data-banner]").dataset.kind === "save") hideBanner();
    $$("[data-storage-status]").forEach((element) => {
      element.textContent = saveFailed
        ? `目前狀態：保存失敗（${saveFailed}）。重新整理前請先匯出備份檔。`
        : storageUsable
          ? `目前狀態：可以保存。最後保存 ${state.updatedAt ? new Date(state.updatedAt).toLocaleString("zh-TW", { hour12: false }) : "（還沒有作答）"}。`
          : "目前狀態：這個瀏覽器不允許保存；請用匯出備份檔保存你的作答。";
    });
  }
  function banner(text, actions = []) {
    const element = $("[data-banner]");
    element.hidden = false;
    element.dataset.kind = /保存失敗/.test(text) ? "save" : "info";
    element.innerHTML = `<p>${esc(text)}</p><div class="w-actions">${actions.map((action, index) => `<button type="button" class="w-button" data-banner-action="${index}">${esc(action[0])}</button>`).join("")}<button type="button" class="w-button w-button-quiet" data-banner-close>知道了</button></div>`;
    actions.forEach((action, index) => $(`[data-banner-action="${index}"]`, element).addEventListener("click", action[1]));
    $("[data-banner-close]", element).addEventListener("click", hideBanner);
  }
  function hideBanner() {
    const element = $("[data-banner]");
    element.hidden = true;
    element.innerHTML = "";
    delete element.dataset.kind;
  }

  /* ───────────── completion model ───────────── */
  const filled = (key) => typeof state.fields[key] === "string" && state.fields[key].trim() !== "";
  function partOf(prefix) {
    for (const task of Object.values(M.tasks)) for (const part of task.parts) if (part.prefix === prefix) return part;
    return null;
  }
  function rowTotal(prefix, fallback) {
    const part = partOf(prefix);
    if (part && !part.dynamic) return part.rows;
    const dyn = part?.dynamic ?? fallback ?? { min: 0 };
    return Math.max(dyn.min ?? 0, state.rows[prefix] ?? dyn.initial ?? dyn.min ?? part?.rows ?? 0);
  }
  function rowsProgress(req) {
    const total = typeof req.count === "number" ? req.count : rowTotal(req.prefix, req.count);
    const index = Array.isArray(req.rows) ? req.rows : [...Array(total).keys()];
    const target = Array.isArray(req.rows) ? req.rows.length : req.rows;
    const done = index.filter((row) => req.cols.every((col) => req.skip?.includes(`${row}:${col}`) || filled(`${req.prefix}:${row}:${col}`))).length;
    return { done, target };
  }
  function met(req) {
    switch (req.t) {
      case "check":
        return state.checks[req.key] === true;
      case "field":
        return (req.unless && state.checks[req.unless] === true) || filled(req.key);
      case "choice": {
        const value = state.fields[req.key];
        return value === "other" ? filled(req.other) : Boolean(value);
      }
      case "tri": {
        const value = state.fields[req.key];
        if (!(value in TRI)) return false;
        return value === "yes" || !req.why || filled(req.why);
      }
      case "rows": {
        const { done, target } = rowsProgress(req);
        return done >= target;
      }
      case "any":
        return req.of.some(met);
      default:
        return false;
    }
  }
  function taskStatus(id) {
    const task = M.tasks[id];
    const results = task.req.map((req) => ({ req, ok: met(req) }));
    const self = results.filter((item) => item.req.t === "check" && item.req.self);
    const answers = results.filter((item) => !(item.req.t === "check" && item.req.self));
    return {
      done: results.length > 0 && results.every((item) => item.ok),
      missing: results.filter((item) => !item.ok).map((item) => ({ label: item.req.label, self: item.req.t === "check" && item.req.self })),
      self: [self.filter((item) => item.ok).length, self.length],
      answers: [answers.filter((item) => item.ok).length, answers.length],
    };
  }
  const levelTasks = (level) => M.levels[level].tasks;
  const levelDone = (level) => levelTasks(level).every((id) => taskStatus(id).done);

  /* ───────────── rule checks (feedback only, never block completion) ───────────── */
  const num = (text) => {
    if (typeof text !== "string") return NaN;
    const clean = text.replace(/[,，\s元張股]/g, "").replace(/[−–—]/g, "-").replace(/^\+/, "");
    return clean === "" ? NaN : Number(clean);
  };
  const near = (a, b, tolerance = 0.5) => Math.abs(a - b) <= tolerance;
  const cell = (prefix, row, col) => state.fields[`${prefix}:${row}:${col}`] ?? "";
  const timeText = (text) => {
    const match = /^(\d{1,2})[:：](\d{2})$/.exec(String(text ?? "").trim());
    return match ? `${match[1].padStart(2, "0")}:${match[2]}` : null;
  };
  function verify(part) {
    const v = part.verify;
    const lines = [];
    const rows = rowTotal(part.prefix);
    if (v.kind === "quote") {
      for (let row = 0; row < rows; row++) {
        const code = cell(part.prefix, row, v.stockCol);
        const price = num(cell(part.prefix, row, v.priceCol));
        const day = v.day ?? cell(part.prefix, row, v.dayCol);
        const time = v.time ?? timeText(cell(part.prefix, row, v.timeCol));
        if (!code || Number.isNaN(price) || !day || !time) continue;
        const stock = M.minutes[day]?.[code];
        const at = stock?.at[time];
        const name = stock?.name ?? code;
        if (!at) {
          lines.push([false, `第 ${row + 1} 列：找不到 ${day} ${time} 的資料（教材範圍 09:01–10:30）。`]);
          continue;
        }
        let ok = near(price, at[0], 0.001);
        let note = ok ? `與教材資料一致（${day} ${time} ${name}）` : `和 ${day} ${time} 的教材資料不同。再看一次報價區：時間是「${time} 收價」那一分鐘，最新價是大字的數字。`;
        if (ok && v.dirCol != null) {
          const dir = cell(part.prefix, row, v.dirCol);
          const truth = at[1] > 0 ? "漲" : at[1] < 0 ? "跌" : "平";
          if (dir && dir !== truth) {
            ok = false;
            note = `最新價正確，但「漲／跌／平」和昨收比較的結果不同，再看一次漲跌的顏色與符號。`;
          }
        }
        lines.push([ok, `第 ${row + 1} 列：${note}`]);
      }
    } else if (v.kind === "ledger") {
      const a = [...Array(8).keys()].map((row) => num(cell(part.prefix, row, 2)));
      if (!Number.isNaN(a[0]) && !Number.isNaN(a[1]) && !Number.isNaN(a[2])) lines.push([near(a[2], a[1] - a[0]), "價差 = 賣出成交 − 買進成交"]);
      if ([3, 4, 5, 6].every((i) => !Number.isNaN(a[i]))) lines.push([near(a[6], a[3] + a[4] + a[5]), "合計費稅 = 買進手續費 + 賣出手續費 + 交易稅"]);
      if ([2, 6, 7].every((i) => !Number.isNaN(a[i]))) lines.push([near(a[7], a[2] - a[6]), "淨損益 = 價差 − 合計費稅"]);
    } else if (v.kind === "threshold") {
      for (let row = 0; row < rows; row++) {
        const fee = num(cell(part.prefix, row, 1));
        const per = num(cell(part.prefix, row, 2));
        const tick = num(cell(part.prefix, row, 3));
        const ticks = num(cell(part.prefix, row, 4));
        if (!Number.isNaN(fee) && !Number.isNaN(per)) lines.push([near(per, fee / 1000, 0.011), `第 ${row + 1} 列：每股成本 = 來回費稅 ÷ 1,000`]);
        if (!Number.isNaN(per) && tick > 0 && !Number.isNaN(ticks)) lines.push([ticks === Math.ceil(per / tick - 1e-9), `第 ${row + 1} 列：至少幾檔 = 每股成本 ÷ 一檔，有小數就進位`]);
      }
    } else if (v.kind === "risk") {
      const r = [...Array(8).keys()].map((row) => num(cell(part.prefix, row, 1)));
      if (!Number.isNaN(r[0]) && !Number.isNaN(r[1]) && !Number.isNaN(r[2])) lines.push([near(r[2], r[0] - r[1], 0.001), "③ 每股風險 = ① − ②"]);
      if (!Number.isNaN(r[2]) && !Number.isNaN(r[3])) lines.push([near(r[3], r[2] * 1000), "④ 每張價差風險 = ③ × 1,000"]);
      if (!Number.isNaN(r[3]) && !Number.isNaN(r[4]) && !Number.isNaN(r[5])) lines.push([near(r[5], r[3] + r[4]), "⑥ 每張總風險 = ④ + ⑤"]);
      if (!Number.isNaN(r[6]) && r[5] > 0 && !Number.isNaN(r[7])) {
        const most = Math.min(3, Math.floor(r[6] / r[5] + 1e-9));
        lines.push([r[7] === most, "⑧ 最多張數 = ⑦ ÷ ⑥，捨去，最多 3"]);
        if (r[7] === 0 && most === 0) lines.push([true, "0 張：這一筆的風險超過預算，這一輪就不交易；不要為了湊出 1 張而把停損拉近。"]);
      }
    } else if (v.kind === "fills") {
      let buy = 0;
      let sell = 0;
      let cost = 0;
      let counted = 0;
      for (let row = 0; row < rows; row++) {
        const side = cell(part.prefix, row, 1);
        const lots = num(cell(part.prefix, row, 2));
        const price = num(cell(part.prefix, row, 3));
        if (!side || Number.isNaN(lots) || Number.isNaN(price)) continue;
        counted++;
        const amount = price * lots * 1000;
        if (side === "買進") buy += amount;
        else sell += amount;
        cost += (num(cell(part.prefix, row, 4)) || 0) + (num(cell(part.prefix, row, 5)) || 0);
      }
      if (counted) {
        const id = part.prefix.split(":")[0];
        const diff = num(state.fields[`${id}:totals:diff`] ?? "");
        const fees = num(state.fields[`${id}:totals:cost`] ?? "");
        const net = num(state.fields[`${id}:totals:net`] ?? "");
        if (!Number.isNaN(diff)) lines.push([near(diff, sell - buy), `價差合計 = 賣出金額 − 買進金額（依你抄的成交：${(sell - buy).toLocaleString("en-US")}）`]);
        if (!Number.isNaN(fees)) lines.push([near(fees, cost), `費稅合計 = 每筆手續費＋交易稅（依你抄的成交：${cost.toLocaleString("en-US")}）`]);
        if (!Number.isNaN(net)) lines.push([near(net, sell - buy - cost), "淨損益 = 價差合計 − 費稅合計"]);
      }
    }
    return lines;
  }

  /* ───────────── forms ───────────── */
  function cellControl(col, type, key, aria, prefixText) {
    const label = ` aria-label="${esc(aria)}"`;
    const pre = prefixText ? `<span class="w-cell-prefix">${esc(prefixText)}</span>` : "";
    if (type === "select" || type === "tri") {
      const options = type === "tri" ? Object.entries(TRI) : col.options;
      return `<select class="w-in" data-field="${esc(key)}"${label}><option value="">選擇</option>${options.map(([value, text]) => `<option value="${esc(value)}">${esc(text)}</option>`).join("")}</select>`;
    }
    const mode = type === "num" ? ' inputmode="decimal"' : type === "time" ? ' inputmode="numeric" placeholder="09:20"' : "";
    return `${pre}<input class="w-in" type="text" data-field="${esc(key)}"${label}${mode}>`;
  }
  function renderTable(part) {
    const host = $(`[data-table="${attr(part.prefix)}"]`);
    if (!host) return;
    const rows = rowTotal(part.prefix);
    let html = `<table><thead><tr>${part.cols.map((col) => `<th scope="col">${esc(col.label)}</th>`).join("")}${part.dynamic ? '<th class="w-col-tools"><span class="w-sr">刪除列</span></th>' : ""}</tr></thead><tbody>`;
    for (let row = 0; row < rows; row++) {
      const rowLabel = part.rowLabels?.[row] ?? `第 ${row + 1} 列`;
      html += `<tr data-row="${row}">`;
      part.cols.forEach((col, index) => {
        const fixed = part.fixedCells?.[`${row}:${index}`];
        if (col.type === "label") {
          const text = index === 0 ? part.rowLabels?.[row] ?? "" : part.sources?.[row] ?? "";
          html += index === 0 ? `<th scope="row" data-label="${esc(col.label)}">${esc(text)}</th>` : `<td class="w-src" data-label="${esc(col.label)}">${esc(text)}</td>`;
          return;
        }
        if (fixed) {
          html += `<td data-label="${esc(col.label)}">${esc(fixed)}</td>`;
          return;
        }
        const type = row === rows - 1 && col.lastRowType ? col.lastRowType : col.type;
        const prefixText = part.labelledFirst && index === 0 ? part.rowLabels?.[row] : null;
        html += `<td data-label="${esc(col.label)}">${cellControl(col, type, `${part.prefix}:${row}:${index}`, `${rowLabel} ${col.label}`, prefixText)}</td>`;
      });
      if (part.dynamic) html += `<td class="w-col-tools"><button type="button" class="w-row-del" data-del-row="${esc(part.prefix)}" data-index="${row}" aria-label="刪除第 ${row + 1} 列">刪除</button></td>`;
      html += "</tr>";
    }
    host.innerHTML = `<div class="w-table">${html}</tbody></table></div>`;
    bindFields(host);
  }
  function bindFields(root) {
    $$("[data-field]", root).forEach((element) => {
      const key = element.dataset.field;
      if (element.type === "radio") element.checked = state.fields[key] === element.value;
      else element.value = state.fields[key] ?? "";
    });
    $$("[data-check]", root).forEach((element) => (element.checked = state.checks[element.dataset.check] === true));
  }
  function setField(key, value) {
    if (typeof value === "string" && value !== "") state.fields[key] = value;
    else delete state.fields[key];
  }
  function addRow(prefix) {
    const part = partOf(prefix);
    const rows = rowTotal(prefix);
    if (rows >= (part.dynamic.max ?? 30)) return;
    state.rows[prefix] = rows + 1;
    touch();
    renderTable(part);
    refresh();
    $(`[data-table="${attr(prefix)}"] tr[data-row="${rows}"] [data-field]`)?.focus();
  }
  function rowHasText(prefix, row) {
    return Object.keys(state.fields).some((key) => key.startsWith(`${prefix}:${row}:`) && filled(key));
  }
  async function deleteRow(prefix, row) {
    const part = partOf(prefix);
    const rows = rowTotal(prefix);
    const min = part.dynamic.min ?? 0;
    if (rowHasText(prefix, row)) {
      const ok = await ask(rows > min ? `刪除第 ${row + 1} 列？` : `清空第 ${row + 1} 列？`, `<p>這一列寫的內容會一起刪除，無法復原。若之後還要用，可以先到「我的進度與紀錄」匯出備份檔。</p>`, [["刪除", true], ["取消", false]]);
      if (!ok) return;
    }
    const cols = part.cols.length;
    if (rows > min) {
      for (let r = row; r < rows - 1; r++) for (let c = 0; c < cols; c++) setField(`${prefix}:${r}:${c}`, state.fields[`${prefix}:${r + 1}:${c}`]);
      for (let c = 0; c < cols; c++) delete state.fields[`${prefix}:${rows - 1}:${c}`];
      state.rows[prefix] = rows - 1;
    } else for (let c = 0; c < cols; c++) delete state.fields[`${prefix}:${row}:${c}`];
    touch();
    flush();
    renderTable(part);
    refresh();
  }

  /* ───────────── summaries, feedback, portfolio ───────────── */
  function summaryOf(id) {
    const task = M.tasks[id];
    const items = [];
    for (const part of task.parts) {
      if (part.kind === "table") {
        const rows = rowTotal(part.prefix);
        const lines = [];
        for (let row = 0; row < rows; row++) {
          const values = part.cols
            .map((col, index) => {
              if (col.type === "label") return index === 0 ? null : null;
              const raw = state.fields[`${part.prefix}:${row}:${index}`];
              if (!raw || !raw.trim()) return null;
              const text = col.type === "select" ? (col.options.find(([value]) => value === raw)?.[1] ?? raw) : col.type === "tri" ? TRI[raw] ?? raw : raw;
              return `${col.label}：${text}`;
            })
            .filter(Boolean);
          if (values.length) lines.push(`${part.rowLabels?.[row] ? `${part.rowLabels[row]}　` : ""}${values.join(" · ")}`);
        }
        if (lines.length) items.push([part.title, lines]);
      } else if (part.kind === "choice") {
        const value = state.fields[part.key];
        if (value) items.push([part.title, [value === "other" ? `其他：${state.fields[`${part.key}:other`] ?? ""}` : part.options[Number(value)]]]);
      } else if (part.kind === "tri-list") {
        const lines = part.items
          .map((item, index) => {
            const value = state.fields[`${part.prefix}:${index}`];
            if (!value) return null;
            const why = state.fields[`${part.prefix}:${index}:why`];
            return `${index + 1}. ${item} → ${TRI[value]}${why ? `（${why}）` : ""}`;
          })
          .filter(Boolean);
        if (lines.length) items.push([part.title, lines]);
      } else if (part.kind === "fields" || part.kind === "pnl") {
        const lines = part.fields
          .map((field) => {
            const key = field.key ?? `${part.prefix}:${field.id}`;
            const raw = state.fields[key];
            if (!raw || !raw.trim()) return null;
            const text = field.input === "tri" || field.type === "tri" ? TRI[raw] : field.input === "stock" || field.type === "select" ? (M.stocks.find(([code]) => code === raw)?.join(" ") ?? raw) : raw;
            return `${field.label}：${text}`;
          })
          .filter(Boolean);
        if (lines.length) items.push([part.title, lines]);
      } else if (part.kind === "toggle" && state.checks[part.key]) items.push(["成交", [part.label]]);
    }
    if (filled(`${id}:think`)) items.push(["想一想", [state.fields[`${id}:think`]]]);
    return items;
  }
  function summaryHtml(id, max = 14) {
    const items = summaryOf(id);
    if (!items.length) return '<p class="w-small">這一關的成果在系統畫面裡（見下一行）。</p>';
    return items.map(([title, lines]) => `<div class="w-sum"><b>${esc(title)}</b><ul>${lines.slice(0, max).map((line) => `<li>${esc(line)}</li>`).join("")}${lines.length > max ? `<li>…另有 ${lines.length - max} 列</li>` : ""}</ul></div>`).join("");
  }
  function renderDone(id) {
    const host = $(`[data-done="${attr(id)}"]`);
    if (!host) return;
    const task = M.tasks[id];
    const status = taskStatus(id);
    host.classList.toggle("is-done", status.done);
    if (!status.done) {
      setHtml(host, `<h3>完成這一關還差 ${status.missing.length} 項</h3><ul class="w-missing">${status.missing.map((item) => `<li>${item.self ? '<span class="w-pill">自評</span>' : '<span class="w-pill">作答</span>'}${esc(item.label)}</li>`).join("")}</ul><p class="w-small">「想一想」與標示「選做」的項目不影響完成；誠實回答「否」或「不適用」也算完成。</p>`);
      return;
    }
    const nextLink = task.next && byId.has(task.next) ? ` <a href="#${esc(task.next)}">前往 ${esc(task.next === "L01" ? "LEVEL 01" : task.next)} →</a>` : "";
    setHtml(host, `<p class="w-done-kicker">✓ 這一關完成了</p><dl class="w-done-grid"><div><dt>你現在會做什麼</dt><dd>${esc(task.can)}</dd></div><div><dt>你留下的成果</dt><dd>${summaryHtml(id, 6)}<p class="w-small">${esc(task.proof)}</p></dd></div><div><dt>下一個小挑戰</dt><dd>${esc(task.nextText || "")}${nextLink}</dd></div></dl><p class="w-small">完成＝你的自評與必填作答都齊了。這是學習紀錄，不是系統驗證或能力認證。</p>`);
  }
  function renderVerify() {
    for (const task of Object.values(M.tasks))
      for (const part of task.parts) {
        if (part.kind !== "table" || !part.verify) continue;
        const host = $(`[data-verify="${attr(part.prefix)}"]`);
        if (!host) continue;
        const lines = verify(part);
        setHtml(host, lines.length ? `<p class="w-verify-title">核對（只是提示，不影響完成）</p><ul>${lines.map(([ok, text]) => `<li class="${ok ? "ok" : "bad"}"><span aria-hidden="true">${ok ? "✓" : "⚠"}</span>${esc(text)}</li>`).join("")}</ul>` : "");
      }
  }
  function renderSheetStatus() {
    for (const task of Object.values(M.tasks))
      for (const req of task.req) {
        const list = req.t === "rows" ? [req] : req.t === "any" ? req.of.filter((item) => item.t === "rows") : [];
        for (const item of list) {
          const host = $(`[data-sheet-status="${attr(item.prefix)}"]`);
          if (!host) continue;
          const { done, target } = rowsProgress(item);
          host.textContent = done >= target ? `✓ 這張表的必填部分完成了（${done}／${target}）` : `必填：已完成 ${done}／${target}${req.t === "any" ? "（或勾選「這一輪沒有成交」）" : ""}`;
          host.classList.toggle("ok", done >= target);
        }
      }
  }
  function renderAbility(level) {
    const host = $(`[data-ability-status="${attr(level)}"]`);
    if (!host) return;
    const rows = levelTasks(level).map((id) => {
      const status = taskStatus(id);
      // A task finished by self-check alone names where the teacher can see that it happened.
      const proof = M.tasks[id].proof ?? "";
      const note = status.answers[1] ? "" : proof.startsWith("系統：") ? `只有自評 · 請講師核對系統證據：${proof.slice(3)}` : "只有自評（閱讀任務）";
      return `<li class="${status.done ? "ok" : ""}"><a href="#${esc(id)}">${esc(id)} ${esc(M.tasks[id].title)}</a><span>自評 ${status.self[0]}／${status.self[1]} · 作答 ${status.answers[0]}／${status.answers[1]}</span><em>${status.done ? "✓ 完成" : "進行中"}</em>${note ? `<small>${esc(note)}</small>` : ""}</li>`;
    });
    setHtml(host, `<ul class="w-ability-list">${rows.join("")}</ul><p class="w-small">${levelDone(level) ? "✓ 本關的自評與必填作答都完成了。" : "完成每個任務的自評與必填作答，本關就完成。"}講師確認：在「我的學習成果冊」列印頁由講師簽名。</p>`);
  }
  function renderPortfolio() {
    const host = $("[data-portfolio]");
    if (!host) return;
    const name = state.fields["portfolio:name"] ?? "";
    const section = (id) => {
      const status = taskStatus(id);
      return `<div class="w-pf-task"><h4>${id === "Q" ? "" : `${esc(id)} `}${esc(M.tasks[id].title)} <span class="${status.done ? "ok" : ""}">${status.done ? "✓ 完成" : `進行中（還差 ${status.missing.length} 項）`}</span></h4>${status.done ? `<p class="w-small">我現在會：${esc(M.tasks[id].can)}</p>` : ""}${summaryOf(id).length ? summaryHtml(id, 40) : ""}</div>`;
    };
    let html = `<div class="w-pf-head"><p>學員：<b>${esc(name || "（未填）")}</b></p><p>講義版本 ${esc(M.edition.version)} · 匯出／列印時間 ${esc(new Date().toLocaleString("zh-TW", { hour12: false }))}</p></div>`;
    html += `<section class="w-pf-level"><h3>課前小任務</h3>${section("Q")}</section>`;
    for (const [level, info] of Object.entries(M.levels)) {
      const done = levelDone(level);
      const card = info.record
        ? `<div class="w-pf-card"><b>能力卡 · ${esc(info.record.title)}</b><ul>${info.record.fields.map((field, index) => `<li>${esc(field)}：${esc(state.fields[`${level}:card:${index}`] ?? "")}</li>`).join("")}</ul></div>`
        : "";
      html += `<section class="w-pf-level"><h3>${level === "FINAL" ? "FINAL MISSION" : `LEVEL ${esc(info.code)}`} · ${esc(info.title)} <span class="${done ? "ok" : ""}">${done ? `✓ ${esc(info.achievement.en)}` : "進行中"}</span></h3><p class="w-small">${done ? `我現在會：${esc(info.achievement.promise)}` : ""}</p>${card}${levelTasks(level).map(section).join("")}<p class="w-pf-sign">講師確認：＿＿＿＿＿＿＿＿　日期：＿＿＿＿＿</p></section>`;
    }
    html += `<p class="w-small">自評＝學員自己的確認；作答＝學員寫下的內容；核對＝數位版的算式／教材資料比對提示；講師確認＝講師簽名。本成果冊不是能力認證，模擬損益不代表實際報酬。</p>`;
    host.innerHTML = html;
  }

  /* ───────────── progress everywhere ───────────── */
  function refresh() {
    const ids = M.order.filter((id) => id !== "Q");
    const done = ids.filter((id) => taskStatus(id).done).length;
    const percent = Math.round((done / ids.length) * 100);
    $("[data-total-text]").textContent = `${percent}%`;
    $("[data-total-bar]").style.width = `${percent}%`;
    $(".w-total").setAttribute("aria-label", `已完成 ${done}／${ids.length} 個任務`);
    for (const level of Object.keys(M.levels)) {
      const tasks = levelTasks(level);
      const finished = tasks.filter((id) => taskStatus(id).done).length;
      const complete = finished === tasks.length;
      $$(`[data-nav-progress="${attr(level)}"]`).forEach((bar) => bar.parentElement.style.setProperty("--p", `${Math.round((finished / tasks.length) * 100)}%`));
      $$(`[data-level-progress="${attr(level)}"]`).forEach((text) => (text.textContent = complete ? "本關完成 ✓（自評與必填作答齊全）" : `已完成 ${finished}／${tasks.length} 個任務`));
      $$(`[data-level-seal="${attr(level)}"]`).forEach((box) => box.classList.toggle("done", complete));
      $$(`[data-board-item="${attr(level)}"]`).forEach((item) => {
        item.classList.toggle("done", complete);
        const label = item.querySelector("[data-board-progress]");
        if (label) label.textContent = complete ? "已完成" : `${finished}／${tasks.length}`;
      });
      renderAbility(level);
    }
    for (const id of M.order) {
      const status = taskStatus(id);
      $$(`[data-task-progress="${attr(id)}"]`).forEach((label) => (label.textContent = status.done ? "✓ 完成" : status.missing.length < M.tasks[id].req.length ? `還差 ${status.missing.length}` : ""));
      $$(`[data-task-state="${attr(id)}"]`).forEach((label) => (label.textContent = status.done ? "✓ 已完成" : ""));
      renderDone(id);
    }
    $$("[data-auto]").forEach((mark) => {
      const ok = taskStatus(mark.dataset.auto).done;
      mark.classList.toggle("ok", ok);
      const text = $(`[data-auto-text="${attr(mark.dataset.auto)}"]`);
      if (text) text.textContent = ok ? "　✓ 已完成（數位作業）" : "　尚未完成";
    });
    renderSheetStatus();
    renderVerify();
    renderResume();
    if (!$("#view-portfolio").hidden) renderPortfolio();
  }
  function renderResume() {
    const host = $("[data-resume]");
    if (!host) return;
    const id = state.lastView;
    if (!id || id === "start" || !byId.has(id)) {
      setHtml(host, "");
      return;
    }
    const view = VIEWS[byId.get(id)];
    setHtml(host, `<a class="w-resume" href="#${esc(id)}"><span>繼續上次學習</span><b>${esc(view.title)}</b><small>${state.updatedAt ? `最後保存 ${esc(new Date(state.updatedAt).toLocaleString("zh-TW", { hour12: false }))}` : ""}</small></a>`);
  }

  /* ───────────── routing ───────────── */
  function show(id) {
    flush();
    if (!byId.has(id)) id = "start";
    const index = byId.get(id);
    $$(".w-view").forEach((view) => (view.hidden = view.dataset.view !== id));
    $$("[data-nav]").forEach((link) => (link.dataset.nav === id ? link.setAttribute("aria-current", "page") : link.removeAttribute("aria-current")));
    const prev = $("[data-prev]");
    const next = $("[data-next]");
    prev.href = `#${VIEWS[index - 1]?.id ?? id}`;
    next.href = `#${VIEWS[index + 1]?.id ?? id}`;
    prev.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === VIEWS.length - 1));
    const view = document.getElementById(`view-${id}`);
    document.title = `${view?.dataset.title ?? ""}｜學員實戰闖關手冊`;
    setNav(false, { focus: false });
    if (id !== "start" && id !== state.lastView) rememberView(id);
    if (id === "portfolio") renderPortfolio();
    if (id === "progress") renderBackups();
    window.scrollTo({ top: 0 });
    $("#w-main").focus({ preventScroll: true });
  }

  /* ───────────── table of contents (a drawer below the top bar on narrow screens) ───────────── */
  function setNav(open, { focus = true } = {}) {
    const nav = $(".w-nav");
    if (nav.classList.contains("open") === open) return;
    document.documentElement.style.setProperty("--bar-h", `${$(".w-bar").offsetHeight}px`);
    nav.classList.toggle("open", open);
    $(".w-menu").setAttribute("aria-expanded", String(open));
    $("[data-nav-backdrop]").hidden = !open;
    // While the drawer is open the page behind it cannot be reached; the top bar (with 「目錄」) stays usable.
    $$(".w-skip, .w-banner, #w-main").forEach((element) => (element.inert = open));
    if (open) (nav.querySelector('[aria-current="page"]') ?? $("[data-nav-close]")).focus();
    else if (focus) $(".w-menu").focus();
  }

  /* ───────────── dialogs (focus kept inside, background inert) ───────────── */
  const background = () => $$(".w-skip, .w-bar, .w-banner, .w-layout");
  function trapTab(container, event) {
    if (event.key !== "Tab") return;
    const items = $$("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])", container).filter((element) => !element.disabled && element.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (document.activeElement === first || !container.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !container.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }
  function ask(title, bodyHtml, buttons) {
    return new Promise((resolve) => {
      const dialog = $("[data-dialog]");
      const back = document.activeElement;
      $("[data-dialog-title]").textContent = title;
      $("[data-dialog-body]").innerHTML = bodyHtml;
      const actions = $("[data-dialog-actions]");
      actions.innerHTML = buttons.map(([label], index) => `<button type="button" class="w-button${index ? " w-button-quiet" : ""}" data-answer="${index}">${esc(label)}</button>`).join("");
      background().forEach((element) => (element.inert = true));
      dialog.hidden = false;
      const close = (value) => {
        dialog.hidden = true;
        background().forEach((element) => (element.inert = false));
        dialog.removeEventListener("keydown", onKey);
        back?.focus?.();
        resolve(value);
      };
      const onKey = (event) => {
        if (event.key === "Escape") close(buttons.at(-1)[1]);
        trapTab(dialog, event);
      };
      dialog.addEventListener("keydown", onKey);
      $$("[data-answer]", actions).forEach((button) => button.addEventListener("click", () => close(buttons[Number(button.dataset.answer)][1])));
      $("[data-answer]", actions).focus();
    });
  }

  /* ───────────── export, import, backups, clear ───────────── */
  function download(text, filename, type = "application/json") {
    const blob = new Blob([text], { type });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }
  function exportText(source = state) {
    return JSON.stringify({ schema: SCHEMA, version: VERSION, exportedAt: new Date().toISOString(), edition: M.edition, data: source }, null, 2);
  }
  function exportFile() {
    flush();
    const date = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    download(exportText(), `闖關手冊學習紀錄-${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.json`);
  }
  function describe(source) {
    const tasksDone = M.order.filter((id) => {
      const saved = state;
      state = source;
      const ok = taskStatus(id).done;
      state = saved;
      return ok;
    }).length;
    const fields = Object.values(source.fields).filter((value) => value.trim()).length;
    const checks = Object.keys(source.checks).length;
    return `完成任務 ${tasksDone} 個 · 作答與筆記 ${fields} 欄 · 勾選 ${checks} 項${source.updatedAt ? ` · 最後修改 ${new Date(source.updatedAt).toLocaleString("zh-TW", { hour12: false })}` : ""}`;
  }
  function backupNow(tag) {
    flush();
    return keepCopy(JSON.stringify(state), tag);
  }
  async function replaceWith(incoming, how) {
    if (!backupNow("before-" + how)) {
      const choice = await ask("無法在這台裝置建立自動備份", "<p>可能是儲存空間不足。請先下載目前的紀錄，再決定是否繼續。</p>", [["下載目前紀錄", "download"], ["我已下載，繼續", "go"], ["取消", "cancel"]]);
      if (choice === "download") {
        exportFile();
        return replaceWith(incoming, how);
      }
      if (choice !== "go") return false;
    }
    state = incoming;
    dirty = true;
    flush();
    bindFields(document);
    for (const task of Object.values(M.tasks)) for (const part of task.parts) if (part.kind === "table") renderTable(part);
    refresh();
    renderBackups();
    return true;
  }
  async function importFile(file) {
    const review = $("[data-import-review]");
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      review.innerHTML = `<p class="w-error">匯入失敗：這個檔案不是有效的 JSON。目前的紀錄沒有被更動。</p>`;
      return;
    }
    const result = validate(parsed);
    if (!result.ok) {
      review.innerHTML = `<p class="w-error">匯入失敗：${esc(result.why)}。目前的紀錄沒有被更動。</p>`;
      return;
    }
    const exported = parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString("zh-TW", { hour12: false }) : "未知";
    const body = `<dl class="w-compare"><div><dt>要匯入的檔案</dt><dd>${esc(file.name)} · 匯出時間 ${esc(exported)}${parsed.edition?.version ? ` · 講義版本 ${esc(parsed.edition.version)}` : ""}<br>${esc(describe(result.state))}</dd></div><div><dt>這台裝置目前的紀錄</dt><dd>${esc(describe(state))}</dd></div></dl>${result.dropped ? `<p class="w-error">檔案中有 ${result.dropped} 筆格式不正確的資料會被略過。</p>` : ""}${result.migrated ? "<p class=\"w-small\">這是舊版格式，會轉成新版；無法判讀的舊勾選保留在 legacy 欄位。</p>" : ""}<p><strong>不會合併：</strong>這台裝置上的作答會被整份取代（取代前會自動備份，可在下方還原）。</p>`;
    const ok = await ask("要用這個檔案取代目前的紀錄嗎？", body, [["取代目前紀錄", true], ["取消", false]]);
    if (!ok) {
      review.innerHTML = `<p class="w-small">已取消匯入，目前的紀錄沒有被更動。</p>`;
      return;
    }
    if (await replaceWith(result.state, "import")) review.innerHTML = `<p class="w-ok">已匯入：${esc(describe(state))}。</p>`;
  }
  function renderBackups() {
    const host = $("[data-backups]");
    if (!host) return;
    const keys = storageKeys().filter((key) => key.startsWith(BACKUP)).sort().reverse();
    if (!keys.length) {
      host.innerHTML = '<p class="w-small">目前沒有自動備份。</p>';
      return;
    }
    host.innerHTML = `<ul class="w-backups">${keys
      .map((key) => {
        const parts = key.slice(BACKUP.length).split(":");
        const when = parts.at(-1).replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, "$1/$2/$3 $4:$5:$6 UTC");
        const label = { "before-import": "匯入前", "before-clear": "清除前", "before-restore": "還原前", unreadable: "無法讀取的原始資料", partial: "載入時略過資料前" }[parts[0]] ?? parts[0];
        return `<li><span>${esc(label)} · ${esc(when)}</span><button type="button" class="w-button w-button-quiet" data-backup-restore="${esc(key)}">還原</button><button type="button" class="w-button w-button-quiet" data-backup-download="${esc(key)}">下載</button><button type="button" class="w-button w-button-quiet" data-backup-delete="${esc(key)}">刪除</button></li>`;
      })
      .join("")}</ul>`;
  }
  async function restoreBackup(key) {
    const raw = storageGet(key);
    let result = { ok: false, why: "找不到備份" };
    try {
      result = raw ? validate(JSON.parse(raw)) : result;
    } catch {
      result = { ok: false, why: "備份內容無法解析" };
    }
    if (!result.ok) return ask("無法還原這份備份", `<p>${esc(result.why)}。可以按「下載」保存原始內容。</p>`, [["知道了", false]]);
    const ok = await ask("用這份備份取代目前的紀錄？", `<dl class="w-compare"><div><dt>備份</dt><dd>${esc(describe(result.state))}</dd></div><div><dt>目前</dt><dd>${esc(describe(state))}</dd></div></dl><p>目前的紀錄會先自動備份。</p>`, [["還原", true], ["取消", false]]);
    if (ok) await replaceWith(result.state, "restore");
  }

  /* ───────────── zoom viewer ───────────── */
  const lb = { root: $(".w-lightbox"), scale: 1, fit: 1, w: 1, h: 1, trigger: null, pointers: new Map(), pinch: null, pan: null, lastTap: 0 };
  lb.viewport = $("[data-lb-viewport]", lb.root);
  lb.stage = $("[data-lb-stage]", lb.root);
  const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
  function offsets(scale) {
    return { x: Math.max(0, (lb.viewport.clientWidth - lb.w * scale) / 2), y: Math.max(0, (lb.viewport.clientHeight - lb.h * scale) / 2) };
  }
  function setScale(next, anchor) {
    const view = lb.viewport;
    const min = Math.min(lb.fit, 1);
    const max = Math.max(4, lb.fit * 2);
    next = clamp(next, min, max);
    const ax = anchor?.x ?? view.clientWidth / 2;
    const ay = anchor?.y ?? view.clientHeight / 2;
    const before = offsets(lb.scale);
    const px = (view.scrollLeft + ax - before.x) / lb.scale;
    const py = (view.scrollTop + ay - before.y) / lb.scale;
    lb.scale = next;
    lb.stage.style.width = `${lb.w * next}px`;
    lb.stage.style.height = `${lb.h * next}px`;
    const after = offsets(next);
    view.scrollLeft = px * next + after.x - ax;
    view.scrollTop = py * next + after.y - ay;
    $("[data-lb-zoom]", lb.root).textContent = `${Math.round(next * 100)}%`;
    lb.root.dataset.scale = String(next);
  }
  function fitNow(reset) {
    lb.fit = Math.min(lb.viewport.clientWidth / lb.w, lb.viewport.clientHeight / lb.h);
    setScale(lb.fit);
    if (reset) lb.viewport.scrollTo(0, 0);
  }
  function openViewer(figureElement, trigger) {
    lb.trigger = trigger ?? document.activeElement;
    const crop = $(".crop", figureElement);
    const box = crop.getBoundingClientRect();
    lb.w = Number(figureElement.dataset.cropW) || box.width;
    lb.h = Number(figureElement.dataset.cropH) || box.height;
    const copy = crop.cloneNode(true);
    copy.style.aspectRatio = "auto";
    copy.style.width = "100%";
    copy.style.height = "100%";
    $$("img", copy).forEach((image) => {
      image.loading = "eager";
      image.decoding = "sync";
    });
    lb.stage.replaceChildren(copy);
    const caption = $("figcaption", figureElement);
    const number = caption ? $("span b", caption)?.textContent ?? "" : "";
    const words = caption ? $("span", caption).textContent.slice(number.length).trim() : "";
    $("#w-lb-title").textContent = caption ? `${number}${number && words ? "　" : ""}${words}` : "截圖";
    $("[data-lb-caption]", lb.root).textContent = caption ? $(".src", caption)?.textContent ?? "" : "";
    const markers = $$(".marker", copy);
    $("[data-lb-marks]", lb.root).innerHTML = markers.length ? `<span>跳到標號</span>${markers.map((marker, index) => `<button type="button" class="w-lb-btn w-lb-mark" data-lb-goto="${index}" aria-label="放大到標號 ${esc(marker.textContent)}">${esc(marker.textContent)}</button>`).join("")}` : "";
    background().forEach((element) => (element.inert = true));
    lb.root.hidden = false;
    document.documentElement.classList.add("w-lb-open");
    lb.scale = 1;
    fitNow(true);
    $('[data-lb="close"]', lb.root).focus();
  }
  function closeViewer() {
    if (lb.root.hidden) return;
    lb.root.hidden = true;
    lb.stage.replaceChildren();
    background().forEach((element) => (element.inert = false));
    document.documentElement.classList.remove("w-lb-open");
    lb.trigger?.focus?.();
  }
  function gotoMarker(index) {
    const marker = $$(".marker", lb.stage)[index];
    if (!marker) return;
    // Where the marker is drawn (its anchor may be clamped into the frame), in capture pixels.
    const frame = lb.stage.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    const x = ((box.left + box.width / 2 - frame.left) / frame.width) * lb.w;
    const y = ((box.top + box.height / 2 - frame.top) / frame.height) * lb.h;
    setScale(Math.max(1, lb.scale));
    const off = offsets(lb.scale);
    lb.viewport.scrollLeft = x * lb.scale + off.x - lb.viewport.clientWidth / 2;
    lb.viewport.scrollTop = y * lb.scale + off.y - lb.viewport.clientHeight / 2;
  }
  function viewportPoint(event) {
    const rect = lb.viewport.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }
  // A mouse drag on an image would start the browser's own image drag, which cancels the pointer after
  // the first move; block it so dragging pans the picture, as touch does.
  lb.viewport.addEventListener("dragstart", (event) => event.preventDefault());
  lb.viewport.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse") {
      if (event.button !== 0) return;
      event.preventDefault();
      lb.viewport.focus({ preventScroll: true });
    }
    lb.viewport.setPointerCapture(event.pointerId);
    lb.pointers.set(event.pointerId, viewportPoint(event));
    if (lb.pointers.size === 2) {
      const [a, b] = [...lb.pointers.values()];
      lb.pinch = { distance: Math.hypot(a.x - b.x, a.y - b.y), scale: lb.scale };
      lb.pan = null;
    } else if (lb.pointers.size === 1) {
      const point = viewportPoint(event);
      lb.pan = { x: point.x, y: point.y, left: lb.viewport.scrollLeft, top: lb.viewport.scrollTop, moved: false };
      lb.viewport.classList.add("is-panning");
    }
  });
  lb.viewport.addEventListener("pointermove", (event) => {
    if (!lb.pointers.has(event.pointerId)) return;
    lb.pointers.set(event.pointerId, viewportPoint(event));
    if (lb.pinch && lb.pointers.size >= 2) {
      const [a, b] = [...lb.pointers.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      setScale(lb.pinch.scale * (distance / lb.pinch.distance), { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    } else if (lb.pan) {
      const point = viewportPoint(event);
      if (Math.abs(point.x - lb.pan.x) + Math.abs(point.y - lb.pan.y) > 4) lb.pan.moved = true;
      lb.viewport.scrollLeft = lb.pan.left - (point.x - lb.pan.x);
      lb.viewport.scrollTop = lb.pan.top - (point.y - lb.pan.y);
    }
  });
  const endPointer = (event) => {
    const point = lb.pointers.get(event.pointerId);
    lb.pointers.delete(event.pointerId);
    if (lb.pointers.size < 2) lb.pinch = null;
    if (event.type === "pointerup" && lb.pan && !lb.pan.moved && point) {
      const now = Date.now();
      if (now - lb.lastTap < 320) {
        setScale(lb.scale < 0.99 ? 1 : lb.fit, point);
        lb.lastTap = 0;
      } else lb.lastTap = now;
    }
    if (lb.pointers.size === 1) {
      const [rest] = [...lb.pointers.values()];
      lb.pan = { x: rest.x, y: rest.y, left: lb.viewport.scrollLeft, top: lb.viewport.scrollTop, moved: true };
    } else if (!lb.pointers.size) {
      lb.pan = null;
      lb.viewport.classList.remove("is-panning");
    }
  };
  lb.viewport.addEventListener("pointerup", endPointer);
  lb.viewport.addEventListener("pointercancel", endPointer);
  lb.viewport.addEventListener(
    "wheel",
    (event) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      setScale(lb.scale * (event.deltaY < 0 ? 1.15 : 1 / 1.15), viewportPoint(event));
    },
    { passive: false },
  );
  lb.viewport.addEventListener("keydown", (event) => {
    const step = 60;
    const keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[event.key]) {
      event.preventDefault();
      lb.viewport.scrollBy(...keys[event.key]);
    } else if (event.key === "+" || event.key === "=") setScale(lb.scale * 1.25);
    else if (event.key === "-") setScale(lb.scale / 1.25);
    else if (event.key === "0") fitNow(false);
    else if (event.key === "1") setScale(1);
  });
  lb.root.addEventListener("click", (event) => {
    const action = event.target.closest("[data-lb]")?.dataset.lb;
    if (action === "close") closeViewer();
    else if (action === "fit") fitNow(false);
    else if (action === "reset") fitNow(true);
    else if (action === "actual") setScale(1);
    else if (action === "in") setScale(lb.scale * 1.25);
    else if (action === "out") setScale(lb.scale / 1.25);
    const goto = event.target.closest("[data-lb-goto]");
    if (goto) gotoMarker(Number(goto.dataset.lbGoto));
  });
  lb.root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeViewer();
      return;
    }
    trapTab(lb.root, event);
  });
  window.addEventListener("resize", () => {
    if (!lb.root.hidden) {
      const wasFit = Math.abs(lb.scale - lb.fit) < 0.001;
      lb.fit = Math.min(lb.viewport.clientWidth / lb.w, lb.viewport.clientHeight / lb.h);
      if (wasFit) setScale(lb.fit);
    }
  });

  /* ───────────── wire up ───────────── */
  load();
  for (const task of Object.values(M.tasks)) for (const part of task.parts) if (part.kind === "table") renderTable(part);
  bindFields(document);

  document.addEventListener("input", (event) => {
    const element = event.target.closest("[data-field]");
    if (!element || element.type === "radio") return;
    setField(element.dataset.field, element.value);
    touch();
    refresh();
  });
  document.addEventListener("change", (event) => {
    const field = event.target.closest("[data-field]");
    if (field) {
      // Typing was taken key by key; leaving the box only writes what is pending and is not a new edit.
      const before = state.fields[field.dataset.field];
      if (field.type === "radio") {
        if (field.checked) setField(field.dataset.field, field.value);
      } else setField(field.dataset.field, field.value);
      if (state.fields[field.dataset.field] !== before) touch();
      flush();
      refresh();
      return;
    }
    const box = event.target.closest("[data-check]");
    if (box) {
      if (box.checked) state.checks[box.dataset.check] = true;
      else delete state.checks[box.dataset.check];
      touch();
      flush();
      refresh();
    }
    const file = event.target.closest("[data-import]");
    if (file?.files?.[0]) {
      importFile(file.files[0]);
      file.value = "";
    }
  });
  document.addEventListener("focusout", (event) => {
    if (event.target.closest?.("[data-field]")) flush();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
  window.addEventListener("beforeunload", (event) => {
    if (!flush() && dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  document.addEventListener("click", (event) => {
    const add = event.target.closest("[data-add-row]");
    if (add) return addRow(add.dataset.addRow);
    const del = event.target.closest("[data-del-row]");
    if (del) return deleteRow(del.dataset.delRow, Number(del.dataset.index));
    const frame = event.target.closest(".w-main .figure .frame");
    if (frame) return openViewer(frame.closest(".figure"), frame);
    const fill = event.target.closest("[data-card-fill]");
    if (fill) {
      const level = fill.dataset.cardFill;
      (M.levels[level].cardFrom ?? []).forEach(([source, kind], index) => {
        const key = `${level}:card:${index}`;
        if (filled(key) || !filled(source)) return;
        const value = state.fields[source];
        setField(key, kind === "stock" ? (M.stocks.find(([code]) => code === value)?.join(" ") ?? value) : value);
      });
      touch();
      flush();
      bindFields($(`#view-${attr(level)}`));
      refresh();
      return;
    }
    if (event.target.closest("[data-export]")) return exportFile();
    if (event.target.closest("[data-print]")) {
      flush();
      renderPortfolio();
      document.documentElement.classList.add("w-printing");
      window.print();
      setTimeout(() => document.documentElement.classList.remove("w-printing"), 500);
      return;
    }
    const restore = event.target.closest("[data-backup-restore]");
    if (restore) return restoreBackup(restore.dataset.backupRestore);
    const save = event.target.closest("[data-backup-download]");
    if (save) return download(storageGet(save.dataset.backupDownload) ?? "", `闖關手冊備份-${save.dataset.backupDownload.split(":").at(-1)}.json`);
    const remove = event.target.closest("[data-backup-delete]");
    if (remove) {
      ask("刪除這份自動備份？", "<p>刪除後無法復原。</p>", [["刪除", true], ["取消", false]]).then((ok) => {
        if (!ok) return;
        try {
          window.localStorage.removeItem(remove.dataset.backupDelete);
        } catch {
          /* nothing else to do */
        }
        renderBackups();
      });
      return;
    }
    if (event.target.closest("[data-reset]")) {
      ask("清除這台裝置的紀錄？", "<p>會清除這台裝置上的作答、勾選與筆記。清除前會先自動備份（可在下方還原），也建議先匯出備份檔。</p>", [["先匯出備份檔", "export"], ["清除", "clear"], ["取消", "cancel"]]).then(async (choice) => {
        if (choice === "export") exportFile();
        if (choice !== "clear") return;
        await replaceWith(blank(), "clear");
      });
    }
  });
  document.addEventListener("keydown", (event) => {
    const frame = event.target.closest?.(".w-main .figure .frame[role='button']");
    if (frame && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      openViewer(frame.closest(".figure"), frame);
    }
  });
  $(".w-menu").addEventListener("click", () => setNav(!$(".w-nav").classList.contains("open")));
  $("[data-nav-close]").addEventListener("click", () => setNav(false));
  $("[data-nav-backdrop]").addEventListener("click", () => setNav(false));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $(".w-nav").classList.contains("open")) {
      event.preventDefault();
      setNav(false);
    }
  });
  // Widening the window turns the drawer back into the sidebar: never leave the page inert behind it.
  window.matchMedia("(max-width: 1000px)").addEventListener("change", () => setNav(false, { focus: false }));
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  window.ACADEMY_DEBUG = { taskStatus, levelDone, flush, state: () => JSON.parse(JSON.stringify(state)), storageKey: () => mainKey };
  setStatus(dirty ? "saving" : "");
  if (dirty) flush();
  refresh();
  show(location.hash.slice(1) || "start");
})();
