import type { ConfigContext } from "expo/config";

const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
const googleMapsApiKey = process.env.GOOGLE_MAPS_API_KEY;

export default ({ config }: ConfigContext) => ({
  ...config,
  android: {
    ...config.android,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    ...(googleMapsApiKey ? {
      config: {
        ...config.android?.config,
        googleMaps: { ...config.android?.config?.googleMaps, apiKey: googleMapsApiKey }
      }
    } : {})
  }
});
