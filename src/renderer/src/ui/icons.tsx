import type { ReactNode, SVGProps } from 'react';

/** ParaWerk's own line icon set: 24 px grid, 1.7 px strokes, round joins. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement> & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement>;

export const NewIcon = (p: P) => (
  <Icon {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5M12 11v6M9 14h6" />
  </Icon>
);

export const OpenIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1" />
    <path d="M3 7v11a2 2 0 0 0 2 2h12.5a2 2 0 0 0 1.9-1.4L22 11H7.4a2 2 0 0 0-1.9 1.4L3 19" />
  </Icon>
);

export const SaveIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 3h11l5 5v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
    <path d="M7 3v5h8V3M7 21v-7h10v7" />
  </Icon>
);

export const BoxIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="M4 7.4 12 12l8-4.6M12 12v9.2" />
  </Icon>
);

export const CylinderIcon = (p: P) => (
  <Icon {...p}>
    <ellipse cx="12" cy="6" rx="7" ry="3" />
    <path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6" />
  </Icon>
);

export const FilletIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V11a7 7 0 0 1 7-7h9" />
    <path d="M4 20h16V4" strokeDasharray="2 2.6" opacity="0.55" />
    <path d="M7.5 9.5 4.8 6.8M9.8 7.4 8.6 4" opacity="0.9" />
  </Icon>
);

export const ChamferIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10l6-6h10" />
    <path d="M4 20h16V4" strokeDasharray="2 2.6" opacity="0.55" />
    <path d="M10 4 4 10" strokeWidth={2.4} />
  </Icon>
);

export const ExportStepIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10 3.2 16 6.6v6.9l-6 3.4-6-3.4V6.6z" />
    <path d="M4 6.6 10 10l6-3.4M10 10v6.9" />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

export const ExportStlIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 17 9 5l6 12zM9 5v12M6 11h6" />
    <path d="M15 19h6m-2.5-2.5L21 19l-2.5 2.5" />
  </Icon>
);

export const UndoIcon = (p: P) => (
  <Icon {...p}>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Icon>
);

export const RedoIcon = (p: P) => (
  <Icon {...p}>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Icon>
);

export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
    <circle cx="15" cy="6" r="2" />
    <circle cx="9" cy="12" r="2" />
    <circle cx="17" cy="18" r="2" />
  </Icon>
);

export const InfoIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v6M12 7.5v.01" />
  </Icon>
);

export const ZoomFitIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
    <rect x="8.5" y="8.5" width="7" height="7" rx="1" />
  </Icon>
);

export const ViewsIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 2.8 20 7.4v9.2l-8 4.6-8-4.6V7.4z" />
    <path d="M4 7.4 12 12l8-4.6-8-4.6z" fill="currentColor" fillOpacity="0.28" />
    <path d="M12 12v9.2" />
  </Icon>
);

export const ProjectionIcon = (p: P) => (
  <Icon {...p}>
    <path d="M3 8.5 9 6v12l-6-2.5z" />
    <path d="M9 6l12-3v18L9 18" />
  </Icon>
);

export const EditIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z" />
    <path d="m13.5 6.5 4 4" />
  </Icon>
);

export const EyeIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
);

export const EyeOffIcon = (p: P) => (
  <Icon {...p}>
    <path d="M10.6 5.6A9.4 9.4 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.7 16.7 0 0 1-2.6 3.4M6.6 6.6C3.9 8.4 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 4.6-1.2" />
    <path d="M3 3l18 18M9.9 9.9a3 3 0 0 0 4.2 4.2" />
  </Icon>
);

export const TrashIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />
  </Icon>
);

export const MoreIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 6v.01M12 12v.01M12 18v.01" strokeWidth={2.6} />
  </Icon>
);

export const AlertIcon = (p: P) => (
  <Icon {...p}>
    <path d="M12 3.5 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.5v.01" />
  </Icon>
);

export const CheckIcon = (p: P) => (
  <Icon {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const OriginIcon = (p: P) => (
  <Icon {...p}>
    <path d="M5 19 5 5M5 19h14M5 19l8-8" />
    <circle cx="5" cy="19" r="1.4" fill="currentColor" />
  </Icon>
);

export const SketchIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 20V10a6 6 0 0 1 6-6h5M4 20h6" />
    <path d="m13.5 19.5.6-3 6-6a1.5 1.5 0 0 1 2.1 2.1l-6 6z" />
    <circle cx="4" cy="20" r="1.2" fill="currentColor" stroke="none" />
  </Icon>
);

export const FEATURE_ICONS = {
  sketch: SketchIcon,
  box: BoxIcon,
  cylinder: CylinderIcon,
  fillet: FilletIcon,
  chamfer: ChamferIcon,
} as const;
