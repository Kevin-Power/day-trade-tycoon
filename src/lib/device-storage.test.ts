import assert from "node:assert/strict";
import { test } from "node:test";
import { readDeviceValue, writeDeviceValue } from "./device-storage.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
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

test("a written value reads back and null removes it", () => {
  const storage = memory();
  assert.equal(readDeviceValue(storage, "day-tycoon-x-v1"), null);
  writeDeviceValue(storage, "day-tycoon-x-v1", "seen");
  assert.equal(readDeviceValue(storage, "day-tycoon-x-v1"), "seen");
  writeDeviceValue(storage, "day-tycoon-x-v1", null);
  assert.equal(storage.values.has("day-tycoon-x-v1"), false);
});

test("blocked or missing storage reads null and never throws", () => {
  assert.equal(readDeviceValue(blocked, "k"), null);
  assert.equal(readDeviceValue(undefined, "k"), null);
  assert.doesNotThrow(() => writeDeviceValue(blocked, "k", "v"));
  assert.doesNotThrow(() => writeDeviceValue(blocked, "k", null));
  assert.doesNotThrow(() => writeDeviceValue(undefined, "k", "v"));
});
