type TokenDef = {
  variable: string;
  label: string;
  type: "color" | "text";
};

type TokenGroup = {
  title: string;
  tokens: TokenDef[];
};

const COLOR_GROUPS: TokenGroup[] = [
  {
    title: "Canvas",
    tokens: [{ variable: "--C-CANVAS", label: "Canvas", type: "color" }],
  },
  {
    title: "Brand",
    tokens: [
      { variable: "--C-PRIMARY", label: "Primary", type: "color" },
      { variable: "--C-PRIMARY-HOVER", label: "Primary Hover", type: "color" },
      { variable: "--C-PRIMARY-ACTIVE", label: "Primary Active", type: "color" },
      { variable: "--C-SECONDARY", label: "Secondary", type: "color" },
      { variable: "--C-SECONDARY-HOVER", label: "Secondary Hover", type: "color" },
      { variable: "--C-ACCENT", label: "Accent", type: "color" },
      { variable: "--C-ACCENT-HOVER", label: "Accent Hover", type: "color" },
    ],
  },
  {
    title: "Surface",
    tokens: [
      { variable: "--C-SURFACE-0", label: "Surface 0", type: "color" },
      { variable: "--C-SURFACE-1", label: "Surface 1", type: "color" },
      { variable: "--C-SURFACE-2", label: "Surface 2", type: "color" },
      { variable: "--C-SURFACE-3", label: "Surface 3", type: "color" },
    ],
  },
  {
    title: "Text",
    tokens: [
      { variable: "--C-TEXT-PRIMARY", label: "Text Primary", type: "color" },
      { variable: "--C-TEXT-SECONDARY", label: "Text Secondary", type: "color" },
      { variable: "--C-TEXT-MUTED", label: "Text Muted", type: "color" },
      { variable: "--C-TEXT-INVERSE", label: "Text Inverse", type: "color" },
      { variable: "--C-TEXT-ON-PRIMARY", label: "On Primary", type: "color" },
      { variable: "--C-TEXT-ON-ACCENT", label: "On Accent", type: "color" },
    ],
  },
  {
    title: "Border",
    tokens: [
      { variable: "--C-BORDER-DEFAULT", label: "Default", type: "color" },
      { variable: "--C-BORDER-STRONG", label: "Strong", type: "color" },
      { variable: "--C-BORDER-FOCUS", label: "Focus", type: "color" },
    ],
  },
  {
    title: "Status",
    tokens: [
      { variable: "--C-STATUS-ERROR", label: "Error", type: "color" },
      { variable: "--C-STATUS-ERROR-BG", label: "Error BG", type: "color" },
      { variable: "--C-STATUS-SUCCESS", label: "Success", type: "color" },
      { variable: "--C-STATUS-SUCCESS-BG", label: "Success BG", type: "color" },
      { variable: "--C-STATUS-WARNING", label: "Warning", type: "color" },
      { variable: "--C-STATUS-WARNING-BG", label: "Warning BG", type: "color" },
      { variable: "--C-STATUS-INFO", label: "Info", type: "color" },
      { variable: "--C-STATUS-INFO-BG", label: "Info BG", type: "color" },
    ],
  },
];

const TYPOGRAPHY_TOKENS: TokenGroup[] = [
  {
    title: "Font Families",
    tokens: [
      { variable: "--DEFAULT-FONT", label: "Default Font", type: "text" },
      { variable: "--DEFAULT-MONO-FONT", label: "Mono Font", type: "text" },
      { variable: "--HEADING-FONT", label: "Heading Font", type: "text" },
    ],
  },
  {
    title: "Heading Style",
    tokens: [
      { variable: "--HEADING-LETTER-SPACING", label: "Letter Spacing", type: "text" },
      { variable: "--HEADING-TEXT-TRANSFORM", label: "Text Transform", type: "text" },
    ],
  },
  {
    title: "Weights",
    tokens: [
      { variable: "--Bold-Weight", label: "Bold", type: "text" },
      { variable: "--Semibold-Weight", label: "Semibold", type: "text" },
    ],
  },
];

const RADIUS_TOKENS: TokenGroup[] = [
  {
    title: "Border Radius",
    tokens: [
      { variable: "--RADIUS-SM", label: "Small", type: "text" },
      { variable: "--RADIUS-MD", label: "Medium", type: "text" },
      { variable: "--RADIUS-LG", label: "Large", type: "text" },
      { variable: "--RADIUS-XL", label: "Extra Large", type: "text" },
      { variable: "--RADIUS-FULL", label: "Full", type: "text" },
    ],
  },
];

const SHADOW_TOKENS: TokenGroup[] = [
  {
    title: "Shadows",
    tokens: [
      { variable: "--SHADOW-SM", label: "Small", type: "text" },
      { variable: "--SHADOW-MD", label: "Medium", type: "text" },
      { variable: "--SHADOW-LG", label: "Large", type: "text" },
    ],
  },
];

const MOTION_TOKENS: TokenGroup[] = [
  {
    title: "Durations",
    tokens: [
      { variable: "--MOTION-DURATION-ENTER", label: "Enter", type: "text" },
      { variable: "--MOTION-DURATION-EXIT", label: "Exit", type: "text" },
      { variable: "--MOTION-DURATION-SHIFT", label: "Shift", type: "text" },
      { variable: "--MOTION-DURATION-PAGE", label: "Page", type: "text" },
    ],
  },
  {
    title: "Easing",
    tokens: [
      { variable: "--MOTION-EASE-PAGE", label: "Page", type: "text" },
      { variable: "--MOTION-EASE-ENTER", label: "Enter", type: "text" },
      { variable: "--MOTION-EASE-EXIT", label: "Exit", type: "text" },
      { variable: "--MOTION-EASE-SHIFT", label: "Shift", type: "text" },
      { variable: "--MOTION-EASE-BOUNCE", label: "Bounce", type: "text" },
    ],
  },
  {
    title: "Distances",
    tokens: [
      { variable: "--MOTION-DISTANCE-SM", label: "Small", type: "text" },
      { variable: "--MOTION-DISTANCE-MD", label: "Medium", type: "text" },
      { variable: "--MOTION-DISTANCE-LG", label: "Large", type: "text" },
    ],
  },
  {
    title: "Scale",
    tokens: [
      { variable: "--MOTION-SCALE-HOVER", label: "Hover", type: "text" },
      { variable: "--MOTION-SCALE-PRESS", label: "Press", type: "text" },
    ],
  },
];

const OVERLAY_TOKENS: TokenGroup[] = [
  {
    title: "Overlay",
    tokens: [
      { variable: "--OVERLAY-SCRIM-COLOR", label: "Scrim Color", type: "text" },
      { variable: "--OVERLAY-GRADIENT-START", label: "Gradient Start", type: "text" },
      { variable: "--OVERLAY-GRADIENT-END", label: "Gradient End", type: "text" },
      { variable: "--OVERLAY-BLUR", label: "Blur", type: "text" },
      { variable: "--OVERLAY-BLUR-HEAVY", label: "Blur Heavy", type: "text" },
    ],
  },
];

const TRANSITION_TOKENS: TokenGroup[] = [
  {
    title: "Transitions",
    tokens: [
      { variable: "--DURATION-FAST", label: "Fast", type: "text" },
      { variable: "--DURATION-NORMAL", label: "Normal", type: "text" },
      { variable: "--DURATION-SLOW", label: "Slow", type: "text" },
    ],
  },
];

const TAB_CONFIG = [
  { value: "colors", label: "Colors", groups: COLOR_GROUPS },
  { value: "typography", label: "Typography", groups: TYPOGRAPHY_TOKENS },
  { value: "radius", label: "Radius", groups: RADIUS_TOKENS },
  { value: "shadows", label: "Shadows", groups: SHADOW_TOKENS },
  { value: "motion", label: "Motion", groups: MOTION_TOKENS },
  { value: "overlay", label: "Overlay", groups: OVERLAY_TOKENS },
  { value: "transitions", label: "Transitions", groups: TRANSITION_TOKENS },
] as const;

/** All editable variables in a flat list */
const ALL_TOKENS = TAB_CONFIG.flatMap((t) => t.groups.flatMap((g) => g.tokens));

export type { TokenDef, TokenGroup };
export {
  ALL_TOKENS,
  COLOR_GROUPS,
  MOTION_TOKENS,
  OVERLAY_TOKENS,
  RADIUS_TOKENS,
  SHADOW_TOKENS,
  TAB_CONFIG,
  TRANSITION_TOKENS,
  TYPOGRAPHY_TOKENS,
};
