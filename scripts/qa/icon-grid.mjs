// Icon crispness on a rendered page. Icons are drawn on a 15-unit grid with 1-unit lines, so they stay sharp
// only at a whole multiple of 15 CSS px (15, 30, 45): any other size scales the lines into grey blends.
// Chrome snaps the icon box to whole device pixels itself, so position needs no check. lucide icons (the old
// 24-unit set) must be gone. In large text (大字), an icon that is a control's only content must be at least
// 30px on the classroom pages: the text grows 25% there, and that icon is all the control shows. (The trading
// desk sizes its own large-text controls.)
// iconGrid runs in the page (pass it to page.evaluate); iconGridFailures turns its report into messages.

/** @param {string | null} scope CSS selector limiting the scan, or null for the whole page. */
export function iconGrid(scope = null) {
  const roots = scope ? [...document.querySelectorAll(scope)] : [document];
  const visible = (el) => {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && getComputedStyle(el).visibility === "visible";
  };
  const id = (el) => {
    const parent = el.parentElement;
    const label = (parent?.textContent ?? "").trim().slice(0, 12);
    return `svg.${[...el.classList].slice(0, 2).join(".")} in ${parent?.tagName.toLowerCase()}.${[...(parent?.classList ?? [])].slice(0, 2).join(".")}[${label}]`;
  };
  const large = document.documentElement.dataset.readingMode === "senior";
  const report = { icons: 0, lucide: [], offGrid: [], smallIconOnly: [] };
  for (const svg of roots.flatMap((root) => [...root.querySelectorAll("svg")])) {
    if (!visible(svg)) continue;
    if (svg.classList.contains("lucide")) report.lucide.push(id(svg));
    if (!svg.classList.contains("icon")) continue;
    report.icons++;
    const style = getComputedStyle(svg);
    const width = parseFloat(style.width);
    const height = parseFloat(style.height);
    if (svg.getAttribute("viewBox") !== "0 0 15 15" || width !== height || width % 15 !== 0)
      report.offGrid.push(`${id(svg)} ${width}x${height}`);
    const control = svg.closest("button, a, summary");
    if (large && control && !svg.closest(".trading-desk") && !(control.textContent ?? "").trim() && width < 30)
      report.smallIconOnly.push(`${id(svg)} ${width}px`);
  }
  return report;
}

/**
 * @param {{ icons: number, lucide: string[], offGrid: string[], smallIconOnly: string[] }} report
 * @param {{ requireIcons?: boolean }} options requireIcons: the screen is known to show icons.
 */
export function iconGridFailures(report, { requireIcons = false } = {}) {
  const failures = [];
  if (report.lucide.length) failures.push(`${report.lucide.length} lucide icons left (${report.lucide.slice(0, 3).join(" | ")})`);
  if (report.offGrid.length) failures.push(`${report.offGrid.length} icons off the 15px grid (${report.offGrid.slice(0, 4).join(" | ")})`);
  if (report.smallIconOnly.length)
    failures.push(`${report.smallIconOnly.length} icon-only controls below 30px in large text (${report.smallIconOnly.slice(0, 3).join(" | ")})`);
  if (requireIcons && report.icons === 0) failures.push("no grid icons found");
  return failures;
}
