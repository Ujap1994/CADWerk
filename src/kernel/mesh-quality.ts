export interface MeshQuality {
  /** Maximum chordal deviation in mm. */
  linear: number;
  /** Maximum angle between neighboring facets in radians. */
  angular: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Tessellation for the 3D view, relative to the part size so small and large parts look equally smooth. */
export function displayQuality(diagonal: number): MeshQuality {
  // 0.2 rad (about 11°) keeps curved faces and their outlines smooth without visible facets.
  return { linear: clamp(diagonal * 5e-4, 0.002, 2), angular: 0.2 };
}

/** Finer tessellation for STL export. */
export function exportQuality(diagonal: number): MeshQuality {
  return { linear: clamp(diagonal * 1e-4, 0.001, 0.1), angular: 0.15 };
}

export function qualityTag(quality: MeshQuality): string {
  return `${quality.linear.toPrecision(3)}/${quality.angular}`;
}
