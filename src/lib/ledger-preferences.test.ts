import assert from "node:assert/strict";
import { test } from "node:test";
import { readLedgerOpen, writeLedgerOpen } from "./ledger-preferences.ts";

const memory = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
};
const blocked = {
  getItem: () => { throw new Error("SecurityError"); },
  setItem: () => { throw new Error("QuotaExceededError"); },
};

test("the ledger starts collapsed unless the viewer opened it before", () => {
  const storage = memory();
  assert.equal(readLedgerOpen(storage), false);
  writeLedgerOpen(storage, true);
  assert.equal(readLedgerOpen(storage), true);
  writeLedgerOpen(storage, false);
  assert.equal(readLedgerOpen(storage), false);
});

test("blocked or missing storage keeps the default and never throws", () => {
  assert.equal(readLedgerOpen(undefined), false);
  assert.equal(readLedgerOpen(blocked), false);
  assert.doesNotThrow(() => writeLedgerOpen(blocked, true));
  assert.doesNotThrow(() => writeLedgerOpen(undefined, true));
});
