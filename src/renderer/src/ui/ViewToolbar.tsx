import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as commands from '../commands.ts';
import { useAppState } from '../state/store.ts';
import { STANDARD_VIEWS } from '../viewport/views.ts';
import { ProjectionIcon, ViewsIcon, ZoomFitIcon } from './icons.tsx';

const SHORTCUTS: Record<string, string> = {
  front: '1',
  back: '2',
  left: '3',
  right: '4',
  top: '5',
  bottom: '6',
  isometric: '7',
};

export function ViewToolbar() {
  const { t } = useTranslation();
  const projection = useAppState((state) => state.settings.projection);
  const platform = useAppState((state) => state.appInfo?.platform);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const modifier = platform === 'darwin' ? '⌘' : 'Ctrl+';

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);

  return (
    <div className="view-toolbar" role="toolbar" aria-label={t('viewbar.views')}>
      <button type="button" className="icon-button" title={t('viewbar.zoomToFit')} aria-label={t('viewbar.zoomToFit')} data-testid="zoom-to-fit" onClick={commands.zoomToFit}>
        <ZoomFitIcon />
      </button>
      <div className="popover-anchor" ref={menuRef}>
        <button
          type="button"
          className={`icon-button${open ? ' is-active' : ''}`}
          title={t('viewbar.views')}
          aria-label={t('viewbar.views')}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <ViewsIcon />
        </button>
        {open ? (
          <div className="popover-menu" role="menu">
            {STANDARD_VIEWS.map((view) => (
              <button
                key={view}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  commands.setView(view);
                  setOpen(false);
                }}
              >
                <span>{t(`menu.${view}`)}</span>
                <kbd>{`${modifier}${SHORTCUTS[view]}`}</kbd>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className={`icon-button${projection === 'perspective' ? ' is-active' : ''}`}
        title={t('viewbar.projection')}
        aria-label={t('viewbar.projection')}
        aria-pressed={projection === 'perspective'}
        onClick={() => commands.runMenuCommand('view.toggleProjection')}
      >
        <ProjectionIcon />
      </button>
    </div>
  );
}
