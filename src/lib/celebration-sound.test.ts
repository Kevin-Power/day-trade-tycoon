import assert from "node:assert/strict";
import { test } from "node:test";
import { chimeNotes } from "./celebration-sound.ts";

test("points play two soft notes and a level-up four rising ones, each within a second", () => {
  const points = chimeNotes("points");
  const levelUp = chimeNotes("level-up");
  assert.equal(points.length, 2);
  assert.equal(levelUp.length, 4);
  for (const notes of [points, levelUp]) {
    assert.ok(Math.max(...notes.map((note) => note.start + note.duration)) <= 1);
    assert.ok(notes.every((note) => note.gain > 0 && note.gain <= 0.05));
    assert.ok(notes.every((note, index) => index === 0 || note.frequency > notes[index - 1]!.frequency));
  }
});
