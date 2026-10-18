import type { Vec3 } from '../shared/model/feature.ts';
import { Arena, type OC, type TopoDS_Shape } from './occt.ts';
import type { MassProperties } from './protocol.ts';

export function boundingBox(oc: OC, shape: TopoDS_Shape): { min: Vec3; max: Vec3 } {
  using arena = new Arena();
  const box = arena.track(new oc.Bnd_Box());
  oc.BRepBndLib.Add(shape, box, false);
  if (box.IsVoid()) return { min: [0, 0, 0], max: [0, 0, 0] };
  const min = arena.track(box.CornerMin());
  const max = arena.track(box.CornerMax());
  return { min: [min.X(), min.Y(), min.Z()], max: [max.X(), max.Y(), max.Z()] };
}

export function diagonalOf(bbox: { min: Vec3; max: Vec3 }): number {
  return Math.hypot(bbox.max[0] - bbox.min[0], bbox.max[1] - bbox.min[1], bbox.max[2] - bbox.min[2]);
}

/** Exact volume, surface area and center of volume from the B-Rep (not from the mesh). */
export function massProperties(oc: OC, shape: TopoDS_Shape): MassProperties {
  using arena = new Arena();
  const volumeProps = arena.track(new oc.GProp_GProps());
  oc.BRepGProp.VolumeProperties(shape, volumeProps, false, false, false);
  const center = arena.track(volumeProps.CentreOfMass());
  const surfaceProps = arena.track(new oc.GProp_GProps());
  oc.BRepGProp.SurfaceProperties(shape, surfaceProps, false, false);
  const bbox = boundingBox(oc, shape);
  return {
    volume: volumeProps.Mass(),
    area: surfaceProps.Mass(),
    center: [center.X(), center.Y(), center.Z()],
    bboxMin: bbox.min,
    bboxMax: bbox.max,
  };
}
