import { useLayoutEffect, useRef, useState } from "react";

/**
 * Which way a live price last moved, with a key that restarts the flash animation on every move. Switching
 * to another stock (`identity`) is not a move, so it never flashes.
 */
export function useTickFlash(value: number | null | undefined, identity: string): { flash?: "up" | "down"; key: number } {
  const previous = useRef({ value, identity });
  const [state, setState] = useState<{ flash?: "up" | "down"; key: number }>({ key: 0 });
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = { value, identity };
    if (before.identity !== identity) return setState((current) => ({ key: current.key + 1 }));
    if (before.value == null || value == null || before.value === value) return;
    setState((current) => ({ flash: value > before.value! ? "up" : "down", key: current.key + 1 }));
  }, [value, identity]);
  return state;
}
