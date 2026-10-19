/**
 * Document model of a part: an ordered list of features.
 *
 * All lengths are millimeters. The coordinate system is right-handed with Z up
 * (see docs/adr/0004-coordinate-system-and-units.md).
 */

import type { SketchData, SketchPlaneRef } from './sketch.ts';

export type Vec3 = [number, number, number];

export type FeatureType = 'sketch' | 'box' | 'cylinder' | 'fillet' | 'chamfer';

/** How a solid-creating feature combines with the existing body. */
export type BooleanOperation = 'add' | 'cut';

export type Axis = 'x' | 'y' | 'z';

/**
 * Reference to an edge of the body that a feature modifies.
 *
 * Phase 0 references edges by their topological index in the input body.
 * This is deliberately simple and will be replaced by persistent names
 * (docs/adr/0002-persistent-naming.md) before parametric editing grows.
 */
export interface EdgeIndexRef {
  kind: 'edge-index';
  index: number;
}

export type EdgeRef = EdgeIndexRef;

interface FeatureBase {
  id: string;
  /** User-defined name; when absent the UI shows a localized default name. */
  name?: string;
  suppressed?: boolean;
}

export interface BoxFeature extends FeatureBase {
  type: 'box';
  operation: BooleanOperation;
  width: number;
  depth: number;
  height: number;
  /** Center of the bottom face. */
  position: Vec3;
}

export interface CylinderFeature extends FeatureBase {
  type: 'cylinder';
  operation: BooleanOperation;
  radius: number;
  height: number;
  axis: Axis;
  /** Center of the base circle. */
  position: Vec3;
}

export interface FilletFeature extends FeatureBase {
  type: 'fillet';
  radius: number;
  edges: EdgeRef[];
}

export interface ChamferFeature extends FeatureBase {
  type: 'chamfer';
  distance: number;
  edges: EdgeRef[];
}

/** A 2D sketch on a plane; it does not change the body by itself (extrudes use it later). */
export interface SketchFeature extends FeatureBase {
  type: 'sketch';
  plane: SketchPlaneRef;
  sketch: SketchData;
}

export type Feature = SketchFeature | BoxFeature | CylinderFeature | FilletFeature | ChamferFeature;

/** Features that build or modify the solid body (everything except sketches). */
export type SolidModelingFeature = Exclude<Feature, SketchFeature>;

export type EdgeFeature = FilletFeature | ChamferFeature;

export function isEdgeFeature(feature: Feature): feature is EdgeFeature {
  return feature.type === 'fillet' || feature.type === 'chamfer';
}

export function isSolidFeature(feature: Feature): feature is BoxFeature | CylinderFeature {
  return feature.type === 'box' || feature.type === 'cylinder';
}

export const FEATURE_TYPES: readonly FeatureType[] = ['sketch', 'box', 'cylinder', 'fillet', 'chamfer'];

let idCounter = 0;

/** Creates a document-unique feature id. */
export function createFeatureId(): string {
  idCounter += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `f${Date.now().toString(36)}${idCounter.toString(36)}${random}`;
}

export function defaultFeature(type: FeatureType, id: string = createFeatureId()): Feature {
  switch (type) {
    case 'sketch':
      return { id, type, plane: { kind: 'standard', plane: 'top' }, sketch: { entities: [], constraints: [] } };
    case 'box':
      return { id, type, operation: 'add', width: 100, depth: 60, height: 40, position: [0, 0, 0] };
    case 'cylinder':
      return { id, type, operation: 'add', radius: 20, height: 50, axis: 'z', position: [0, 0, 0] };
    case 'fillet':
      return { id, type, radius: 5, edges: [] };
    case 'chamfer':
      return { id, type, distance: 3, edges: [] };
  }
}
