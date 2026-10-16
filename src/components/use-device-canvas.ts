import { useCallback, useEffect, useRef, type RefObject } from "react";
import { canvasResolution } from "@/lib/market/chart-data";

type Render = (ctx: CanvasRenderingContext2D, width: number, height: number) => void;

/**
 * Keeps a canvas's backing store at the screen's exact device pixels and repaints it after every
 * React render and whenever its size, theme, reading mode, fonts or screen resolution change.
 * `render` draws in CSS pixels. An opaque canvas must paint its whole area (browsers then use
 * sharper text); a transparent one is cleared first. Returns a function that schedules a repaint.
 */
export function useDeviceCanvas(
  ref: RefObject<HTMLCanvasElement | null>,
  render: Render,
  { opaque = false }: { opaque?: boolean } = {},
): () => void {
  const latest = useRef(render);
  const redraw = useRef<() => void>(() => {});

  // Keep observers stable even when the caller supplies a new render function each render.
  useEffect(() => {
    latest.current = render;
    redraw.current();
  });
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let frame = 0;
    let disposed = false;
    // Exact device pixels the browser gives this canvas, where ResizeObserver reports them.
    let deviceBox: { width: number; height: number } | undefined;
    const draw = () => {
      frame = 0;
      if (disposed) return;
      const { width, height } = canvas.getBoundingClientRect();
      if (width < 8 || height < 8) return;
      // Backing pixels must match the screen's device pixels one to one: any other size is
      // resampled by the browser, which blurs every snapped line and every glyph.
      const size = canvasResolution(width, height, window.devicePixelRatio, deviceBox);
      if (canvas.width !== size.width) canvas.width = size.width;
      if (canvas.height !== size.height) canvas.height = size.height;
      const ctx = canvas.getContext("2d", { alpha: !opaque });
      if (!ctx) return;
      ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
      if (!opaque) ctx.clearRect(0, 0, width, height);
      latest.current(ctx, width, height);
    };
    const schedule = () => {
      if (!disposed && !frame) frame = requestAnimationFrame(draw);
    };
    redraw.current = schedule;
    const resize = new ResizeObserver((entries) => {
      const box = entries.at(-1)?.devicePixelContentBoxSize?.[0];
      if (box) deviceBox = { width: box.inlineSize, height: box.blockSize };
      schedule();
    });
    try {
      resize.observe(canvas, { box: "device-pixel-content-box" });
    } catch {
      // Browsers without the device-pixel box (older Safari) round CSS size times ratio instead.
      resize.observe(canvas);
    }
    const changes = new MutationObserver(schedule);
    for (let element: HTMLElement | null = canvas; element; element = element.parentElement) {
      changes.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style", "data-market-theme", "data-reading-mode"],
      });
    }
    const palette = window.matchMedia("(prefers-color-scheme: dark)");
    palette.addEventListener("change", schedule);
    let resolution: MediaQueryList | undefined;
    const watchResolution = () => {
      resolution?.removeEventListener("change", watchResolution);
      resolution = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      resolution.addEventListener("change", watchResolution);
      schedule();
    };
    watchResolution();
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    document.fonts?.addEventListener("loadingdone", schedule);
    void document.fonts?.ready.then(schedule);
    schedule();
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize.disconnect();
      changes.disconnect();
      palette.removeEventListener("change", schedule);
      resolution?.removeEventListener("change", watchResolution);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      document.fonts?.removeEventListener("loadingdone", schedule);
      redraw.current = () => {};
    };
  }, [ref, opaque]);
  return useCallback(() => redraw.current(), []);
}
