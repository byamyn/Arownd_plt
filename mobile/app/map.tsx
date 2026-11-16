import { useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { GoogleMaps } from "expo-maps";
import * as Location from "expo-location";

import { CustomerNavigation } from "@/components/customer-navigation";
import { Icon } from "@/components/ui";
import { translate } from "@/lib/i18n";
import { useAppTheme } from "@/lib/theme";

type UserMapLocation = {
  coordinates: {
    latitude: number;
    longitude: number;
  };
  followUserLocation: boolean;
};

export default function MapScreen() {
  const theme = useAppTheme();
  const [userLocation, setUserLocation] = useState<UserMapLocation | undefined>();
  const [isLocating, setIsLocating] = useState(false);

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
            rotateGesturesEnabled: true,
            scrollGesturesEnabled: true,
            tiltGesturesEnabled: true,
            zoomControlsEnabled: false,
            zoomGesturesEnabled: true
          }}
          userLocation={userLocation}
        />

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("mapLocationPermissionTitle")}
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
  }
});
