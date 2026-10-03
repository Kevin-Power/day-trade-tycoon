import { create } from "zustand";

export type ReadingMode = "standard" | "senior";
const STORAGE_KEY = "day-tycoon-display-v1";

type DisplayPreferences = {
  mode: ReadingMode;
  hydrated: boolean;
  hydrate: () => void;
  setMode: (mode: ReadingMode) => void;
};

export const useDisplayPreferences = create<DisplayPreferences>((set) => ({
  mode: "standard",
  hydrated: false,
  hydrate: () => {
    let mode: ReadingMode = "standard";
    try {
      if (localStorage.getItem(STORAGE_KEY) === "senior") mode = "senior";
    } catch { /* Reading remains available with session-only preferences. */ }
    set({ mode, hydrated: true });
  },
  setMode: (mode) => {
    set({ mode });
    try { localStorage.setItem(STORAGE_KEY, mode); } catch { /* Session-only preference. */ }
  },
}));
