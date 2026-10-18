import { Arena, type OC, type TopoDS_Shape } from './occt.ts';

let fileCounter = 0;

function tempPath(extension: string): string {
  fileCounter += 1;
  return `/tmp-${Date.now()}-${fileCounter}.${extension}`;
}

/** Exports a shape as STEP (AP214, millimeters). */
export function exportStep(oc: OC, shape: TopoDS_Shape): Uint8Array {
  using arena = new Arena();
  const path = tempPath('step');
  const writer = arena.track(new oc.STEPControl_Writer());
  const progress = arena.track(new oc.Message_ProgressRange());
  const transfer = writer.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, progress);
  if (transfer !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP transfer failed');
  const status = writer.Write(path);
  if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP write failed');
  try {
    return oc.FS.readFile(path);
  } finally {
    oc.FS.unlink(path);
  }
}

/** Imports all shapes of a STEP file as one compound. The caller owns the returned shape. */
export function importStep(oc: OC, bytes: Uint8Array): TopoDS_Shape {
  using arena = new Arena();
  const path = tempPath('step');
  oc.FS.writeFile(path, bytes);
  try {
    const reader = arena.track(new oc.STEPControl_Reader());
    const status = reader.ReadFile(path);
    if (status !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP file could not be read');
    const progress = arena.track(new oc.Message_ProgressRange());
    if (reader.TransferRoots(progress) === 0) throw new Error('STEP file contains no shapes');
    return reader.OneShape();
  } finally {
    oc.FS.unlink(path);
  }
}
