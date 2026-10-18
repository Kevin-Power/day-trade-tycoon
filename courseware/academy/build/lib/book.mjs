// A book is a list of fixed A4 pages. Pages are rendered after the list is complete, so the table of
// contents, level openers and cross references can print real page numbers.
import { esc, rich, BRAND_SVG } from "./markup.mjs";

export const LEVEL_ORDER = ["L01", "L02", "L03", "L04", "L05", "L06", "FINAL"];

export class Book {
  constructor({ kind, title, legal, imageBase = "" }) {
    this.kind = kind;
    this.imageBase = imageBase;
    this.title = title;
    this.legal = legal;
    this.pages = [];
  }

  /** page: { id, level, head, bare, className, render(ctx) } */
  add(page) {
    if (this.pages.some((existing) => existing.id === page.id)) throw new Error(`duplicate page id ${page.id}`);
    this.pages.push(page);
    return page;
  }

  render() {
    const numbers = new Map(this.pages.map((page, index) => [page.id, index + 1]));
    const ctx = {
      kind: this.kind,
      imageBase: this.imageBase,
      total: this.pages.length,
      pageOf: (id) => {
        if (!numbers.has(id)) throw new Error(`unknown page reference ${id}`);
        return numbers.get(id);
      },
      fill(text) {
        return String(text ?? "").replace(/\{\{page:([^}]+)\}\}/g, (_, id) => String(ctx.pageOf(id)));
      },
      // Page and task references become links; Chrome keeps same-document links as GoTo links in the PDF.
      link: (id, html) => `<a class="xref" href="#p-${esc(id)}">${html}</a>`,
      rich(text) {
        const marked = String(text ?? "").replace(/\{\{page:([^}]+)\}\}/g, (_, id) => `\u0001${id}\u0001`);
        return rich(marked)
          .replace(/\u0001([^\u0001]+)\u0001/g, (_, id) => ctx.link(id, String(ctx.pageOf(id))))
          .replace(/任務 ([0-9]{2}-[0-9]|F-[0-9])/g, (match, task) => (numbers.has(`${task}-a`) ? ctx.link(`${task}-a`, match) : match));
      },
    };
    return this.pages
      .map((page, index) => {
        const body = page.render(ctx);
        return `<section class="page${page.className ? " " + page.className : ""}${page.bare ? " bleed" : ""}" id="p-${esc(page.id)}" data-page="${index + 1}" data-level="${esc(page.level ?? "")}">
${page.bare ? "" : runHead(page, this)}
<div class="page-body">${body}</div>
${page.bare ? "" : runFoot(page, index + 1, this)}
</section>`;
      })
      .join("\n");
  }
}

function runHead(page, book) {
  return `<header class="run-head"><span class="brand">${BRAND_SVG}<span>當沖大富翁 · TRADING ACADEMY${book.kind === "teacher" ? " · INSTRUCTOR" : ""}</span></span><span class="where">${page.head ?? ""}</span></header>`;
}

function runFoot(page, number, book) {
  const index = LEVEL_ORDER.indexOf(page.level);
  const ticks = LEVEL_ORDER.map((level, i) => `<i class="${index < 0 ? "" : i < index ? "done" : i === index ? "now" : ""}" title="${level}"></i>`).join("");
  const label = index < 0 ? "" : `<span>${page.level === "FINAL" ? "FINAL" : `LEVEL ${page.level.slice(1)}`}</span>`;
  return `<footer class="run-foot"><span class="legal">${esc(book.legal)}</span><span class="progress-ticks" aria-hidden="true">${ticks}${label}</span><span class="folio">${number}</span></footer>`;
}
