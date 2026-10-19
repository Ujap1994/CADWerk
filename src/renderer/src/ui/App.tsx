import { useEffect } from 'react';
import * as commands from '../commands.ts';
import { useAppState } from '../state/store.ts';
import { CommandBar } from './CommandBar.tsx';
import { AboutDialog, SettingsDialog, Toasts } from './Dialogs.tsx';
import { FeatureTree } from './FeatureTree.tsx';
import { PropertyPanel } from './PropertyPanel.tsx';
import { SketchPanel } from './SketchPanel.tsx';
import { StatusBar } from './StatusBar.tsx';
import { Viewport } from './Viewport.tsx';

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

function Sidebar() {
  const editing = useAppState((state) => state.activeEdit !== null);
  const sketching = useAppState((state) => state.sketch !== null || state.choosingSketchPlane);
  if (sketching) {
    return (
      <>
        <SketchPanel />
        <FeatureTree />
      </>
    );
  }
  return editing ? <PropertyPanel /> : <FeatureTree />;
}

export function App() {

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.querySelector('dialog[open]')) return;
      switch (event.key) {
        case 'f':
        case 'F':
          commands.zoomToFit();
          break;
        case 'Escape':
          commands.escape();
          break;
        case 'Enter':
          commands.commitEdit();
          break;
        case 'Delete':
        case 'Backspace':
          commands.deleteSketchSelection();
          break;
        default:
          return;
      }
      event.preventDefault();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <div className="app">
      <CommandBar />
      <div className="workspace">
        <aside className="sidebar">
          <Sidebar />
        </aside>
        <main className="main-area">
          <Viewport />
        </main>
      </div>
      <StatusBar />
      <SettingsDialog />
      <AboutDialog />
      <Toasts />
    </div>
  );
}
