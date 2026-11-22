// The VR Prime mark, "Sunset V": a night-violet tile with a sunset border, and the V in the same sunset. The Logo
// component draws it on the pages and scripts/make-icons.mjs draws it for the app icons, so both read it from here.

export const LOGO = {
  /** The V, on the 64-unit tile. */
  v: "M16 18l16 28 16-28",
  /** The tile, the same in light and dark. */
  tile: "#140822",
  /** The sunset, top left to bottom right. */
  stops: [
    ["0", "#ffc53d"],
    [".5", "#ff2e93"],
    ["1", "#a855ff"],
  ],
} as const;
