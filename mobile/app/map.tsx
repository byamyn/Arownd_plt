import { useMemo, useState } from "react";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  RasterSource,
  UserLocation
} from "@maplibre/maplibre-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { CustomerNavigation } from "@/components/customer-navigation";
import { BottomSheet, Button, Icon, Text as UiText } from "@/components/ui";
import { fetchMapStores, fetchStoreDetails, fetchStoreOffers } from "@/lib/catalog";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

const MAP_LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const EOX_SATELLITE_TILES = "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg";
const EOX_ATTRIBUTION =
  "EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016)";

type CameraTarget = {
  longitude: number;
  latitude: number;
};

export default function MapScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const isDark = theme.mode === "dark";
  const [cameraTarget, setCameraTarget] = useState<CameraTarget | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["map-stores"],
    queryFn: fetchMapStores,
    staleTime: 60_000
  });

  const storeFeatures = useMemo(() => ({
    type: "FeatureCollection" as const,
    features: (stores.data ?? []).map((store) => ({
      type: "Feature" as const,
      id: store.id,
      properties: {
        storeId: store.id,
        name: store.name
      },
      geometry: {
        type: "Point" as const,
        coordinates: [store.longitude, store.latitude] as [number, number]
      }
    }))
  }), [stores.data]);

  const selectedStore = stores.data?.find((store) => store.id === selectedStoreId) ?? null;

  const locateUser = async () => {
    if (isLocating) return;
    setIsLocating(true);

    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        Alert.alert(
          translate("mapLocationPermissionTitle"),
          translate("mapLocationPermissionMessage")
        );
        return;
      }

      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced
      });

      setHasLocationPermission(true);
      setCameraTarget({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      });
    } catch {
      Alert.alert(translate("mapLocationPermissionTitle"), translate("mapLocationError"));
    } finally {
      setIsLocating(false);
    }
  };

  const openSelectedStore = () => {
    if (!selectedStore) return;
    const storeId = selectedStore.id;

    void queryClient.prefetchQuery({
      queryKey: ["customer-store", storeId],
      queryFn: () => fetchStoreDetails(storeId),
      staleTime: 60_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["customer-store-offers", storeId],
      queryFn: () => fetchStoreOffers(storeId),
      staleTime: 30_000
    });

    setSelectedStoreId(null);
    router.push({ pathname: "/store/[storeId]", params: { storeId } });
  };

  const openDirections = () => {
    if (!selectedStore) return;
    const destination = selectedStore.latitude + "," + selectedStore.longitude;
    void Linking.openURL("https://www.google.com/maps/dir/?api=1&destination=" + destination).catch(() => {
      Alert.alert(translate("mapDirectionsError"));
    });
  };

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.mapContainer}>
        <MapLibreMap
          style={StyleSheet.absoluteFill}
          mapStyle={isDark ? MAP_DARK_STYLE : MAP_LIGHT_STYLE}
          attribution
          attributionPosition={{ bottom: 8, left: 8 }}
          logo={false}
          compass={false}
          light={{
            position: [1.5, 90, 80],
            color: "#FFFFFF",
            intensity: isDark ? 0.35 : 0.75
          }}
        >
          <Camera
            {...(cameraTarget
              ? {
                  center: [cameraTarget.longitude, cameraTarget.latitude] as [number, number],
                  zoom: 16,
                  pitch: 48,
                  duration: 900
                }
              : {
                  initialViewState: {
                    center: [2.6, 28.0] as [number, number],
                    zoom: 4.5,
                    pitch: 0,
                    bearing: 0
                  }
                })}
          />

          <RasterSource
            id="arownd-eox-satellite"
            tiles={[EOX_SATELLITE_TILES]}
            tileSize={256}
            minzoom={0}
            maxzoom={14}
            attribution={EOX_ATTRIBUTION}
          >
            <Layer
              id="arownd-satellite-imagery"
              type="raster"
              source="arownd-eox-satellite"
              afterId="background"
              paint={{ "raster-opacity": 1 }}
            />
          </RasterSource>

          {isDark ? (
            <Layer
              id="arownd-dark-3d-buildings"
              type="fill-extrusion"
              source="openmaptiles"
              source-layer="building"
              minzoom={14}
              afterId="building"
              paint={{
                "fill-extrusion-base": ["coalesce", ["get", "render_min_height"], 0],
                "fill-extrusion-height": ["coalesce", ["get", "render_height"], 8],
                "fill-extrusion-color": "#555B66",
                "fill-extrusion-opacity": 0.9
              }}
            />
          ) : null}

          <GeoJSONSource
            id="arownd-store-markers"
            data={storeFeatures}
            onPress={(event) => {
              const storeId = event.nativeEvent.features?.[0]?.properties?.storeId;
              if (typeof storeId === "string") setSelectedStoreId(storeId);
            }}
          >
            <Layer
              id="arownd-store-marker-circles"
              type="circle"
              paint={{
                "circle-color": "#FDE72A",
                "circle-radius": 14,
                "circle-stroke-color": "#FFFFFF",
                "circle-stroke-width": 2.5
              }}
            />
            <Layer
              id="arownd-store-marker-labels"
              type="symbol"
              layout={{
                "text-field": "A",
                "text-font": ["Noto Sans Regular"],
                "text-size": 12,
                "text-allow-overlap": true,
                "text-ignore-placement": true
              }}
              paint={{ "text-color": "#171717" }}
            />
          </GeoJSONSource>

          {hasLocationPermission ? <UserLocation animated accuracy /> : null}
        </MapLibreMap>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("mapLocateMe")}
          onPress={() => void locateUser()}
          disabled={isLocating}
          style={[
            styles.locationButton,
            {
              top: 12,
              end: 16,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: isLocating ? 0.65 : 1
            }
          ]}
        >
          <Icon name="locate-fixed" size={22} color={theme.colors.foreground} accessibilityHidden />
        </Pressable>
      </View>

      <CustomerNavigation />

      <BottomSheet
        visible={Boolean(selectedStore)}
        onRequestClose={() => setSelectedStoreId(null)}
      >
        {selectedStore ? (
          <>
            <View style={styles.storeHeading}>
              <View style={[styles.storeIcon, { backgroundColor: theme.colors.accent }]}>
                <Icon name="store" size={22} color={theme.colors.accentForeground} accessibilityHidden />
              </View>
              <View style={styles.storeCopy}>
                <UiText weight="700" style={styles.storeName}>{selectedStore.name}</UiText>
                <UiText tone="muted" style={styles.storeLocation}>
                  {[selectedStore.commune, selectedStore.address_line].filter(Boolean).join(" · ") || translate("mapAddressUnavailable")}
                </UiText>
              </View>
              <Icon name="check" size={20} color={theme.colors.success} accessibilityHidden />
            </View>
            <View style={styles.actions}>
              <Button
                label={translate("mapViewStore")}
                onPress={openSelectedStore}
                fullWidth
              />
              <Button
                label={translate("mapDirections")}
                onPress={openDirections}
                variant="outline"
                fullWidth
                startIcon={<Icon name="navigation" size={18} color={theme.colors.foreground} accessibilityHidden />}
              />
            </View>
          </>
        ) : null}
      </BottomSheet>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  mapContainer: {
    flex: 1
  },
  locationButton: {
    position: "absolute",
    width: 46,
    height: 46,
    borderRadius: 23,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    elevation: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 4
  },
  storeHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md
  },
  storeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center"
  },
  storeCopy: {
    flex: 1,
    gap: designTokens.spacing.xs
  },
  storeName: {
    fontSize: designTokens.typography.subtitle
  },
  storeLocation: {
    fontSize: designTokens.typography.caption
  },
  actions: {
    gap: designTokens.spacing.sm
  }
});
