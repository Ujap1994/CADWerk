import { app, Menu, shell, type MenuItemConstructorOptions } from 'electron';
import { REPOSITORY_URL } from '../shared/app-info.ts';
import { translate, type Language } from '../shared/i18n.ts';
import type { MenuCommand } from '../shared/ipc.ts';
import type { Settings } from '../shared/settings.ts';

export interface MenuContext {
  language: Language;
  settings: Settings;
  developerTools: boolean;
  send(command: MenuCommand): void;
}

export function buildMenu({ language, settings, developerTools, send }: MenuContext): Menu {
  const t = (key: string) => translate(language, `menu.${key}`);
  const command = (label: string, id: MenuCommand, accelerator?: string, extra: Partial<MenuItemConstructorOptions> = {}) =>
    ({ label, click: () => send(id), ...(accelerator ? { accelerator } : {}), ...extra }) satisfies MenuItemConstructorOptions;
  const isMac = process.platform === 'darwin';

  const template: MenuItemConstructorOptions[] = [];

  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        command(t('about'), 'app.about'),
        { type: 'separator' },
        command(t('settings'), 'app.settings', 'Cmd+,'),
        { type: 'separator' },
        { role: 'services', label: t('services') },
        { type: 'separator' },
        { role: 'hide', label: t('hide') },
        { role: 'hideOthers', label: t('hideOthers') },
        { role: 'unhide', label: t('unhide') },
        { type: 'separator' },
        { role: 'quit', label: t('quit') },
      ],
    });
  }

  template.push({
    label: t('file'),
    submenu: [
      command(t('new'), 'file.new', 'CmdOrCtrl+N'),
      command(t('open'), 'file.open', 'CmdOrCtrl+O'),
      { type: 'separator' },
      command(t('save'), 'file.save', 'CmdOrCtrl+S'),
      command(t('saveAs'), 'file.saveAs', 'Shift+CmdOrCtrl+S'),
      { type: 'separator' },
      {
        label: t('export'),
        submenu: [command(t('exportStep'), 'file.exportStep'), command(t('exportStl'), 'file.exportStl')],
      },
      ...(isMac
        ? []
        : ([
            { type: 'separator' },
            command(t('settings'), 'app.settings', 'Ctrl+,'),
            { type: 'separator' },
            { role: 'quit', label: t('quit') },
          ] satisfies MenuItemConstructorOptions[])),
    ],
  });

  template.push({
    label: t('edit'),
    submenu: [
      command(t('undo'), 'edit.undo', 'CmdOrCtrl+Z'),
      command(t('redo'), 'edit.redo', isMac ? 'Shift+Cmd+Z' : 'Ctrl+Y'),
      { type: 'separator' },
      { role: 'cut', label: t('cut') },
      { role: 'copy', label: t('copy') },
      { role: 'paste', label: t('paste') },
      { role: 'selectAll', label: t('selectAll') },
    ],
  });

  template.push({
    label: t('view'),
    submenu: [
      // Single-key shortcuts are handled in the renderer so they never interfere with typing.
      command(t('zoomToFit'), 'view.zoomToFit', 'F', { registerAccelerator: false }),
      {
        label: t('standardViews'),
        submenu: [
          command(t('front'), 'view.front', 'CmdOrCtrl+1'),
          command(t('back'), 'view.back', 'CmdOrCtrl+2'),
          command(t('left'), 'view.left', 'CmdOrCtrl+3'),
          command(t('right'), 'view.right', 'CmdOrCtrl+4'),
          command(t('top'), 'view.top', 'CmdOrCtrl+5'),
          command(t('bottom'), 'view.bottom', 'CmdOrCtrl+6'),
          command(t('isometric'), 'view.isometric', 'CmdOrCtrl+7'),
        ],
      },
      command(t('toggleProjection'), 'view.toggleProjection', undefined, {
        type: 'checkbox',
        checked: settings.projection === 'perspective',
      }),
      command(t('toggleFrameStats'), 'view.toggleFrameStats', undefined, {
        type: 'checkbox',
        checked: settings.showFrameStats,
      }),
      { type: 'separator' },
      { role: 'togglefullscreen', label: t('toggleFullScreen') },
      ...(developerTools
        ? ([
            { type: 'separator' },
            { role: 'reload', label: t('reload') },
            { role: 'toggleDevTools', label: t('toggleDevTools') },
          ] satisfies MenuItemConstructorOptions[])
        : []),
    ],
  });

  if (isMac) {
    template.push({
      label: t('window'),
      submenu: [
        { role: 'minimize', label: t('minimize') },
        { role: 'zoom', label: t('zoom') },
      ],
    });
  }

  template.push({
    label: t('help'),
    submenu: [
      { label: t('website'), click: () => void shell.openExternal(REPOSITORY_URL) },
      ...(isMac ? [] : ([{ type: 'separator' }, command(t('about'), 'app.about')] satisfies MenuItemConstructorOptions[])),
    ],
  });

  return Menu.buildFromTemplate(template);
}
