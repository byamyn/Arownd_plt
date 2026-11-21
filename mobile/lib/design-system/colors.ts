export const brandColors = {
  primary: "#D97757",
  black: "#141413",
  white: "#FAF9F5",
  light: "#FAF9F5",
  midGray: "#B0AEA5",
  lightGray: "#E8E6DC",
  blue: "#6A9BCC",
  green: "#788C5D"
} as const;

export const semanticColors = {
  success: "#15803D",
  warning: "#B45309",
  danger: "#DC2626",
  info: "#2563EB"
} as const;

export const commerceColors = {
  discount: "#DC2626",
  stockAvailable: "#16A34A",
  stockLow: "#D97706",
  stockOut: "#DC2626"
} as const;

export const deliveryColors = {
  pending: "#D97706",
  progress: "#2563EB",
  completed: "#16A34A",
  cancelled: "#DC2626"
} as const;

export const themeColors = {
  light: {
    background: "#FAF9F5",
    surface: "#FAF9F5",
    surfaceSecondary: "#E8E6DC",
    surfaceTertiary: "#E1DFD5",
    foreground: "#141413",
    foregroundSecondary: "#5C5B55",
    foregroundMuted: "#5C5B55",
    border: "#B0AEA5",
    input: "#E8E6DC",
    inputBorder: "#8A887F",
    focus: "#D97757"
  },
  dark: {
    background: "#141413",
    surface: "#1C1C19",
    surfaceSecondary: "#252520",
    surfaceTertiary: "#30302A",
    foreground: "#FAF9F5",
    foregroundSecondary: "#B0AEA5",
    foregroundMuted: "#B0AEA5",
    border: "#4A4942",
    input: "#252520",
    inputBorder: "#77756D",
    focus: "#D97757"
  }
} as const;

export const extendedThemeColors = {
  light: {
    surfaceMuted: "#E8E6DC",
    subtle: "#5C5B55",
    accentMuted: "#B65F43",
    danger: "#DC2626",
    dangerText: "#B91C1C",
    dangerSurface: "#FEE2E2",
    dangerBorder: "#FEE2E2",
    success: "#15803D",
    successText: "#166534",
    successSurface: "#DCFCE7",
    successBorder: "#DCFCE7",
    warning: "#B45309",
    warningText: "#92400E",
    warningSurface: "#FEF3C7",
    warningBorder: "#FEF3C7",
    info: "#2563EB",
    infoText: "#1D4ED8",
    infoSurface: "#DBEAFE",
    infoBorder: "#DBEAFE",
    placeholder: "#5C5B55",
    overlay: "rgba(20,20,19,0.42)"
  },
  dark: {
    surfaceMuted: "#252520",
    subtle: "#B0AEA5",
    accentMuted: "#E58B6E",
    danger: "#F87171",
    dangerText: "#F87171",
    dangerSurface: "rgba(248,113,113,0.15)",
    dangerBorder: "rgba(248,113,113,0.15)",
    success: "#4ADE80",
    successText: "#4ADE80",
    successSurface: "rgba(74,222,128,0.15)",
    successBorder: "rgba(74,222,128,0.15)",
    warning: "#FBBF24",
    warningText: "#FBBF24",
    warningSurface: "rgba(251,191,36,0.15)",
    warningBorder: "rgba(251,191,36,0.15)",
    info: "#60A5FA",
    infoText: "#60A5FA",
    infoSurface: "rgba(96,165,250,0.15)",
    infoBorder: "rgba(96,165,250,0.15)",
    placeholder: "#B0AEA5",
    overlay: "rgba(0,0,0,0.72)"
  }
} as const;
