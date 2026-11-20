import type { StyleSpecification } from "@maplibre/maplibre-react-native";
import type { Language } from "@/lib/i18n";

type StyleLayer = {
  type?: string;
  layout?: Record<string, unknown>;
  [key: string]: unknown;
};

type OpenFreeMapStyle = {
  layers?: StyleLayer[];
  [key: string]: unknown;
};

function hasNameField(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  if (value[0] === "get" && typeof value[1] === "string" && value[1].startsWith("name")) {
    return true;
  }
  return value.some(hasNameField);
}

export async function fetchLocalizedMapStyle(
  styleUrl: string,
  language: Language,
  signal?: AbortSignal
): Promise<StyleSpecification> {
  const response = await fetch(styleUrl, {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {})
  });
  if (!response.ok) throw new Error("map_style_unavailable");

  const style = await response.json() as OpenFreeMapStyle;
  if (!Array.isArray(style.layers)) throw new Error("map_style_invalid");

  const preferredField = language === "ar" ? "name:ar" : "name:en";
  const secondaryField = language === "ar" ? "name:nonlatin" : "name:latin";
  const localizedLayers = style.layers.map((layer) => {
    const originalTextField = layer.layout?.["text-field"];
    if (layer.type !== "symbol" || !hasNameField(originalTextField)) return layer;

    return {
      ...layer,
      layout: {
        ...layer.layout,
        "text-field": [
          "coalesce",
          ["get", preferredField],
          ["get", secondaryField],
          ["get", "name"],
          originalTextField
        ]
      }
    };
  });

  return {
    ...style,
    layers: localizedLayers
  } as StyleSpecification;
}
