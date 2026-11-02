import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";

// 2026-11-02, the owner: 「把收費講師那些通通拿掉」. Learners get a classroom, not a sales page: no prices, quotes,
// enrolment, payment, inquiry form or licence plans. 報價 alone stays legal (自選報價 are market quotes), and so do
// trading costs (手續費、費用與稅額).
const url = (path: string) => new URL(`../../${path}`, import.meta.url);
const read = (path: string) => readFileSync(url(path), "utf8");

const LEARNER_FILES = [
  "src/components/gate-screen.tsx",
  "src/components/classroom-auth-layout.tsx",
  "src/components/lobby.tsx",
  "src/routes/login.tsx",
  "src/components/manual-page.tsx",
  "src/components/try-experience.tsx",
  "src/offline/main.tsx",
  "src/offline/README.txt",
  "docs/pdf-source.json",
];
const SALES = /繳費|報名|付款|收費|授權|方案|詢問|免費|課程說明|\/license|講師報價|課程費用|費用及入班|安排與費用/;

test("learner screens and the PDF manual carry no prices, quotes, enrolment or licence plans", () => {
  for (const path of LEARNER_FILES) assert.doesNotMatch(read(path), SALES, path);
});

// Page titles show in the browser tab and in LINE's in-app browser bar, so every page route counts as a learner screen.
test("page routes and their titles carry no sales words either", () => {
  const pages = readdirSync(url("src/routes"), { recursive: true, encoding: "utf8" })
    .map(path => path.replaceAll("\\", "/"))
    .filter(path => path.endsWith(".tsx") && !path.startsWith("api/") && path !== "license.tsx");
  assert.ok(pages.includes("try.tsx") && pages.length >= 10, pages.join(", "));
  for (const path of pages) assert.doesNotMatch(read(`src/routes/${path}`), SALES, path);
});

test("the course and licence page, its inquiry form and its copy are gone", () => {
  for (const path of ["src/components/license-page.tsx", "src/components/course-inquiry-form.tsx", "src/lib/license.ts"])
    assert.equal(existsSync(url(path)), false, path);
});

test("an old /license link lands in the classroom instead of a missing page", () => {
  assert.match(read("src/routes/license.tsx"), /throw redirect\(\{ to: "\/"/);
});
