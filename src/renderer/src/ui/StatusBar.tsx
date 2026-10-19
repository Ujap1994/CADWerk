import { useTranslation } from 'react-i18next';
import type { Language } from '../../../shared/i18n.ts';
import type { MeshPayload } from '../../../kernel/protocol.ts';
import { ORIGIN_ID, STANDARD_PLANES, type SketchData } from '../../../shared/model/sketch.ts';
import { formatNumber, formatQuantity } from '../format.ts';
import { arcGeometry, ellipseOf, pointPositions } from '../sketch/geometry.ts';
import { relationKindOf } from '../sketch/relations.ts';
import { useAppState, type Pick } from '../state/store.ts';

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** "Line · 42.5 mm", "Circle · Ø 20 mm", ... for the sketch entity under the cursor. */
function describeSketchEntity(sketch: SketchData, id: string, t: Translate, language: Language): string | null {
  if (id === ORIGIN_ID) return t('features.origin');
  const entity = sketch.entities.find((candidate) => candidate.id === id);
  if (!entity) {
    const constraint = sketch.constraints.find((candidate) => candidate.id === id);
    const kind = constraint ? relationKindOf(constraint) : null;
    return kind ? t('status.sketchRelation', { name: t(`sketch.relationNames.${kind}`) }) : null;
  }
  const positions = pointPositions(sketch);
  const mm = (value: number) => formatQuantity(value, language, 'mm', 3);
  let text: string | null = null;
  if (entity.type === 'point') {
    text = t('status.sketchPoint', { x: formatNumber(entity.x, language), y: formatNumber(entity.y, language) });
  } else if (entity.type === 'line') {
    const [a, b] = [positions.get(entity.p1), positions.get(entity.p2)];
    if (a && b) text = t('status.sketchLine', { length: mm(Math.hypot(b[0] - a[0], b[1] - a[1])) });
  } else if (entity.type === 'circle') {
    text = t('status.sketchCircle', { diameter: mm(entity.radius * 2) });
  } else if (entity.type === 'ellipse') {
    const ellipse = ellipseOf(entity, positions);
    if (ellipse) text = t('status.sketchEllipse', { major: mm(2 * ellipse.a), minor: mm(2 * ellipse.b) });
  } else {
    const [center, start, end] = [positions.get(entity.center), positions.get(entity.start), positions.get(entity.end)];
    if (center && start && end) {
      const arc = arcGeometry(center, start, end);
      text = t('status.sketchArc', { radius: mm(arc.radius), angle: formatNumber((arc.sweep * 180) / Math.PI, language, 1) });
    }
  }
  return text && entity.construction ? `${text} · ${t('status.construction')}` : text;
}

/** "Face 3 · Cylinder Ø 40 mm · 3,769.9 mm²" from the exact B-Rep data. */
function describePick(pick: Pick, mesh: MeshPayload | null, t: Translate, language: Language): string {
  if (pick.kind === 'plane') return t(`planes.${STANDARD_PLANES[pick.index] ?? 'front'}`);
  const label = t(pick.kind === 'face' ? 'status.face' : 'status.edge', { index: pick.index + 1 });
  const info = pick.kind === 'face' ? mesh?.faceInfo[pick.index] : mesh?.edgeInfo[pick.index];
  if (!info) return label;
  const kind = pick.kind === 'face' ? t(`geometry.surfaces.${info.kind}`) : t(`geometry.curves.${info.kind}`);
  const diameter = info.radius !== undefined ? ` Ø ${formatQuantity(info.radius * 2, language, 'mm', 3)}` : '';
  const size = 'area' in info ? formatQuantity(info.area, language, 'mm²', 1) : formatQuantity(info.length, language, 'mm', 3);
  return `${label} · ${kind}${diameter} · ${size}`;
}

export function StatusBar() {
  const { t } = useTranslation();
  const kernelStatus = useAppState((state) => state.kernelStatus);
  const rebuild = useAppState((state) => state.rebuild);
  const hover = useAppState((state) => state.hover);
  const selection = useAppState((state) => state.selection);
  const body = useAppState((state) => state.display.body);
  const frameStats = useAppState((state) => state.frameStats);
  const showFrameStats = useAppState((state) => state.settings.showFrameStats);
  const language = useAppState((state) => state.language);
  const sketch = useAppState((state) => state.sketch?.draft.sketch);
  const sketchHover = useAppState((state) => state.sketchHover);
  const sketchSelection = useAppState((state) => state.sketchSelection);
  const sketchStatus = useAppState((state) => (state.sketch && state.sketch.draft.sketch.entities.length > 0 ? state.sketchAnalysis?.status : undefined));

  const statusText =
    kernelStatus === 'loading'
      ? t('status.kernelLoading')
      : kernelStatus === 'busy'
        ? t('status.rebuilding')
        : kernelStatus === 'error'
          ? t('status.kernelError')
          : rebuild && rebuild.rebuiltFeatures > 0
            ? t('status.rebuiltIn', { ms: Math.round(rebuild.totalMs) })
            : t('status.kernelReady');

  const properties = rebuild?.properties;

  return (
    <footer className="status-bar">
      <div className={`status-item kernel-status is-${kernelStatus}`} data-testid="kernel-status" data-status={kernelStatus}>
        <span className="status-dot" aria-hidden="true" />
        {statusText}
      </div>
      {sketchStatus ? (
        <div className={`status-item sketch-status is-${sketchStatus}`} data-testid="status-sketch">
          <span className="sketch-status-dot" aria-hidden="true" />
          {t(`sketch.status.${sketchStatus}`)}
        </div>
      ) : null}
      <div className="status-item" data-testid="pick-info">
        {sketch
          ? sketchHover
            ? describeSketchEntity(sketch, sketchHover, t, language)
            : sketchSelection.length === 1 && sketchSelection[0]
              ? describeSketchEntity(sketch, sketchSelection[0], t, language)
              : sketchSelection.length > 1
                ? t('status.selected', { count: sketchSelection.length })
                : null
          : hover
          ? describePick(hover, body, t, language)
          : selection.length === 1 && selection[0]
            ? describePick(selection[0], body, t, language)
            : selection.length > 1
              ? t('status.selected', { count: selection.length })
              : null}
      </div>
      <div className="status-spacer" />
      {properties ? (
        <>
          <div className="status-item" data-testid="volume">
            {t('status.volume')}: {formatQuantity(properties.volume, language, 'mm³', 1)}
          </div>
          <div className="status-item">
            {t('status.area')}: {formatQuantity(properties.area, language, 'mm²', 1)}
          </div>
        </>
      ) : null}
      {showFrameStats && frameStats ? (
        <div className="status-item" data-testid="frame-stats">
          {t('status.frameStats', { fps: frameStats.fps, ms: frameStats.frameMs })}
        </div>
      ) : null}
      <div className="status-item units">{t('status.units')}</div>
    </footer>
  );
}
