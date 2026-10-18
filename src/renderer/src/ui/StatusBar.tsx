import { useTranslation } from 'react-i18next';
import { formatQuantity } from '../format.ts';
import { useAppState } from '../state/store.ts';

export function StatusBar() {
  const { t } = useTranslation();
  const kernelStatus = useAppState((state) => state.kernelStatus);
  const rebuild = useAppState((state) => state.rebuild);
  const hover = useAppState((state) => state.hover);
  const selectionCount = useAppState((state) => state.selection.length);
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
      <div className="status-item">
        {hover ? t(hover.kind === 'face' ? 'status.face' : 'status.edge', { index: hover.index + 1 }) : null}
        {!hover && selectionCount > 0 ? t('status.selected', { count: selectionCount }) : null}
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
