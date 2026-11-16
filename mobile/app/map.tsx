import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Alert, Linking, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GoogleMaps } from "expo-maps";
import * as Location from "expo-location";

import { CustomerNavigation } from "@/components/customer-navigation";
import { BottomSheet, Button, Icon, Text as UiText } from "@/components/ui";
import { fetchMapStores, fetchStoreDetails, fetchStoreOffers } from "@/lib/catalog";
import { translate } from "@/lib/i18n";
import { designTokens, useAppTheme } from "@/lib/theme";

type UserMapLocation = {
  coordinates: {
    latitude: number;
    longitude: number;
  };
  followUserLocation: boolean;
};

export default function MapScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const [userLocation, setUserLocation] = useState<UserMapLocation | undefined>();
  const [isLocating, setIsLocating] = useState(false);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);

  const stores = useQuery({
    queryKey: ["map-stores"],
    queryFn: fetchMapStores,
    staleTime: 60_000
  });

  const markers = useMemo(
    () => (stores.data ?? []).map((store) => ({
      id: store.id,
      title: store.name,
      ...(store.commune ? { snippet: store.commune } : {}),
      coordinates: {
        latitude: store.latitude,
        longitude: store.longitude
      },
      showCallout: false
    })),
    [stores.data]
  );

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

      setUserLocation({
        coordinates: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        },
        followUserLocation: true
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
    const destination = `${selectedStore.latitude},${selectedStore.longitude}`;
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${destination}`).catch(() => {
      Alert.alert(translate("mapDirectionsError"));
    });
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.colors.background }]} edges={["top", "left", "right"]}>
      <View style={styles.mapContainer}>
        <GoogleMaps.View
          style={StyleSheet.absoluteFill}
          cameraPosition={{
            coordinates: { latitude: 28.0, longitude: 2.6 },
            zoom: 4.5
          }}
          colorScheme={theme.mode === "dark" ? "DARK" : "LIGHT"}
          properties={{
            mapType: "SATELLITE",
            isBuildingEnabled: true,
            isMyLocationEnabled: false
          }}
          uiSettings={{
            compassEnabled: false,
            mapToolbarEnabled: false,
            myLocationButtonEnabled: false,
            rotationGesturesEnabled: true,
            scrollGesturesEnabled: true,
            tiltGesturesEnabled: true,
            zoomControlsEnabled: false,
            zoomGesturesEnabled: true
          }}
          markers={markers}
          onMarkerClick={(marker) => setSelectedStoreId(marker.id ?? null)}
          {...(userLocation ? { userLocation } : {})}
        />

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
              <Icon name="badge-check" size={20} color={theme.colors.success} accessibilityHidden />
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
                variant="secondary"
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
