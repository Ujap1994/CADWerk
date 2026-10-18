import type { OrthographicCamera, PerspectiveCamera, Sphere} from 'three';
import { MathUtils, Quaternion, Vector3 } from 'three';
import { VIEW_DIRECTIONS, viewQuaternion } from './views.ts';

/** Camera state independent of the projection: what is looked at, from where, and how much is visible. */
export interface ViewState {
  target: Vector3;
  quaternion: Quaternion;
  /** Visible world height at the target, in mm. */
  height: number;
}

const ROTATE_RADIANS_PER_PIXEL = 0.006;
const MIN_HEIGHT = 0.01;
const MAX_HEIGHT = 1e6;
const FIT_MARGIN = 1.2;

function cloneState(state: ViewState): ViewState {
  return { target: state.target.clone(), quaternion: state.quaternion.clone(), height: state.height };
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/**
 * Orbit, pan and zoom for CAD work:
 * - free rotation around the screen axes through a pivot (the point under the cursor),
 * - panning that keeps the grabbed point under the cursor,
 * - zooming towards the cursor,
 * - animated transitions between views.
 */
export class CameraController {
  readonly state: ViewState = {
    target: new Vector3(),
    quaternion: viewQuaternion(VIEW_DIRECTIONS.isometric),
    height: 250,
  };
  readonly fov = 35;
  private animation: { from: ViewState; to: ViewState; start: number; duration: number } | null = null;
  private readonly reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  /** Unit vector from the target towards the camera. */
  back(out = new Vector3()): Vector3 {
    return out.set(0, 0, 1).applyQuaternion(this.state.quaternion);
  }

  right(out = new Vector3()): Vector3 {
    return out.set(1, 0, 0).applyQuaternion(this.state.quaternion);
  }

  up(out = new Vector3()): Vector3 {
    return out.set(0, 1, 0).applyQuaternion(this.state.quaternion);
  }

  get animating(): boolean {
    return this.animation !== null;
  }

  /** Updates both cameras; near and far planes are fitted around the scene for depth precision. */
  apply(ortho: OrthographicCamera, perspective: PerspectiveCamera, aspect: number, scene: Sphere): void {
    const { target, quaternion, height } = this.state;
    const back = this.back();
    const radius = Math.max(scene.radius, 1);

    const distance = height / (2 * Math.tan(MathUtils.degToRad(this.fov) / 2));
    perspective.position.copy(target).addScaledVector(back, distance);
    perspective.quaternion.copy(quaternion);
    perspective.fov = this.fov;
    perspective.aspect = aspect;
    const perspectiveDepth = scene.center.clone().sub(perspective.position).dot(back.clone().negate());
    perspective.near = Math.max(distance * 0.002, perspectiveDepth - radius * 1.5, 0.001);
    perspective.far = Math.max(perspective.near * 10, perspectiveDepth + radius * 1.5);
    perspective.updateProjectionMatrix();

    const orthoDistance = radius * 4 + target.distanceTo(scene.center) + height;
    ortho.position.copy(target).addScaledVector(back, orthoDistance);
    ortho.quaternion.copy(quaternion);
    ortho.left = (-height * aspect) / 2;
    ortho.right = (height * aspect) / 2;
    ortho.top = height / 2;
    ortho.bottom = -height / 2;
    const orthoDepth = scene.center.clone().sub(ortho.position).dot(back.clone().negate());
    ortho.near = Math.max(0.01, orthoDepth - radius * 1.5);
    ortho.far = orthoDepth + radius * 1.5;
    ortho.zoom = 1;
    ortho.updateProjectionMatrix();
  }

  rotate(dxPixels: number, dyPixels: number, pivot: Vector3): void {
    this.animation = null;
    const yaw = new Quaternion().setFromAxisAngle(this.up(), -dxPixels * ROTATE_RADIANS_PER_PIXEL);
    const pitch = new Quaternion().setFromAxisAngle(this.right(), -dyPixels * ROTATE_RADIANS_PER_PIXEL);
    const rotation = yaw.multiply(pitch);
    this.state.quaternion.premultiply(rotation).normalize();
    this.state.target.sub(pivot).applyQuaternion(rotation).add(pivot);
  }

  pan(dxPixels: number, dyPixels: number, viewportHeightPixels: number): void {
    this.animation = null;
    const scale = this.state.height / Math.max(1, viewportHeightPixels);
    this.state.target.addScaledVector(this.right(), -dxPixels * scale).addScaledVector(this.up(), dyPixels * scale);
  }

  /** Zooms by `factor` (>1 zooms out) keeping the point under the cursor fixed (ndc in -1..1). */
  zoomAt(factor: number, ndcX: number, ndcY: number, aspect: number): void {
    this.animation = null;
    const { height, target } = this.state;
    const nextHeight = MathUtils.clamp(height * factor, MIN_HEIGHT, MAX_HEIGHT);
    const ratio = nextHeight / height;
    const cursor = target
      .clone()
      .addScaledVector(this.right(), (ndcX * height * aspect) / 2)
      .addScaledVector(this.up(), (ndcY * height) / 2);
    target.sub(cursor).multiplyScalar(ratio).add(cursor);
    this.state.height = nextHeight;
  }

  /** View state that shows the whole sphere, optionally from a new direction. */
  fitState(bounds: Sphere, aspect: number, quaternion: Quaternion = this.state.quaternion): ViewState {
    const radius = Math.max(bounds.radius, 1);
    const height = (2 * radius * FIT_MARGIN) / Math.min(1, aspect);
    return { target: bounds.center.clone(), quaternion: quaternion.clone(), height };
  }

  animateTo(to: ViewState, duration = 320): void {
    if (this.reducedMotion || duration <= 0) {
      this.state.target.copy(to.target);
      this.state.quaternion.copy(to.quaternion);
      this.state.height = to.height;
      this.animation = null;
      return;
    }
    this.animation = { from: cloneState(this.state), to: cloneState(to), start: performance.now(), duration };
  }

  /** Advances an animation; returns true while it is still running. */
  update(now: number): boolean {
    const animation = this.animation;
    if (!animation) return false;
    const t = Math.min(1, (now - animation.start) / animation.duration);
    const k = easeInOut(t);
    this.state.target.lerpVectors(animation.from.target, animation.to.target, k);
    this.state.quaternion.slerpQuaternions(animation.from.quaternion, animation.to.quaternion, k);
    // Interpolate the zoom logarithmically so it feels uniform.
    this.state.height = Math.exp(MathUtils.lerp(Math.log(animation.from.height), Math.log(animation.to.height), k));
    if (t >= 1) this.animation = null;
    return this.animation !== null;
  }
}
