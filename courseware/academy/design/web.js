// 學員實戰闖關手冊 · interactive edition. Progress lives only in this browser (localStorage).
(() => {
  const KEY = "dtt-academy-workbook-v1";
  const views = window.ACADEMY_VIEWS || [];
  const byId = new Map(views.map((view, index) => [view.id, index]));
  let storageOk = true;
  let state = { checks: {}, notes: {}, updatedAt: null };

  function load() {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) state = { checks: {}, notes: {}, ...JSON.parse(raw) };
    } catch {
      storageOk = false;
    }
  }
  function save() {
    state.updatedAt = new Date().toISOString();
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      storageOk = false;
      showStorage();
    }
  }
  function showStorage() {
    document.querySelectorAll("[data-storage-status]").forEach((element) => {
      element.textContent = storageOk
        ? "目前狀態：這個瀏覽器可以保存你的勾選與筆記。"
        : "目前狀態：這個瀏覽器不允許保存（例如無痕視窗或已封鎖網站資料），重新整理後勾選會消失。";
    });
  }

  /* ── progress ── */
  function progressOf(selector) {
    const boxes = [...document.querySelectorAll(selector)];
    const done = boxes.filter((box) => box.checked).length;
    return { done, total: boxes.length, ratio: boxes.length ? done / boxes.length : 0 };
  }
  function refresh() {
    const all = progressOf('input[type="checkbox"][data-key]');
    const percent = Math.round(all.ratio * 100);
    document.querySelector("[data-total-text]").textContent = `${percent}%`;
    document.querySelector("[data-total-bar]").style.width = `${percent}%`;
    const levels = [...new Set(views.filter((view) => view.level).map((view) => view.level))];
    for (const level of levels) {
      const tasks = views.filter((view) => view.level === level && view.task).map((view) => view.id);
      const selector = tasks.map((id) => `#view-${CSS.escape(id)} input[type="checkbox"][data-key]`).join(",");
      const result = selector ? progressOf(selector) : { done: 0, total: 0, ratio: 0 };
      const complete = result.total > 0 && result.done === result.total;
      document.querySelectorAll(`[data-nav-progress="${level}"]`).forEach((bar) => bar.parentElement.style.setProperty("--p", `${Math.round(result.ratio * 100)}%`));
      document.querySelectorAll(`[data-level-progress="${level}"]`).forEach((text) => {
        text.textContent = complete ? "已完成本關所有勾選項目 ✓" : `已勾選 ${result.done} / ${result.total} 項`;
      });
      document.querySelectorAll(`[data-level-seal="${level}"]`).forEach((box) => box.classList.toggle("done", complete));
      document.querySelectorAll(`[data-board-item="${level}"]`).forEach((item) => {
        item.classList.toggle("done", complete);
        const label = item.querySelector("[data-board-progress]");
        if (label) label.textContent = complete ? "已完成" : `${result.done} / ${result.total}`;
      });
      for (const id of tasks) {
        const own = progressOf(`#view-${CSS.escape(id)} input[type="checkbox"][data-key]`);
        document.querySelectorAll(`[data-task-progress="${CSS.escape(id)}"]`).forEach((label) => {
          label.textContent = own.total ? (own.done === own.total ? "✓ 完成" : `${own.done}/${own.total}`) : "";
        });
      }
    }
  }

  /* ── routing ── */
  function show(id) {
    if (!byId.has(id)) id = "start";
    const index = byId.get(id);
    document.querySelectorAll(".w-view").forEach((view) => (view.hidden = view.dataset.view !== id));
    document.querySelectorAll("[data-nav]").forEach((link) => {
      if (link.dataset.nav === id) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
    const prev = document.querySelector("[data-prev]");
    const next = document.querySelector("[data-next]");
    prev.href = `#${views[index - 1]?.id ?? id}`;
    next.href = `#${views[index + 1]?.id ?? id}`;
    prev.setAttribute("aria-disabled", String(index === 0));
    next.setAttribute("aria-disabled", String(index === views.length - 1));
    const view = document.getElementById(`view-${id}`);
    document.title = `${view?.dataset.title ?? ""}｜學員實戰闖關手冊`;
    document.querySelector(".w-nav").classList.remove("open");
    document.querySelector(".w-menu").setAttribute("aria-expanded", "false");
    window.scrollTo({ top: 0 });
    document.getElementById("w-main").focus({ preventScroll: true });
  }

  /* ── lightbox ── */
  const lightbox = document.querySelector(".w-lightbox");
  const lightboxBody = lightbox.querySelector(".w-lightbox-body");
  let lastFocus = null;
  function openLightbox(figure) {
    lastFocus = document.activeElement;
    lightboxBody.innerHTML = "";
    const copy = figure.cloneNode(true);
    copy.style.width = "";
    lightboxBody.append(copy);
    lightbox.hidden = false;
    lightbox.querySelector(".w-lightbox-close").focus();
  }
  function closeLightbox() {
    lightbox.hidden = true;
    lightboxBody.innerHTML = "";
    lastFocus?.focus?.();
  }

  /* ── wire up ── */
  load();
  document.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => {
    box.checked = Boolean(state.checks[box.dataset.key]);
    box.addEventListener("change", () => {
      if (box.checked) state.checks[box.dataset.key] = true;
      else delete state.checks[box.dataset.key];
      save();
      refresh();
    });
  });
  document.querySelectorAll("textarea[data-note]").forEach((area) => {
    area.value = state.notes[area.dataset.note] ?? "";
    let timer = 0;
    area.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (area.value.trim()) state.notes[area.dataset.note] = area.value;
        else delete state.notes[area.dataset.note];
        save();
      }, 300);
    });
  });
  document.addEventListener("click", (event) => {
    const frame = event.target.closest(".w-main .figure .frame");
    if (frame) openLightbox(frame.closest(".figure"));
  });
  lightbox.querySelector(".w-lightbox-close").addEventListener("click", closeLightbox);
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox || event.target === lightboxBody) closeLightbox();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !lightbox.hidden) closeLightbox();
  });
  document.querySelector(".w-menu").addEventListener("click", (event) => {
    const nav = document.querySelector(".w-nav");
    const open = !nav.classList.contains("open");
    nav.classList.toggle("open", open);
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  document.querySelector("[data-export]")?.addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "我的闖關手冊勾選紀錄.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 2000);
  });
  document.querySelector("[data-reset]")?.addEventListener("click", () => {
    if (!window.confirm("要清除這台裝置上的所有勾選與筆記嗎？這個動作無法復原。")) return;
    state = { checks: {}, notes: {}, updatedAt: null };
    try {
      window.localStorage.removeItem(KEY);
    } catch {
      storageOk = false;
    }
    document.querySelectorAll('input[type="checkbox"][data-key]').forEach((box) => (box.checked = false));
    document.querySelectorAll("textarea[data-note]").forEach((area) => (area.value = ""));
    refresh();
  });
  window.addEventListener("hashchange", () => show(location.hash.slice(1)));
  showStorage();
  refresh();
  show(location.hash.slice(1) || "start");
})();
