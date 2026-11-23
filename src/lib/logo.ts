// The VR Prime mark: a bold white V on an indigo tile. The Logo component draws it on the pages and
// scripts/make-icons.mjs draws it for the app icons, so both read it from here.

export const LOGO = {
  /** The V, on the 64-unit tile (square ends, sharp point). */
  v: "M16 16l16 28 16-28",
  /** The tile, the same in light and dark. */
  tile: "#4f46e5",
  /** The V. */
  ink: "#ffffff",
  /** On the indigo sign-in band the colours swap: a white tile with an indigo V. */
  onBrandTile: "#ffffff",
  onBrandInk: "#4338ca",
  /** How thick the V is, in tile units. */
  stroke: 8,
} as const;
