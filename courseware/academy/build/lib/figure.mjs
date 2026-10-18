// Real screenshot + vector annotation. Everything is placed in percentages of the shown region, so
// the same markup works on an A4 page and in the responsive web edition.
import { esc, rich } from "./markup.mjs";

const pct = (value) => `${(Math.round(value * 10000) / 100).toFixed(2)}%`;

/** Resolves a crop: full shot, a named target (with padding in CSS px) or an explicit box. */
export function resolveCrop(shot, crop) {
  if (!crop) return { x: 0, y: 0, w: shot.width, h: shot.height };
  if (crop.around) {
    // Union of several named boxes, padded: frames a form or a panel without hard-coded pixels.
    const boxes = crop.around.map((name) => {
      const box = shot.boxes[name];
      if (!box) throw new Error(`crop target ${name} missing in shot`);
      return box;
    });
    const pad = crop.pad ?? 16;
    const left = Math.max(0, Math.min(...boxes.map((box) => box.x)) - (crop.padLeft ?? pad));
    const top = Math.max(0, Math.min(...boxes.map((box) => box.y)) - (crop.padTop ?? pad));
    const right = Math.min(shot.width, Math.max(...boxes.map((box) => box.x + box.w)) + (crop.padRight ?? pad));
    const bottom = Math.min(shot.height, Math.max(...boxes.map((box) => box.y + box.h)) + (crop.padBottom ?? pad));
    return { x: left, y: top, w: right - left, h: bottom - top };
  }
  if (typeof crop === "string" || crop.target) {
    const name = typeof crop === "string" ? crop : crop.target;
    const box = shot.boxes[name];
    if (!box) throw new Error(`crop target ${name} missing in shot`);
    const pad = crop.pad ?? 10;
    const x = Math.max(0, box.x - (crop.padLeft ?? pad));
    const y = Math.max(0, box.y - (crop.padTop ?? pad));
    const right = Math.min(shot.width, box.x + box.w + (crop.padRight ?? pad));
    const bottom = Math.min(shot.height, box.y + box.h + (crop.padBottom ?? pad));
    return { x, y, w: right - x, h: bottom - y };
  }
  return {
    x: Math.max(0, crop.x),
    y: Math.max(0, crop.y),
    w: Math.min(shot.width - Math.max(0, crop.x), crop.w),
    h: Math.min(shot.height - Math.max(0, crop.y), crop.h),
  };
}

function markerPoint(box, pos = "tl", crop, gutter = 0, gutterRight = 0) {
  const gap = 3;
  const points = {
    // gl / gr: centred in the figure's left / right gutter, level with the element.
    gl: [crop.x + gutter / 2, box.y + box.h / 2],
    gr: [crop.x + crop.w - gutterRight / 2, box.y + box.h / 2],
    tl: [box.x, box.y],
    tr: [box.x + box.w, box.y],
    bl: [box.x, box.y + box.h],
    br: [box.x + box.w, box.y + box.h],
    l: [box.x - 11 - gap, box.y + box.h / 2],
    r: [box.x + box.w + 11 + gap, box.y + box.h / 2],
    t: [box.x + box.w / 2, box.y - 11 - gap],
    b: [box.x + box.w / 2, box.y + box.h + 11 + gap],
    c: [box.x + box.w / 2, box.y + box.h / 2],
    il: [box.x + 13, box.y + box.h / 2],
    ir: [box.x + box.w - 13, box.y + box.h / 2],
  };
  let [x, y] = Array.isArray(pos) ? [box.x + pos[0], box.y + pos[1]] : points[pos] ?? points.tl;
  // Keep the whole marker inside the visible region.
  const marginX = Math.max(10, crop.w * 0.018);
  const marginY = Math.max(10, crop.h * 0.026);
  x = Math.min(crop.x + crop.w - marginX, Math.max(crop.x + marginX, x));
  y = Math.min(crop.y + crop.h - marginY, Math.max(crop.y + marginY, y));
  return [x, y];
}

/**
 * spec: { shot, crop, width (CSS length), marks: [{ n, target, pos, ring, soft, letter }], rings: [...],
 *         tag, caption, number, src, light }
 */
export function figure(shots, spec, { imageBase = "", lazy = false } = {}) {
  const shot = shots[spec.shot];
  if (!shot) throw new Error(`unknown shot ${spec.shot}`);
  let crop = resolveCrop(shot, spec.crop);
  // gutter: extra room (CSS px) left of the shown region, painted in the shot's edge colour, so that
  // markers can sit beside text that starts at the very edge of the capture.
  const gutter = spec.gutter ?? 0;
  if (gutter) crop = { ...crop, x: crop.x - gutter, w: crop.w + gutter };
  const gutterRight = spec.gutterRight ?? 0;
  if (gutterRight) crop = { ...crop, w: crop.w + gutterRight };
  const rel = (box) => ({
    left: (box.x - crop.x) / crop.w,
    top: (box.y - crop.y) / crop.h,
    width: box.w / crop.w,
    height: box.h / crop.h,
  });
  const ringPad = spec.ringPad ?? 3;
  const layers = [];
  // The gutter is painted over the image too, so an interior crop gets a clean margin, not neighbours.
  if (gutter) layers.push(`<i class="gutter" style="width:${pct(gutter / crop.w)};background:${spec.gutterColor ?? "#0b0f15"}"></i>`);
  if (gutterRight) layers.push(`<i class="gutter right" style="width:${pct(gutterRight / crop.w)};background:${spec.gutterColor ?? "#0b0f15"}"></i>`);
  const rings = [...(spec.rings ?? []), ...(spec.marks ?? []).filter((mark) => mark.ring !== false && mark.target)];
  for (const ring of rings) {
    const box = ring.box ?? shot.boxes[ring.target];
    if (!box) throw new Error(`${spec.shot}: target ${ring.target} missing`);
    const padded = { x: box.x - ringPad, y: box.y - ringPad, w: box.w + ringPad * 2, h: box.h + ringPad * 2 };
    const r = rel(padded);
    layers.push(
      `<i class="ring${ring.soft ? " soft" : ""}" style="left:${pct(r.left)};top:${pct(r.top)};width:${pct(r.width)};height:${pct(r.height)}"></i>`,
    );
  }
  for (const mark of spec.marks ?? []) {
    if (mark.n === undefined) continue;
    const box = mark.target ? shot.boxes[mark.target] : mark.box;
    if (!box) throw new Error(`${spec.shot}: target ${mark.target} missing`);
    const [x, y] = markerPoint(box, mark.pos, crop, gutter, gutterRight);
    layers.push(
      `<b class="marker${mark.letter ? " letter" : ""}${mark.alt ? " alt" : ""}" style="left:${pct((x - crop.x) / crop.w)};top:${pct((y - crop.y) / crop.h)}">${esc(mark.n)}</b>`,
    );
  }
  const imageWidth = shot.width / crop.w;
  const img = `<img src="${imageBase}${esc(shot.image ?? shot.file)}" alt="${esc(spec.alt ?? spec.caption ?? "")}" style="width:${pct(imageWidth)};left:${pct(-crop.x / crop.w)};top:${pct(-crop.y / crop.h)}"${lazy ? ' loading="lazy" decoding="async"' : ""}>`;
  const ratio = `${crop.w} / ${crop.h}`;
  const tag = spec.tag ? `<span class="tag">${esc(spec.tag)}</span>` : "";
  const caption = spec.caption
    ? `<figcaption><span>${spec.number ? `<b>${esc(spec.number)}</b>` : ""}${rich(spec.caption)}</span><span class="src">${esc(spec.src ?? sourceLine(shot))}</span></figcaption>`
    : "";
  return `<figure class="figure${spec.className ? " " + spec.className : ""}" style="${spec.width ? `width:${spec.width};` : ""}" data-shot="${esc(spec.shot)}">
  <div class="frame${spec.light ? " light" : ""}"><div class="crop" style="aspect-ratio:${ratio}${gutter ? `;background:${spec.gutterColor ?? "#0b0f15"}` : ""}">${img}${layers.join("")}${tag}</div></div>
  ${caption}
</figure>`;
}

export function sourceLine(shot) {
  const when = shot.clock ? ` · 回放 ${shot.clock}` : "";
  let day = "";
  if (shot.url?.includes("/morning")) {
    const match = shot.url.match(/lesson=morning-(\d{4})(\d{2})(\d{2})/);
    day = match ? `${match[1]}/${match[2]}/${match[3]}` : "2026/10/06";
  }
  return `系統實際畫面${day ? ` · 交易日 ${day}` : ""}${when}`;
}
