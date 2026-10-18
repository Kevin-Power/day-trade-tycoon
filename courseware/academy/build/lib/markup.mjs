// Inline markup for workbook copy:
//   「介面文字」 → a UI-label chip      **粗體** → bold       `09:20` → mono numbers
//   [[名詞]] → glossary term          『引號』 stays as plain text (non-UI quote)
export function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function rich(value) {
  return esc(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/「([^「」]+)」/g, '<span class="ui">$1</span>')
    .replace(/`([^`]+)`/g, '<span class="num">$1</span>')
    .replace(/\[\[([^\]]+)\]\]/g, '<span class="term">$1</span>');
}

/** Plain text for search indexes and font subsetting. */
export function plain(value) {
  return String(value ?? "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[\[([^\]]+)\]\]/g, "$1");
}

export const BRAND_SVG = `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="1" y="1" width="46" height="46" rx="14" fill="#233e61"/><rect x="1.5" y="1.5" width="45" height="45" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity=".12"/><path d="M12 15.5C16.5 14.5 20.3 16 24 19C27.7 16 31.5 14.5 36 15.5V32C31.5 31 27.7 32.5 24 35C20.3 32.5 16.5 31 12 32V15.5Z" fill="none" stroke="#f3eee0" stroke-width="1.6" stroke-linejoin="round"/><path d="M24 19V35" stroke="#f3eee0" stroke-width="1.6"/><path d="M18 20V28M30 19V27" stroke="#d7bc7c" stroke-width="1.6" stroke-linecap="round"/><path d="M16.5 22H19.5V26H16.5V22ZM28.5 21H31.5V24.5H28.5V21Z" fill="#d7bc7c"/></svg>`;

/** Achievement seal: bezel ticks, the achievement name around the ring, the level in the centre. */
export function seal({ name, code, state = "locked", size = "34mm", id }) {
  const on = state === "unlocked";
  const stroke = on ? "#1f55cf" : "#b6bec9";
  const ink = on ? "#12357f" : "#8a939f";
  const fill = on ? "#eef3fd" : "#ffffff";
  const ticks = Array.from({ length: 60 }, (_, index) => {
    const angle = (index / 60) * Math.PI * 2;
    const inner = index % 5 === 0 ? 40.2 : 41.4;
    const x1 = 50 + Math.sin(angle) * inner;
    const y1 = 50 - Math.cos(angle) * inner;
    const x2 = 50 + Math.sin(angle) * 43;
    const y2 = 50 - Math.cos(angle) * 43;
    return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="${index % 5 === 0 ? 0.9 : 0.45}"/>`;
  }).join("");
  const pathId = `seal-path-${id}`;
  const label = `${name.toUpperCase()} · ACHIEVEMENT · `;
  return `<svg class="seal" viewBox="0 0 100 100" style="width:${size};height:${size}" role="img" aria-label="${esc(name)} 成就章">
  <circle cx="50" cy="50" r="47" fill="${fill}" stroke="${stroke}" stroke-width="1.1"/>
  ${ticks}
  <circle cx="50" cy="50" r="27.5" fill="none" stroke="${stroke}" stroke-width="0.6"/>
  <defs><path id="${pathId}" d="M 50 50 m -33.2 0 a 33.2 33.2 0 1 1 66.4 0 a 33.2 33.2 0 1 1 -66.4 0"/></defs>
  <text font-family="WB Mono, WB Sans, monospace" font-size="5.6" letter-spacing="1.3" fill="${ink}" font-weight="500"><textPath href="#${pathId}" startOffset="0">${esc(label)}${esc(label)}</textPath></text>
  <text x="50" y="45" text-anchor="middle" font-family="WB Mono, WB Sans, monospace" font-size="5.2" letter-spacing="1.6" fill="${ink}">${esc(code === "FINAL" ? "FINAL" : "LEVEL")}</text>
  <text x="50" y="62" text-anchor="middle" font-family="WB Mono, WB Sans, monospace" font-size="${code === "FINAL" ? 11 : 17}" font-weight="300" fill="${ink}">${esc(code === "FINAL" ? "★" : code)}</text>
</svg>`;
}
