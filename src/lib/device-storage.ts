/** Per-device conveniences only. Blocked or missing storage behaves like an empty one. */
export function browserStorage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

export function readDeviceValue(storage: Pick<Storage, "getItem"> | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeDeviceValue(
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  key: string,
  value: string | null,
): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch {
    /* Session-only. */
  }
}
