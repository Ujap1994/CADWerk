import {
  CanvasTexture,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Quaternion,
  Scene,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  type WebGLRenderer,
} from 'three';

const SIZE_PX = 92;
const MARGIN_PX = 8;

const AXES: { label: string; color: string; direction: Vector3 }[] = [
  { label: 'X', color: '#e5484d', direction: new Vector3(1, 0, 0) },
  { label: 'Y', color: '#30a46c', direction: new Vector3(0, 1, 0) },
  { label: 'Z', color: '#3e63dd', direction: new Vector3(0, 0, 1) },
];

function letterSprite(letter: string, color: string): Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  if (context) {
    context.fillStyle = color;
    context.font = '700 44px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(letter, 32, 34);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false }));
  sprite.scale.setScalar(0.42);
  return sprite;
}

/** Small X/Y/Z indicator in the bottom-left corner that follows the view orientation. */
export class AxisTriad {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1.5, 1.5, 1.5, -1.5, 0.1, 10);
  private readonly group = new Group();

  constructor() {
    for (const axis of AXES) {
      const material = new MeshBasicMaterial({ color: axis.color });
      const shaft = new Mesh(new CylinderGeometry(0.045, 0.045, 0.8, 12), material);
      const head = new Mesh(new ConeGeometry(0.12, 0.3, 16), material);
      // Cylinders and cones point along +Y; rotate them onto the axis.
      const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis.direction);
      shaft.quaternion.copy(rotation);
      head.quaternion.copy(rotation);
      shaft.position.copy(axis.direction).multiplyScalar(0.4);
      head.position.copy(axis.direction).multiplyScalar(0.95);
      const label = letterSprite(axis.label, axis.color);
      label.position.copy(axis.direction).multiplyScalar(1.32);
      this.group.add(shaft, head, label);
    }
    this.scene.add(this.group);
  }

  render(renderer: WebGLRenderer, canvasHeight: number, orientation: Quaternion): void {
    this.camera.position.set(0, 0, 3).applyQuaternion(orientation);
    this.camera.quaternion.copy(orientation);
    this.camera.updateMatrixWorld();
    const y = canvasHeight - MARGIN_PX - SIZE_PX;
    renderer.setViewport(MARGIN_PX, canvasHeight - y - SIZE_PX, SIZE_PX, SIZE_PX);
    renderer.setScissor(MARGIN_PX, canvasHeight - y - SIZE_PX, SIZE_PX, SIZE_PX);
    renderer.setScissorTest(true);
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.setScissorTest(false);
  }

  dispose(): void {
    this.group.traverse((object) => {
      if (object instanceof Mesh) {
        object.geometry.dispose();
        (object.material as MeshBasicMaterial).dispose();
      } else if (object instanceof Sprite) {
        object.material.map?.dispose();
        object.material.dispose();
      }
    });
  }
}
