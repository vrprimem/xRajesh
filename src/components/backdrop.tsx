/**
 * The scene behind every page: a dusk (or beach-day) sky, a striped setting sun, a neon grid floor and two groups of
 * palm silhouettes (public/art, drawn by scripts/palms.mjs). Original artwork; purely decorative, so it is hidden from
 * screen readers and never takes a click.
 */
export function Backdrop() {
  return (
    <div aria-hidden="true" className="vr-backdrop print:hidden">
      <div className="vr-sun-glow" />
      <div className="vr-sun" />
      <div className="vr-floor" />
      <div className="vr-palms vr-palms-left" />
      <div className="vr-palms vr-palms-right" />
    </div>
  );
}
