import { describe, expect, it } from "vitest";

import { designTokens, getAppTheme } from "./theme";

describe("design system theme tokens", () => {
  it("keeps brand and base colors consistent in both modes", () => {
    expect(designTokens.brand.accent).toBe("#D97757");
    expect(getAppTheme("light").colors.accent).toBe("#D97757");
    expect(getAppTheme("dark").colors.accent).toBe("#D97757");
    expect(getAppTheme("light").colors.background).toBe("#FAF9F5");
    expect(getAppTheme("dark").colors.background).toBe("#141413");
  });

  it("provides the approved foreground and surface colors for both modes", () => {
    const light = getAppTheme("light");
    const dark = getAppTheme("dark");

    expect(light.colors.foreground).toBe("#141413");
    expect(light.colors.accentOnSurface).toBe("#141413");
    expect(dark.colors.accentOnSurface).toBe("#D97757");
    expect(light.colors.surface).toBe("#FAF9F5");
    expect(dark.colors.foreground).toBe("#FAF9F5");
    expect(dark.colors.surface).toBe("#1C1C19");
    expect(light.colors.foregroundSecondary).toBe("#5C5B55");
    expect(dark.colors.foregroundSecondary).toBe("#B0AEA5");
    expect(light.colors.inputBorder).toBe("#8A887F");
    expect(dark.colors.inputBorder).toBe("#77756D");
  });

  it("exposes consistent spacing, radius, typography and dimensions", () => {
    expect(designTokens.spacing.md).toBe(12);
    expect(designTokens.radius.lg).toBe(18);
    expect(designTokens.typography.body).toBe(14);
    expect(designTokens.dimensions.controlHeight.md).toBe(44);
    expect(designTokens.fontFamilies.latin).toBe("Inter");
    expect(designTokens.fontFamilies.arabic).toBe("sans-serif");
    expect(designTokens.fontWeights.regular).toBe("400");
    expect(designTokens.fontWeights.extrabold).toBe("800");
    expect(getAppTheme("light").fontFamilies).toEqual(designTokens.fontFamilies);
    expect(getAppTheme("dark").fontWeights).toEqual(designTokens.fontWeights);
    expect(getAppTheme("light").dimensions).toEqual(designTokens.dimensions);
    expect(getAppTheme("dark").shadows).toEqual(designTokens.shadows);
  });

  it("resolves semantic component colors from the centralized light and dark palettes", () => {
    for (const mode of ["light", "dark"] as const) {
      const theme = getAppTheme(mode);
      const tokens = designTokens.semanticTheme[mode];
      expect(theme.colors.surfaceMuted).toBe(tokens.surfaceMuted);
      expect(theme.colors.accentMuted).toBe(tokens.accentMuted);
      expect(theme.colors.dangerSurface).toBe(tokens.dangerSurface);
      expect(theme.colors.successSurface).toBe(tokens.successSurface);
      expect(theme.colors.warningSurface).toBe(tokens.warningSurface);
      expect(theme.colors.infoSurface).toBe(tokens.infoSurface);
      expect(theme.colors.placeholder).toBe(tokens.placeholder);
      expect(theme.colors.overlay).toBe(tokens.overlay);
    }
  });

  it("keeps semantic, commerce and delivery colors centralized", () => {
    expect(designTokens.semantic.success).toBe("#15803D");
    expect(designTokens.commerce.discount).toBe("#DC2626");
    expect(designTokens.delivery.completed).toBe("#16A34A");
  });
});
