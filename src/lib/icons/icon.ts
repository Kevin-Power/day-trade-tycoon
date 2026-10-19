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
};

export type IconComponent = ((props: IconProps) => ReturnType<typeof createElement>) & {
  displayName: string;
  paths: readonly GlyphPath[];
};

export function iconSize(requested: number = ICON_GRID): number {
  return Math.max(1, Math.round(requested / ICON_GRID)) * ICON_GRID;
}

const labelled = (props: Record<string, unknown>) =>
  Object.keys(props).some((key) => key.startsWith("aria-") || key === "role" || key === "title");

export function createIcon(name: string, paths: readonly GlyphPath[]): IconComponent {
  const Icon = ({ size, className, children, ...rest }: IconProps) => {
    const px = iconSize(size);
    // Decorative unless the caller names it; a named icon is announced as an image.
    const a11y = labelled(rest)
      ? rest["aria-label"] !== undefined && rest.role === undefined
        ? { role: "img" }
        : {}
      : { "aria-hidden": true };
    return createElement(
      "svg",
      {
        xmlns: "http://www.w3.org/2000/svg",
        width: px,
        height: px,
        viewBox: `0 0 ${ICON_GRID} ${ICON_GRID}`,
        fill: "none",
        className: className ? `icon ${className}` : "icon",
        focusable: "false",
        ...a11y,
        ...rest,
      },
      ...paths.map((path, index) => createElement("path", { key: index, ...path })),
      children,
    );
  };
  return Object.assign(Icon, { displayName: name, paths });
}
