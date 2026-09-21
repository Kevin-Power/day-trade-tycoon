import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FLASH_KEY,
  loadFlashOrder,
  saveFlashOrder,
  ticketAfterClickPrice,
} from "./flash-order.ts";

type StorageStub = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

function withWindow<T>(storage: StorageStub | undefined, fn: () => T): T {
  const prev = (globalThis as { window?: unknown }).window;
  if (storage) {
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  } else {
    delete (globalThis as { window?: unknown }).window;
  }
  try {
    return fn();
  } finally {
    if (prev === undefined) delete (globalThis as { window?: unknown }).window;
    else (globalThis as { window?: unknown }).window = prev;
  }
}

function memoryStorage(initial: Record<string, string> = {}): StorageStub & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("flash order preference", () => {
  it("defaults off without window or stored value", () => {
    assert.equal(withWindow(undefined, () => loadFlashOrder()), false);
    assert.equal(withWindow(memoryStorage(), () => loadFlashOrder()), false);
  });

  it("persists on/off like teachMode (1/0)", () => {
    const storage = memoryStorage();
    withWindow(storage, () => {
      saveFlashOrder(true);
      assert.equal(storage.data[FLASH_KEY], "1");
      assert.equal(loadFlashOrder(), true);
      saveFlashOrder(false);
      assert.equal(storage.data[FLASH_KEY], "0");
      assert.equal(loadFlashOrder(), false);
    });
  });
});

describe("ticketAfterClickPrice", () => {
  const ticket = { side: "sell" as const, type: "market" as const, lots: 5, price: 100, tif: "IOC" };

  it("fills limit price on tick and keeps lots/tif", () => {
    const next = ticketAfterClickPrice(ticket, 233.37);
    assert.equal(next.price, 233.5);
    assert.equal(next.type, "limit");
    assert.equal(next.side, "sell");
    assert.equal(next.lots, 5);
    assert.equal(next.tif, "IOC");
  });

  it("ask click buys and bid click sells", () => {
    assert.equal(ticketAfterClickPrice(ticket, 580, "buy").side, "buy");
    assert.equal(ticketAfterClickPrice(ticket, 579, "sell").side, "sell");
  });
});
