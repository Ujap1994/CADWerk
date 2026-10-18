export interface ViewportPalette {
  body: number;
  edge: number;
  hover: number;
  selected: number;
  referenceEdge: number;
  pivot: number;
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
    cubeFace: 0x2c3442,
    cubeFaceHover: 0xb87522,
    cubeEdge: 0x3a4556,
    cubeText: '#e6eaf0',
    hemisphereSky: 0xdfe7f5,
    hemisphereGround: 0x2a313c,
  },
};
