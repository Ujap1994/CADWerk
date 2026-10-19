import { useTranslation } from 'react-i18next';
import type { Language } from '../../../shared/i18n.ts';
import type { MeshPayload } from '../../../kernel/protocol.ts';
import { STANDARD_PLANES } from '../../../shared/model/sketch.ts';
import { formatQuantity } from '../format.ts';
import { useAppState, type Pick } from '../state/store.ts';

/** "Face 3 · Cylinder Ø 40 mm · 3,769.9 mm²" from the exact B-Rep data. */
function describePick(pick: Pick, mesh: MeshPayload | null, t: (key: string, options?: Record<string, unknown>) => string, language: Language): string {
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
      <div className="status-item" data-testid="pick-info">
        {hover
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
