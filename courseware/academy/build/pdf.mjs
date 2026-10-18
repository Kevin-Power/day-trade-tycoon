// Prints a fixed-page workbook HTML to A4 PDF. Refuses to print when any page overflows its body,
// an image fails to load, or the workbook fonts did not load.
import { chromium } from "playwright";
import { pathToFileURL } from "node:url";

export async function printPdf({ html, pdf, title }) {
  const browser = await chromium.launch().catch(() => chromium.launch({ channel: "chrome" }));
  try {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(html).href, { waitUntil: "load" });
    await page.evaluate(async () => {
      await document.fonts.ready;
      for (const image of document.images) image.loading = "eager";
      const settle = (image) =>
        image.complete
          ? null
          : new Promise((resolve) => {
              image.addEventListener("load", resolve, { once: true });
              image.addEventListener("error", resolve, { once: true });
            });
      await Promise.race([Promise.all([...document.images].map(settle)), new Promise((resolve) => setTimeout(resolve, 60000))]);
    });
    await page.emulateMedia({ media: "print" });
    const report = await page.evaluate(() => {
      const problems = [];
      for (const image of document.images)
        if (!image.naturalWidth) problems.push(`broken image ${image.getAttribute("src")}`);
      const fonts = [...document.fonts].filter((face) => face.status === "loaded").map((face) => `${face.family} ${face.weight}`);
      if (!fonts.some((name) => name.includes("WB Sans"))) problems.push("WB Sans did not load");
      if (!fonts.some((name) => name.includes("WB Mono"))) problems.push("WB Mono did not load");
      const pages = [...document.querySelectorAll(".page")];
      pages.forEach((page, index) => {
        const body = page.querySelector(".page-body");
        if (!body) return;
        const box = body.getBoundingClientRect();
        const over = body.scrollHeight - body.clientHeight;
        const wide = body.scrollWidth - body.clientWidth;
        let lowest = 0;
        for (const element of body.querySelectorAll("*")) {
          const rect = element.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (getComputedStyle(element).position === "absolute" && element.closest(".crop")) continue;
          lowest = Math.max(lowest, rect.bottom - box.bottom);
        }
        if (over > 1 || wide > 1 || lowest > 1)
          problems.push(`page ${index + 1} (${page.id}) overflows: +${Math.round(Math.max(over, lowest) / 3.7795)}mm down, +${Math.round(wide / 3.7795)}mm across`);
        const free = box.bottom - Math.max(...[...body.children].map((child) => child.getBoundingClientRect().bottom), box.top);
        page.dataset.freeMm = String(Math.round(free / 3.7795));
      });
      const free = pages.map((page, index) => `${index + 1}:${page.dataset.freeMm ?? "-"}`);
      return { problems, fonts, pages: pages.length, free };
    });
    if (report.problems.length) {
      console.log("PRINT CHECK FAILED:\n" + report.problems.join("\n"));
      return { ok: false, ...report };
    }
    await page.pdf({
      path: pdf,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      tagged: true,
      outline: true,
    });
    return { ok: true, ...report, browser: browser.version(), title };
  } finally {
    await browser.close();
  }
}
