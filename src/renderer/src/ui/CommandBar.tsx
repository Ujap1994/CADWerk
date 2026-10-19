import { useEffect, useRef, useState, type ComponentType, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import type { FeatureType } from '../../../shared/model/feature.ts';
import * as commands from '../commands.ts';
import type { SketchToolName } from '../sketch/tools.ts';
import { useAppState, type CommandTab } from '../state/store.ts';
import {
  BoxIcon,
  CenterArcIcon,
  CenterlineIcon,
  CenterRectangleIcon,
  ChamferIcon,
  ChevronDownIcon,
  CircleIcon,
  ConstructionIcon,
  CornerRectangleIcon,
  CylinderIcon,
  DimensionIcon,
  ExitSketchIcon,
  ExportStepIcon,
  ExportStlIcon,
  FilletIcon,
  InfoIcon,
  NewIcon,
  OpenIcon,
  RedoIcon,
  SaveIcon,
  LineIcon,
  PointIcon,
  SettingsIcon,
  SketchIcon,
  ThreePointArcIcon,
  TrashIcon,
  UndoIcon,
} from './icons.tsx';

type IconType = ComponentType<SVGProps<SVGSVGElement>>;

const TOOL_ICONS: Record<SketchToolName, IconType> = {
  line: LineIcon,
  centerline: CenterlineIcon,
  cornerRectangle: CornerRectangleIcon,
  centerRectangle: CenterRectangleIcon,
  circle: CircleIcon,
  centerArc: CenterArcIcon,
  threePointArc: ThreePointArcIcon,
  point: PointIcon,
  dimension: DimensionIcon,
};

interface CommandButtonProps {
  id: string;
  icon: IconType;
  label: string;
  tooltip: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
}

function CommandButton({ id, icon: Icon, label, tooltip, onClick, active = false, disabled = false }: CommandButtonProps) {
  return (
    <button
      type="button"
      className={`command-button${active ? ' is-active' : ''}`}
      data-command={id}
      title={tooltip}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon className="command-icon" />
      <span className="command-label">{label}</span>
    </button>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="command-group" role="group" aria-label={label}>
      <div className="command-group-buttons">{children}</div>
      <div className="command-group-label">{label}</div>
    </div>
  );
}

const FEATURE_BUTTONS: { type: FeatureType; icon: IconType }[] = [
  { type: 'sketch', icon: SketchIcon },
  { type: 'box', icon: BoxIcon },
  { type: 'cylinder', icon: CylinderIcon },
  { type: 'fillet', icon: FilletIcon },
  { type: 'chamfer', icon: ChamferIcon },
];

const TABS: CommandTab[] = ['features', 'sketch'];

function FeaturesTab() {
  const { t } = useTranslation();
  const activeType = useAppState((state) =>
    state.sketch || state.choosingSketchPlane ? 'sketch' : state.activeEdit?.mode === 'create' ? state.activeEdit.draft.type : null,
  );
  const sketching = useAppState((state) => state.sketch !== null || state.choosingSketchPlane);
  const hasFeatures = useAppState((state) => state.history.features.length > 0);
  return (
    <Group label={t('commands.groups.features')}>
      {FEATURE_BUTTONS.map(({ type, icon }) => (
        <CommandButton
          key={type}
          id={type}
          icon={icon}
          label={t(`commands.${type}`)}
          tooltip={t(`commands.tooltips.${type}`)}
          active={activeType === type}
          disabled={(sketching && type !== 'sketch') || ((type === 'fillet' || type === 'chamfer') && !hasFeatures)}
          onClick={() => commands.startFeature(type)}
        />
      ))}
    </Group>
  );
}

function ToolButton({ tool, disabled }: { tool: SketchToolName; disabled: boolean }) {
  const { t } = useTranslation();
  const active = useAppState((state) => state.sketchTool === tool);
  return (
    <CommandButton
      id={`tool-${tool}`}
      icon={TOOL_ICONS[tool]}
      label={t(`commands.sketchTools.${tool}`)}
      tooltip={t(`commands.sketchToolTips.${tool}`)}
      active={active}
      disabled={disabled}
      onClick={() => commands.setSketchTool(tool)}
    />
  );
}

/** A tool with variants: the button runs the last used variant, the arrow offers all of them. */
function SplitToolButton({ tools, current, disabled }: { tools: readonly SketchToolName[]; current: SketchToolName; disabled: boolean }) {
  const { t } = useTranslation();
  const activeTool = useAppState((state) => state.sketchTool);
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!anchor.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  return (
    <div className="split-command popover-anchor" ref={anchor}>
      <ToolButton tool={current} disabled={disabled} />
      <button
        type="button"
        className={`split-toggle${tools.includes(activeTool as SketchToolName) ? ' is-active' : ''}`}
        title={t('commands.sketchTools.variants')}
        aria-label={t('commands.sketchTools.variants')}
        aria-haspopup="menu"
        aria-expanded={open}
        data-variants={tools.join(' ')}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronDownIcon />
      </button>
      {open ? (
        <div className="popover-menu is-below" role="menu">
          {tools.map((tool) => {
            const Icon = TOOL_ICONS[tool];
            return (
              <button
                key={tool}
                type="button"
                role="menuitemradio"
                aria-checked={activeTool === tool}
                className="menu-item"
                data-tool={tool}
                onClick={() => {
                  commands.setSketchTool(activeTool === tool ? null : tool);
                  setOpen(false);
                }}
              >
                <span className="menu-item-label">
                  <Icon className="menu-item-icon" />
                  {t(`commands.sketchTools.${tool}`)}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function SketchTab() {
  const { t } = useTranslation();
  const inSketch = useAppState((state) => state.sketch !== null);
  const choosing = useAppState((state) => state.choosingSketchPlane);
  const variants = useAppState((state) => state.sketchToolVariants);
  const selection = useAppState((state) => state.sketchSelection.length);
  const off = !inSketch;
  return (
    <>
      <Group label={t('commands.groups.sketch')}>
        {inSketch ? (
          <CommandButton id="exit-sketch" icon={ExitSketchIcon} label={t('commands.exitSketch')} tooltip={t('commands.tooltips.exitSketch')} onClick={commands.exitSketch} />
        ) : (
          <CommandButton id="sketch-start" icon={SketchIcon} label={t('commands.sketch')} tooltip={t('commands.tooltips.sketch')} active={choosing} onClick={commands.startSketch} />
        )}
      </Group>
      <Group label={t('commands.groups.define')}>
        <ToolButton tool="dimension" disabled={off} />
      </Group>
      <Group label={t('commands.groups.draw')}>
        <ToolButton tool="line" disabled={off} />
        <ToolButton tool="centerline" disabled={off} />
        <SplitToolButton tools={['cornerRectangle', 'centerRectangle']} current={variants.rectangle} disabled={off} />
        <ToolButton tool="circle" disabled={off} />
        <SplitToolButton tools={['centerArc', 'threePointArc']} current={variants.arc} disabled={off} />
        <ToolButton tool="point" disabled={off} />
      </Group>
      <Group label={t('commands.groups.modify')}>
        <CommandButton
          id="construction"
          icon={ConstructionIcon}
          label={t('commands.sketchTools.construction')}
          tooltip={t('commands.sketchToolTips.construction')}
          disabled={off || selection === 0}
          onClick={commands.toggleConstruction}
        />
        <CommandButton
          id="delete-sketch"
          icon={TrashIcon}
          label={t('commands.sketchTools.delete')}
          tooltip={t('commands.sketchToolTips.delete')}
          disabled={off || selection === 0}
          onClick={commands.deleteSketchSelection}
        />
      </Group>
    </>
  );
}

export function CommandBar() {
  const { t } = useTranslation();
  const tab = useAppState((state) => state.commandTab);
  const canUndo = useAppState((state) => (state.sketch ? state.sketch.past.length > 0 : state.history.past.length > 0 || state.activeEdit !== null));
  const canRedo = useAppState((state) =>
    state.sketch ? state.sketch.future.length > 0 : state.history.future.length > 0 && state.activeEdit === null && !state.choosingSketchPlane,
  );
  const hasFeatures = useAppState((state) => state.history.features.length > 0);

  return (
    <header className="command-bar" role="toolbar" aria-label="ParaWerk">
      <div className="brand" aria-hidden="true">
        <img src="./favicon.svg" alt="" width={28} height={28} />
      </div>
      <Group label={t('commands.groups.file')}>
        <CommandButton id="new" icon={NewIcon} label={t('commands.new')} tooltip={t('commands.tooltips.new')} onClick={() => void commands.newDocument()} />
        <CommandButton id="open" icon={OpenIcon} label={t('commands.open')} tooltip={t('commands.tooltips.open')} onClick={() => void commands.openDocument()} />
        <CommandButton id="save" icon={SaveIcon} label={t('commands.save')} tooltip={t('commands.tooltips.save')} onClick={() => void commands.saveDocument()} />
      </Group>
      <Group label={t('commands.groups.edit')}>
        <CommandButton id="undo" icon={UndoIcon} label={t('commands.undo')} tooltip={t('commands.tooltips.undo')} disabled={!canUndo} onClick={commands.undo} />
        <CommandButton id="redo" icon={RedoIcon} label={t('commands.redo')} tooltip={t('commands.tooltips.redo')} disabled={!canRedo} onClick={commands.redo} />
      </Group>
      <div className="command-tabs" role="tablist" aria-label={t('commands.tabs.label')} aria-orientation="vertical">
        {TABS.map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`command-tab-${id}`}
            aria-selected={tab === id}
            aria-controls="command-tab-panel"
            data-tab={id}
            className={`command-tab${tab === id ? ' is-selected' : ''}`}
            onClick={() => commands.setCommandTab(id)}
          >
            {t(`commands.tabs.${id}`)}
          </button>
        ))}
      </div>
      <div className="command-tab-panel" id="command-tab-panel" role="tabpanel" aria-labelledby={`command-tab-${tab}`}>
        {tab === 'features' ? <FeaturesTab /> : <SketchTab />}
      </div>
      <div className="command-bar-spacer" />
      <Group label={t('commands.groups.export')}>
        <CommandButton id="export-step" icon={ExportStepIcon} label={t('commands.exportStep')} tooltip={t('commands.tooltips.exportStep')} disabled={!hasFeatures} onClick={() => void commands.exportModel('step')} />
        <CommandButton id="export-stl" icon={ExportStlIcon} label={t('commands.exportStl')} tooltip={t('commands.tooltips.exportStl')} disabled={!hasFeatures} onClick={() => void commands.exportModel('stl')} />
      </Group>
      <div className="command-bar-end">
        <CommandButton id="settings" icon={SettingsIcon} label={t('commands.settings')} tooltip={t('commands.tooltips.settings')} onClick={() => commands.openDialog('settings')} />
        <CommandButton id="about" icon={InfoIcon} label={t('commands.about')} tooltip={t('commands.tooltips.about')} onClick={() => commands.openDialog('about')} />
      </div>
    </header>
  );
}
