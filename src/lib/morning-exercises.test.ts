import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";
import { getMorningExercise, MORNING_EXERCISES, type MorningExercise } from "./morning-exercises.ts";

test("exercise IDs resolve only to the six real-replay learning topics", () => {
  assert.deepEqual(
    MORNING_EXERCISES.map((exercise) => exercise.id),
    ["first-order", "position", "exit", "n-breakout", "patience", "review"],
  );
  for (const exercise of MORNING_EXERCISES) {
    assert.equal(getMorningExercise(exercise.id), exercise);
  }
  for (const id of [undefined, "", "wed-open", "unknown", "../first-order"]) {
    assert.equal(getMorningExercise(id), undefined);
  }
});

function loadCourseCard(offline: boolean) {
  const source = readFileSync(new URL("../components/lobby.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile("lobby.tsx", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const card = parsed.statements.find(
    (statement): statement is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(statement) && statement.name?.text === "CourseCard",
  );
  assert.ok(card, "Lobby must render an exercise card");
  const { outputText } = ts.transpileModule(`export ${card.getText(parsed)}`, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS },
  });
  const exports: { CourseCard?: ComponentType<{ exercise: MorningExercise; index: number }> } = {};
  const Icon = () => null;
  runInNewContext(outputText, {
    exports,
    require: (name: string) => {
      assert.equal(name, "react/jsx-runtime");
      return jsxRuntime;
    },
    CLASSROOM_OFFLINE: offline,
    COURSE_ART: Array.from({ length: 6 }, () => ({ tone: "plan", icon: Icon })),
    ArrowRight: Icon,
  });
  assert.ok(exports.CourseCard);
  return exports.CourseCard;
}

for (const offline of [false, true]) {
  test(`${offline ? "offline" : "online"} course cards open the selected topic at the simulation ticket`, () => {
    const CourseCard = loadCourseCard(offline);
    MORNING_EXERCISES.forEach((exercise, index) => {
      const html = renderToStaticMarkup(createElement(CourseCard, { exercise, index }));
      const links = [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1].replaceAll("&amp;", "&"));
      assert.deepEqual(links, [
        `${offline ? "https://rich.yilutek.com" : ""}/morning?exercise=${exercise.id}&panel=trade`,
      ]);
      assert.ok(html.includes(exercise.title));
      assert.ok(html.includes(exercise.prep[0]));
      assert.ok(html.includes(exercise.review[0]));
      assert.doesNotMatch(html, /disabled|待補真實行情|scenario=|\/session\//);
    });
  });
}
