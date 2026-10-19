import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_NAME } from '../../shared/app-info.ts';
import { resolveLanguage } from '../../shared/i18n.ts';
import * as commands from './commands.ts';
import { initI18n, t } from './i18n.ts';
import { startKernel } from './state/rebuild.ts';
import { startSketchStatus } from './state/sketch-status.ts';
import { getState, setState, store } from './state/store.ts';
import { runSelfTest } from './self-test.ts';
import { installTestHooks } from './test-hooks.ts';
import { App } from './ui/App.tsx';
import './styles.css';

async function bootstrap(): Promise<void> {
  const api = window.parawerk;
  const [appInfo, settings] = await Promise.all([api.getAppInfo(), api.getSettings()]);
  const language = resolveLanguage(settings.language, appInfo.systemLocale);
  await initI18n(language);
  setState({ appInfo, settings, language });

  // Theme: explicit setting or follow the OS.
  const darkQuery = matchMedia('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const theme = getState().settings.theme;
    const effective = theme === 'system' ? (darkQuery.matches ? 'dark' : 'light') : theme;
    document.documentElement.dataset.theme = effective;
    if (getState().effectiveTheme !== effective) setState({ effectiveTheme: effective });
  };
  darkQuery.addEventListener('change', applyTheme);
  applyTheme();

  // Window title and unsaved-changes state.
  const syncDocumentState = () => {
    const state = getState();
    const name = state.fileName ?? t('app.untitled');
    document.title = `${name}${state.dirty ? ' •' : ''} – ${APP_NAME}`;
    api.setDocumentState({ title: name, dirty: state.dirty });
  };
  store.subscribe((state, previous) => {
    if (state.settings.theme !== previous.settings.theme) applyTheme();
    if (state.fileName !== previous.fileName || state.dirty !== previous.dirty || state.language !== previous.language) {
      syncDocumentState();
    }
  });
  syncDocumentState();

  api.onMenuCommand(commands.runMenuCommand);
  api.onOpenPath((file) => void commands.openFromSystem(file.path, file.data));

  startKernel();
  startSketchStatus();
  if (appInfo.testMode) installTestHooks();

  const root = document.getElementById('root');
  if (!root) throw new Error('root element missing');
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  api.rendererReady();
  if (appInfo.selfTest) api.reportSelfTest(await runSelfTest());
}

void bootstrap();
