import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { REPOSITORY_URL } from '../../../shared/app-info.ts';
import type { LanguageSetting, NavigationPreset, Projection, ThemeSetting } from '../../../shared/settings.ts';
import * as commands from '../commands.ts';
import { dismissToast, useAppState } from '../state/store.ts';
import { CloseIcon } from './icons.tsx';

function Modal({ open, title, onClose, children, testId }: { open: boolean; title: string; onClose(): void; children: ReactNode; testId: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog ref={ref} className="modal" aria-label={title} data-testid={testId} onClose={onClose} onCancel={onClose}>
      <header className="modal-header">
        <h2>{title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={onClose}>
          <CloseIcon />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}

function Choice<T extends string>({ label, value, options, onChange, name }: { label: string; value: T; options: { value: T; label: string }[]; onChange(value: T): void; name: string }) {
  return (
    <div className="setting">
      <span className="setting-label">{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            name={name}
            data-value={option.value}
            aria-checked={value === option.value}
            className={`segmented-option${value === option.value ? ' is-selected' : ''}`}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.dialogs.settings);
  const settings = useAppState((state) => state.settings);
  return (
    <Modal open={open} title={t('settings.title')} onClose={() => commands.closeDialog('settings')} testId="settings-dialog">
      <Choice<LanguageSetting>
        name="language"
        label={t('settings.language')}
        value={settings.language}
        options={[
          { value: 'system', label: t('settings.languageSystem') },
          { value: 'en', label: 'English' },
          { value: 'de', label: 'Deutsch' },
        ]}
        onChange={(language) => void commands.updateSettings({ language })}
      />
      <Choice<ThemeSetting>
        name="theme"
        label={t('settings.theme')}
        value={settings.theme}
        options={[
          { value: 'system', label: t('settings.themeSystem') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
        onChange={(theme) => void commands.updateSettings({ theme })}
      />
      <Choice<NavigationPreset>
        name="navigation"
        label={t('settings.navigation')}
        value={settings.navigation}
        options={[
          { value: 'mouse', label: t('settings.navigationMouse') },
          { value: 'trackpad', label: t('settings.navigationTrackpad') },
        ]}
        onChange={(navigation) => void commands.updateSettings({ navigation })}
      />
      <p className="setting-help">{settings.navigation === 'mouse' ? t('settings.navigationMouseHelp') : t('settings.navigationTrackpadHelp')}</p>
      <Choice<Projection>
        name="projection"
        label={t('settings.projection')}
        value={settings.projection}
        options={[
          { value: 'orthographic', label: t('settings.projectionOrthographic') },
          { value: 'perspective', label: t('settings.projectionPerspective') },
        ]}
        onChange={(projection) => void commands.updateSettings({ projection })}
      />
      <label className="setting checkbox-setting">
        <input type="checkbox" checked={settings.showFrameStats} onChange={(event) => void commands.updateSettings({ showFrameStats: event.target.checked })} />
        <span>{t('settings.frameStats')}</span>
      </label>
    </Modal>
  );
}

export function AboutDialog() {
  const { t } = useTranslation();
  const open = useAppState((state) => state.dialogs.about);
  const info = useAppState((state) => state.appInfo);
  return (
    <Modal open={open} title={t('about.title')} onClose={() => commands.closeDialog('about')} testId="about-dialog">
      <div className="about">
        <img src="./favicon.svg" alt="" width={72} height={72} />
        <div>
          <p className="about-name">ParaWerk</p>
          <p className="about-version">{t('about.version', { version: info?.version ?? '' })}</p>
          <p className="about-tech">
            Electron {info?.electron} · Chromium {info?.chrome} · {info?.platform} {info?.arch}
          </p>
        </div>
      </div>
      <p className="about-warning">{t('about.disclaimer')}</p>
      <p>{t('about.license')}</p>
      <p>{t('about.thirdParty')}</p>
      <button type="button" className="text-button" onClick={() => void window.parawerk.openExternal(REPOSITORY_URL)}>
        {t('about.website')}
      </button>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useAppState((state) => state.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast is-${toast.kind}`} data-testid={`toast-${toast.kind}`}>
          <span>{toast.message}</span>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => dismissToast(toast.id)}>
            <CloseIcon />
          </button>
        </div>
      ))}
    </div>
  );
}
