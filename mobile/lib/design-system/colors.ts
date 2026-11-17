export const brandColors = {
  primary: "#FFFF00",
  black: "#000000",
  white: "#FFFFFF",
  light: "#F5F5F5"
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
    background: "#FFFFFF",
    surface: "#FFFFFF",
    surfaceSecondary: "#F5F5F5",
    surfaceTertiary: "#EEEEEE",
    foreground: "#000000",
    foregroundSecondary: "#5C5C5C",
    foregroundMuted: "#5C5C5C",
    border: "#E5E5E5",
    input: "#F5F5F5",
    inputBorder: "#8A8A8A",
    focus: "#000000"
  },
  dark: {
    background: "#000000",
    surface: "#141414",
    surfaceSecondary: "#141414",
    surfaceTertiary: "#1E1E1E",
    foreground: "#FFFFFF",
    foregroundSecondary: "#A3A3A3",
    foregroundMuted: "#A3A3A3",
    border: "#2E2E2E",
    input: "#1E1E1E",
    inputBorder: "#707070",
    focus: "#FFFF00"
  }
} as const;

export const extendedThemeColors = {
  light: {
    surfaceMuted: "#F5F5F5",
    subtle: "#5C5C5C",
    accentMuted: "#5C5C5C",
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
    placeholder: "#5C5C5C",
    overlay: "rgba(0,0,0,0.42)"
  },
  dark: {
    surfaceMuted: "#1E1E1E",
    subtle: "#A3A3A3",
    accentMuted: "#A3A3A3",
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
    placeholder: "#A3A3A3",
    overlay: "rgba(0,0,0,0.72)"
  }
} as const;
