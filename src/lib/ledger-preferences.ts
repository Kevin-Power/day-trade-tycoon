import { create } from "zustand";

const STORAGE_KEY = "day-tycoon-ledger-v1";

/** Accessing localStorage itself throws when site data is blocked. */
function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readLedgerOpen(storage: Pick<Storage, "getItem"> | undefined): boolean {
  try {
    return storage?.getItem(STORAGE_KEY) === "open";
  } catch {
    return false;
  }
}

export function writeLedgerOpen(storage: Pick<Storage, "setItem"> | undefined, open: boolean): void {
  try {
    storage?.setItem(STORAGE_KEY, open ? "open" : "closed");
  } catch {
    /* Session-only preference. */
  }
}

type LedgerPreferences = {
  open: boolean;
  hydrate: () => void;
  setOpen: (open: boolean) => void;
};

/** Desk ledger: collapsed to one row by default; the viewer's choice is remembered per browser. */
export const useLedgerPreferences = create<LedgerPreferences>((set) => ({
  open: false,
  hydrate: () => set({ open: readLedgerOpen(browserStorage()) }),
  setOpen: (open) => {
    set({ open });
    writeLedgerOpen(browserStorage(), open);
  },
}));
