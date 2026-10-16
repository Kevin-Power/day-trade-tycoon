import assert from "node:assert/strict";
import { test } from "node:test";
import { readSpeechPreference, writeSpeechPreference } from "./display-preferences.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  };
};
const blocked = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
  removeItem: () => { throw new Error("SecurityError"); },
};

test("read-aloud starts off and unasked", () => {
  assert.deepEqual(readSpeechPreference(memory()), { speech: false, asked: false });
});

test("an answer is remembered either way", () => {
  const storage = memory();
  writeSpeechPreference(storage, true);
  assert.deepEqual(readSpeechPreference(storage), { speech: true, asked: true });
  writeSpeechPreference(storage, false);
  assert.deepEqual(readSpeechPreference(storage), { speech: false, asked: true });
});

test("blocked storage keeps the default and never throws", () => {
  assert.deepEqual(readSpeechPreference(blocked), { speech: false, asked: false });
  assert.doesNotThrow(() => writeSpeechPreference(blocked, true));
  assert.deepEqual(readSpeechPreference(undefined), { speech: false, asked: false });
});
