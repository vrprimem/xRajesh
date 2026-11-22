// The VR Prime mark: a bold black V on a safety-yellow tile. The Logo component draws it on the pages and
// scripts/make-icons.mjs draws it for the app icons, so both read it from here.

export const LOGO = {
  /** The V, on the 64-unit tile (square ends, sharp point). */
  v: "M16 16l16 28 16-28",
  /** The tile, the same in light and dark. */
  tile: "#ffd60a",
  /** The V. */
  ink: "#0a0a0a",
  /** How thick the V is, in tile units. */
  stroke: 8,
} as const;
