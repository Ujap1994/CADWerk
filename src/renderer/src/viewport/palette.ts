export interface ViewportPalette {
  body: number;
  edge: number;
  hover: number;
  selected: number;
  referenceEdge: number;
  pivot: number;
  /** Standard planes. */
  plane: number;
  /** Sketch grid lines. */
  grid: number;
  axisX: number;
  axisY: number;
  /** Geometry of the open sketch: under-defined (can still move), fully defined, over-defined. */
  sketch: number;
  sketchFull: number;
  sketchOver: number;
  /** Other sketches. */
  sketchInactive: number;
  /** Inference lines while drawing. */
  guide: number;
  /** Dimensions of the open sketch; driven (reference) dimensions are shown dimmer. */
  dimension: number;
  dimensionDriven: number;
  cubeFace: number;
  cubeFaceHover: number;
  cubeEdge: number;
  cubeText: string;
  hemisphereSky: number;
  hemisphereGround: number;
}

export const palettes: Record<'light' | 'dark', ViewportPalette> = {
  light: {
    body: 0xb7c4d6,
    edge: 0x1d2633,
    hover: 0xffb547,
    selected: 0xff7a1a,
    referenceEdge: 0x2a63c9,
    pivot: 0xff7a1a,
    plane: 0x2a63c9,
    grid: 0x2c3a4f,
    axisX: 0xe5484d,
    axisY: 0x30a46c,
    sketch: 0x1f56c4,
    sketchFull: 0x111827,
    sketchOver: 0xd12d2d,
    sketchInactive: 0x3d4a5c,
    guide: 0x5f6e84,
    dimension: 0x1e293b,
    dimensionDriven: 0x7b8798,
    cubeFace: 0xf4f6fa,
    cubeFaceHover: 0xffc978,
    cubeEdge: 0xc4cddb,
    cubeText: '#2a3442',
    hemisphereSky: 0xffffff,
    hemisphereGround: 0x8a95a6,
  },
  dark: {
    body: 0x9cadc4,
    edge: 0x0a0e13,
    hover: 0xffb547,
    selected: 0xff8a33,
    referenceEdge: 0x6c9cf5,
    pivot: 0xff8a33,
    plane: 0x6c9cf5,
    grid: 0xb4c0d2,
    axisX: 0xf06368,
    axisY: 0x4cc38a,
    sketch: 0x7eaaff,
    sketchFull: 0xf1f5f9,
    sketchOver: 0xff6b6b,
    sketchInactive: 0xa9b5c6,
    guide: 0x9fb0c8,
    dimension: 0xe2e8f0,
    dimensionDriven: 0x8d99aa,
    cubeFace: 0x2c3442,
    cubeFaceHover: 0xb87522,
    cubeEdge: 0x3a4556,
    cubeText: '#e6eaf0',
    hemisphereSky: 0xdfe7f5,
    hemisphereGround: 0x2a313c,
  },
};
