/** Minor grid lines are at least this far apart on screen; closer decades are skipped. */
export const MIN_GRID_PX = 12;
/** Minor lines fade in between MIN_GRID_PX and this spacing, so zooming never pops. */
export const FULL_GRID_PX = 40;

/** Grid spacing for a zoom level: a power of ten (major lines every ten) and how strongly the minor lines show (0–1). */
export function gridSpacing(mmPerPixel: number): { minor: number; minorStrength: number } {
  const minor = 10 ** Math.ceil(Math.log10(MIN_GRID_PX * mmPerPixel));
  const minorPx = minor / mmPerPixel;
  const t = Math.min(1, Math.max(0, (minorPx - MIN_GRID_PX) / (FULL_GRID_PX - MIN_GRID_PX)));
  return { minor, minorStrength: t * t * (3 - 2 * t) };
}
