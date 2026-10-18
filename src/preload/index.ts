import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IpcChannel, type MenuCommand, type ParaWerkApi } from '../shared/ipc.ts';

/**
 * The only bridge between the sandboxed renderer and the main process.
 * Every function maps to one validated IPC handler; no Node APIs are exposed.
 */
const api: ParaWerkApi = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.getAppInfo),
  getSettings: () => ipcRenderer.invoke(IpcChannel.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(IpcChannel.setSettings, patch),
  saveFile: (request) => ipcRenderer.invoke(IpcChannel.saveFile, request),
  openFile: (request) => ipcRenderer.invoke(IpcChannel.openFile, request),
  confirm: (request) => ipcRenderer.invoke(IpcChannel.confirm, request),
  setDocumentState: (state) => ipcRenderer.send(IpcChannel.setDocumentState, state),
  openExternal: (url) => ipcRenderer.invoke(IpcChannel.openExternal, url),
  onMenuCommand(listener) {
    const handler = (_event: IpcRendererEvent, command: MenuCommand) => listener(command);
    ipcRenderer.on(IpcChannel.menuCommand, handler);
    return () => ipcRenderer.removeListener(IpcChannel.menuCommand, handler);
  },
  onOpenPath(listener) {
    const handler = (_event: IpcRendererEvent, file: { path: string; data: Uint8Array }) => listener(file);
    ipcRenderer.on(IpcChannel.openPath, handler);
    return () => ipcRenderer.removeListener(IpcChannel.openPath, handler);
  },
  rendererReady: () => ipcRenderer.send(IpcChannel.rendererReady),
};

contextBridge.exposeInMainWorld('parawerk', api);
