import { createElement, type SVGProps } from "react";

/**
 * Icons are drawn on a 15-unit grid with 1-unit strokes through pixel centres. Shown at a whole multiple of
 * 15 CSS pixels on a 1x or 2x screen, every straight line fills whole device pixels instead of blending
 * into two grey rows. Any other size scales the glyph and brings the blur back, so sizes snap to the grid.
 */
export const ICON_GRID = 15;

/** One <path> of a glyph, with React attribute names. */
export type GlyphPath = {
  d: string;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  strokeLinecap?: "butt" | "round" | "square";
  strokeLinejoin?: "miter" | "round" | "bevel";
  strokeMiterlimit?: number;
  fillRule?: "nonzero" | "evenodd";
  clipRule?: "nonzero" | "evenodd";
};

/** Stroke width and the box are fixed by the grid, so they are not props. */
export type IconProps = Omit<SVGProps<SVGSVGElement>, "ref" | "width" | "height" | "viewBox" | "strokeWidth"> & {
  /** CSS pixels; rounded to the nearest multiple of 15 (at least 15). */
  size?: number;
  /** Accessible name, rendered as a <title> child. */
  title?: string;
};

export type IconComponent = ((props: IconProps) => ReturnType<typeof createElement>) & {
  displayName: string;
  paths: readonly GlyphPath[];
};

export function iconSize(requested: number = ICON_GRID): number {
  return Math.max(1, Math.round(requested / ICON_GRID)) * ICON_GRID;
}

// The grid box and the 1-unit stroke belong to the glyph; untyped callers may still pass these, so they are dropped.
const FIXED = ["width", "height", "viewBox", "fill", "strokeWidth"];

export function createIcon(name: string, paths: readonly GlyphPath[]): IconComponent {
  const Icon = ({ size, className, title, children, ...rest }: IconProps) => {
    const px = iconSize(size);
    const attributes: Record<string, unknown> = { ...rest };
    for (const key of FIXED) delete attributes[key];
    // Decorative unless named by aria-label, aria-labelledby or a title. The title becomes a <title> child:
    // browsers ignore a title attribute on <svg>. A named icon is announced as an image.
    const named = title !== undefined || attributes["aria-label"] !== undefined || attributes["aria-labelledby"] !== undefined;
    return createElement(
      "svg",
      {
        ...(named ? { role: "img" } : { "aria-hidden": true }),
        ...attributes,
        xmlns: "http://www.w3.org/2000/svg",
        width: px,
        height: px,
        viewBox: `0 0 ${ICON_GRID} ${ICON_GRID}`,
        fill: "none",
        className: className ? `icon ${className}` : "icon",
        focusable: "false",
      },
      title !== undefined ? createElement("title", { key: "title" }, title) : null,
      ...paths.map((path, index) => createElement("path", { key: index, ...path })),
      children,
    );
  };
  return Object.assign(Icon, { displayName: name, paths });
}
