const GATE_KEY = "day-tycoon-gate-v1";

export function readUnlocked(): boolean {
  try {
    return localStorage.getItem(GATE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeUnlocked() {
  try {
    localStorage.setItem(GATE_KEY, "1");
  } catch {
    /* private mode */
  }
}

export function clearUnlocked() {
  try {
    localStorage.removeItem(GATE_KEY);
  } catch {
    /* private mode */
  }
}
