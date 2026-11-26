import { useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  Marker,
  UserLocation,
  type CameraRef,
  type MapRef
} from "@maplibre/maplibre-react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  View
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Location from "expo-location";

import { CustomerNavigation } from "@/components/customer-navigation";
import { CustomerMainHeader } from "@/components/customer-main-header";
import { BottomSheet, Button, Icon, Text as UiText } from "@/components/ui";
import { fetchMapStoresInBounds, fetchStoreDetails, fetchStoreOffers, type MapStoreViewport } from "@/lib/catalog";
import { translate, useLanguage } from "@/lib/i18n";
import {
  distanceBetweenCoordinates,
  distanceToRouteMeters,
  fetchDrivingRoute,
  formatDistance,
  formatDuration,
  getActiveStepIndex,
  getManeuverInstruction,
  getRemainingRouteCoordinates,
  getRemainingRouteMetrics,
  type DrivingRoute,
  type RoutePoint
} from "@/lib/map-routing";
import { fetchLocalizedMapStyle } from "@/lib/map-style";
import { fetchMyBrowsingCountryCode } from "@/lib/country-service";
import { designTokens, useAppTheme } from "@/lib/theme";
import { VerifiedBadge } from "@/components/ui/identity";

const MAP_LIGHT_STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MAP_DARK_STYLE = "https://tiles.openfreemap.org/styles/dark";
const OFF_ROUTE_DISTANCE_METERS = 70;
const REROUTE_COOLDOWN_MS = 15_000;

// Approximate country centers used for the initial browsing-market map view.
const BROWSING_COUNTRY_MAP_VIEWS: Record<string, { center: RoutePoint; zoom: number }> = {
  DZ: { center: { longitude: 1.66, latitude: 28.0 }, zoom: 4.1 },
  AE: { center: { longitude: 54.2, latitude: 24.2 }, zoom: 6.2 },
  SA: { center: { longitude: 45.0, latitude: 23.8 }, zoom: 4.0 },
  MA: { center: { longitude: -7.0, latitude: 31.8 }, zoom: 5.2 },
  EG: { center: { longitude: 30.8, latitude: 26.8 }, zoom: 4.6 }
};

function getBrowsingCountryMapView(countryCode: string | undefined) {
  return BROWSING_COUNTRY_MAP_VIEWS[countryCode ?? ""] ?? {
    center: { longitude: 2.6, latitude: 28.0 },
    zoom: 4.2
  };
}

type NavigationSession = {
  route: DrivingRoute;
  currentStepIndex: number;
  isRerouting: boolean;
};


function StoreMapMarker({ selected, verified, isDark }: { selected: boolean; verified: boolean; isDark: boolean }) {
  const scale = useRef(new Animated.Value(selected ? 1.18 : 1)).current;

  useEffect(() => {
    const animation = Animated.spring(scale, {
      toValue: selected ? 1.18 : 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6
    });
    animation.start();
    return () => animation.stop();
  }, [scale, selected]);

  return (
    <View style={styles.markerWrap} pointerEvents="none">
      <Animated.View
        style={[
          styles.markerCircle,
          selected && (isDark ? styles.markerSelectedDark : styles.markerSelectedLight),
          { transform: [{ scale }] }
        ]}
      >
        <Icon name="store" size={22} color="#000000" accessibilityHidden />
        {verified ? (
          <View style={styles.markerVerified}>
            <Icon name="check" size={9} color={designTokens.brand.accent} accessibilityHidden />
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

export default function MapScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const { storeId: requestedStoreId, directions: requestedDirections } = useLocalSearchParams<{ storeId?: string; directions?: string }>();
  const { language } = useLanguage();
  const isDark = theme.mode === "dark";
  const styleUrl = isDark ? MAP_DARK_STYLE : MAP_LIGHT_STYLE;
  const [cameraTarget, setCameraTarget] = useState<RoutePoint | null>(null);
  const [mapViewport, setMapViewport] = useState<MapStoreViewport | null>(null);
  const viewportUpdateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isMapLoaded, setIsMapLoaded] = useState(false);
  const appliedBrowsingCountryRef = useRef<string | null>(null);
  const browsingCountry = useQuery({
    queryKey: ["browsing-country"],
    queryFn: ({ signal }) => fetchMyBrowsingCountryCode(signal),
    staleTime: 30 * 60_000
  });
  const mapRef = useRef<MapRef | null>(null);
  const cameraRef = useRef<CameraRef | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [userPosition, setUserPosition] = useState<RoutePoint | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState<string | null>(null);
  const [navigation, setNavigation] = useState<NavigationSession | null>(null);
  const [isStartingNavigation, setIsStartingNavigation] = useState(false);
  const [navigationError, setNavigationError] = useState(false);
  const watchSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const watchGenerationRef = useRef(0);
  const lastRerouteAtRef = useRef(0);
  const navigationSessionRef = useRef(0);
  const rerouteRequestRef = useRef(0);
  const routeRequestControllerRef = useRef<AbortController | null>(null);
  const selectedStoreIdRef = useRef<string | null>(null);
  const navigationRef = useRef<NavigationSession | null>(null);
  const hasAutoStartedDirectionsRef = useRef(false);

  navigationRef.current = navigation;
  selectedStoreIdRef.current = selectedStoreId;

  useEffect(() => () => {
    routeRequestControllerRef.current?.abort();
    routeRequestControllerRef.current = null;
    if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
    viewportUpdateTimerRef.current = null;
  }, []);

  const stores = useQuery({
    queryKey: ["map-stores", browsingCountry.data, mapViewport, requestedStoreId],
    queryFn: ({ signal }) => fetchMapStoresInBounds(mapViewport!, browsingCountry.data!, requestedStoreId ?? null, signal),
    enabled: mapViewport !== null && browsingCountry.data !== undefined,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData
  });

  const localizedStyle = useQuery({
    queryKey: ["map-style", styleUrl, language],
    queryFn: ({ signal }) => fetchLocalizedMapStyle(styleUrl, language, signal),
    staleTime: 24 * 60 * 60 * 1000,
    retry: 1
  });

  const selectedStore = stores.data?.find((store) => store.id === selectedStoreId) ?? null;

  useEffect(() => {
    if (!isMapLoaded || !browsingCountry.data || appliedBrowsingCountryRef.current === browsingCountry.data) return;
    const view = getBrowsingCountryMapView(browsingCountry.data);
    appliedBrowsingCountryRef.current = browsingCountry.data;
    cameraRef.current?.easeTo({
      center: [view.center.longitude, view.center.latitude],
      zoom: view.zoom,
      duration: 700
    });
  }, [isMapLoaded, browsingCountry.data]);

  useEffect(() => {
    if (requestedDirections !== "1" || !requestedStoreId || !stores.data || selectedStoreId) return;
    if (stores.data.some((store) => store.id === requestedStoreId)) {
      selectedStoreIdRef.current = requestedStoreId;
      setSelectedStoreId(requestedStoreId);
    }
  }, [requestedDirections, requestedStoreId, stores.data, selectedStoreId]);

  const visibleStores = stores.data ?? [];

  const navigationRoute = navigation?.route ?? null;
  const routeFeatureCollection = useMemo(() => {
    if (!navigationRoute) return { type: "FeatureCollection" as const, features: [] };
    const remainingCoordinates = userPosition
      ? getRemainingRouteCoordinates(navigationRoute.coordinates, userPosition)
      : navigationRoute.coordinates;
    return {
      type: "FeatureCollection" as const,
      features: remainingCoordinates.length >= 2 ? [{
        type: "Feature" as const,
        properties: {},
        geometry: {
          type: "LineString" as const,
          coordinates: remainingCoordinates.map((point) => [point.longitude, point.latitude])
        }
      }] : []
    };
  }, [navigationRoute, userPosition]);

  const getCurrentLocation = async () => {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") {
      Alert.alert(
        translate("mapLocationPermissionTitle", language),
        translate("mapLocationPermissionMessage", language)
      );
      return null;
    }

    setHasLocationPermission(true);
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced
    });
    const currentPosition: RoutePoint = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude
    };
    setUserPosition(currentPosition);
    return currentPosition;
  };

  const isNavigationActive = navigation !== null;

  useEffect(() => {
    if (!isNavigationActive) return;

    let isActive = true;
    const generation = watchGenerationRef.current + 1;
    watchGenerationRef.current = generation;

    void Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 2_000,
        distanceInterval: 5
      },
      (nextPosition) => {
        if (!isActive || watchGenerationRef.current !== generation) return;
        const next: RoutePoint = {
          latitude: nextPosition.coords.latitude,
          longitude: nextPosition.coords.longitude
        };
        setUserPosition(next);
        if (navigationRef.current) setCameraTarget(next);
      }
    ).then((subscription) => {
      if (!isActive || watchGenerationRef.current !== generation) {
        subscription.remove();
        return;
      }
      watchSubscriptionRef.current = subscription;
    }).catch(() => {
      if (isActive && watchGenerationRef.current === generation) {
        setNavigationError(true);
      }
    });

    return () => {
      isActive = false;
      if (watchGenerationRef.current === generation) {
        watchGenerationRef.current += 1;
      }
      watchSubscriptionRef.current?.remove();
      watchSubscriptionRef.current = null;
    };
  }, [isNavigationActive]);

  const locateUser = async () => {
    if (isLocating) return;
    setIsLocating(true);

    try {
      const currentPosition = await getCurrentLocation();
      if (currentPosition) {
        setCameraTarget(currentPosition);
      }
    } catch {
      Alert.alert(
        translate("mapLocationPermissionTitle", language),
        translate("mapLocationError", language)
      );
    } finally {
      setIsLocating(false);
    }
  };

  const openSelectedStore = () => {
    if (!selectedStore) return;
    const storeId = selectedStore.id;

    void queryClient.prefetchQuery({
      queryKey: ["customer-store", storeId],
      queryFn: ({ signal }) => fetchStoreDetails(storeId, signal),
      staleTime: 60_000
    });
    void queryClient.prefetchQuery({
      queryKey: ["customer-store-offers", storeId],
      queryFn: ({ signal }) => fetchStoreOffers(storeId, signal),
      staleTime: 30_000
    });

    navigationSessionRef.current += 1;
    rerouteRequestRef.current += 1;
    routeRequestControllerRef.current?.abort();
    routeRequestControllerRef.current = null;
    setIsStartingNavigation(false);
    setNavigation(null);
    selectedStoreIdRef.current = null;
    setSelectedStoreId(null);
    router.push({ pathname: "/store/[storeId]", params: { storeId } });
  };

  const startNavigation = async () => {
    if (!selectedStore || isStartingNavigation) return;
    const sessionId = navigationSessionRef.current + 1;
    navigationSessionRef.current = sessionId;
    rerouteRequestRef.current += 1;
    const destinationStoreId = selectedStore.id;
    const controller = new AbortController();
    routeRequestControllerRef.current?.abort();
    routeRequestControllerRef.current = controller;
    setIsStartingNavigation(true);
    setNavigationError(false);

    try {
      const origin = await getCurrentLocation();
      if (!origin || controller.signal.aborted || navigationSessionRef.current !== sessionId
        || selectedStoreIdRef.current !== destinationStoreId) return;

      const destination: RoutePoint = {
        latitude: selectedStore.latitude,
        longitude: selectedStore.longitude
      };
      const route = await fetchDrivingRoute(origin, destination, controller.signal);
      if (controller.signal.aborted || navigationSessionRef.current !== sessionId
        || selectedStoreIdRef.current !== destinationStoreId) return;
      if (route.coordinates.length < 2) throw new Error("route_geometry_missing");

      setNavigation({
        route,
        currentStepIndex: 0,
        isRerouting: false
      });
      lastRerouteAtRef.current = Date.now();
      setCameraTarget(origin);
    } catch {
      if (!controller.signal.aborted) {
        setNavigationError(true);
        Alert.alert(
          translate("mapNavigationErrorTitle", language),
          translate("mapNavigationError", language)
        );
      }
    } finally {
      if (routeRequestControllerRef.current === controller) {
        routeRequestControllerRef.current = null;
        setIsStartingNavigation(false);
      }
    }
  };

  useEffect(() => {
    if (requestedDirections !== "1" || !selectedStore || selectedStore.id !== requestedStoreId || hasAutoStartedDirectionsRef.current) return;
    hasAutoStartedDirectionsRef.current = true;
    void startNavigation();
  }, [requestedDirections, requestedStoreId, selectedStore]);

  const stopNavigation = () => {
    navigationSessionRef.current += 1;
    rerouteRequestRef.current += 1;
    routeRequestControllerRef.current?.abort();
    routeRequestControllerRef.current = null;
    setIsStartingNavigation(false);
    setNavigation(null);
    setNavigationError(false);
  };

  useEffect(() => {
    if (!navigation || !userPosition) return;

    const nextStepIndex = getActiveStepIndex(
      navigation.route.steps,
      userPosition,
      navigation.currentStepIndex,
      navigation.route.coordinates
    );
    if (nextStepIndex !== navigation.currentStepIndex) {
      setNavigation((current) => current
        ? { ...current, currentStepIndex: nextStepIndex }
        : current);
    }

    const distanceFromRoute = distanceToRouteMeters(userPosition, navigation.route.coordinates);
    if (distanceFromRoute <= OFF_ROUTE_DISTANCE_METERS) return;
    if (Date.now() - lastRerouteAtRef.current < REROUTE_COOLDOWN_MS) return;

    lastRerouteAtRef.current = Date.now();
    const sessionId = navigationSessionRef.current;
    const requestId = rerouteRequestRef.current + 1;
    rerouteRequestRef.current = requestId;
    const sourceRoute = navigation.route;
    const destinationStoreId = selectedStore?.id ?? null;
    const controller = new AbortController();
    routeRequestControllerRef.current?.abort();
    routeRequestControllerRef.current = controller;
    setNavigation((current) => current ? { ...current, isRerouting: true } : current);

    const destination = selectedStore
      ? { latitude: selectedStore.latitude, longitude: selectedStore.longitude }
      : null;
    if (!destination || !destinationStoreId) {
      setNavigation((current) => current ? { ...current, isRerouting: false } : current);
      return;
    }

    const isRequestCurrent = () =>
      navigationSessionRef.current === sessionId
      && rerouteRequestRef.current === requestId
      && selectedStoreIdRef.current === destinationStoreId
      && navigationRef.current?.route === sourceRoute;

    void fetchDrivingRoute(userPosition, destination, controller.signal)
      .then((route) => {
        if (controller.signal.aborted) return;
        if (!isRequestCurrent()) return;
        setNavigation((current) => current && current.route === sourceRoute
          ? { route, currentStepIndex: 0, isRerouting: false }
          : current);
      })
      .catch(() => {
        if (controller.signal.aborted || !isRequestCurrent()) return;
        setNavigation((current) => current && current.route === sourceRoute
          ? { ...current, isRerouting: false }
          : current);
      })
      .finally(() => {
        if (routeRequestControllerRef.current === controller) {
          routeRequestControllerRef.current = null;
        }
      });
  }, [userPosition, navigation, selectedStore]);

  const currentStep = navigation?.route.steps[navigation.currentStepIndex] ?? null;
  const remainingRoute = navigation
    ? getRemainingRouteMetrics(navigation.route, navigation.currentStepIndex, userPosition)
    : null;
  const distanceTargetStep = currentStep?.maneuverType === "depart"
    ? navigation?.route.steps[navigation.currentStepIndex + 1] ?? currentStep
    : currentStep;
  const currentStepDistance = distanceTargetStep && userPosition
    ? distanceBetweenCoordinates(userPosition, distanceTargetStep.location)
    : null;

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: theme.colors.background }]}
      edges={["top", "left", "right"]}
    >
      <View style={styles.mainHeader}>
        <CustomerMainHeader variant="settings" />
      </View>
      <View style={styles.mapContainer}>
        <MapLibreMap
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={localizedStyle.data ?? styleUrl}
          attribution
          attributionPosition={{ bottom: 8, left: 8 }}
          logo={false}
          compass={false}
          light={{
            position: [1.5, 90, 80],
            color: "#FFFFFF",
            intensity: isDark ? 0.35 : 0.75
          }}
          onDidFinishLoadingMap={() => {
            setIsMapLoaded(true);
            void mapRef.current?.getViewState().then((viewState) => {
              const [west, south, east, north] = viewState.bounds;
              const [centerLongitude, centerLatitude] = viewState.center;
              if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
              viewportUpdateTimerRef.current = null;
              setMapViewport({ west, south, east, north, centerLatitude, centerLongitude });
            }).catch(() => undefined);
          }}
          onRegionDidChange={(event) => {
            const [longitude, latitude] = event.nativeEvent.center;
            const [west, south, east, north] = event.nativeEvent.bounds;
            if ([west, south, east, north, latitude, longitude].every(Number.isFinite)
              && south <= north) {
              if (viewportUpdateTimerRef.current) clearTimeout(viewportUpdateTimerRef.current);
              viewportUpdateTimerRef.current = setTimeout(() => {
                viewportUpdateTimerRef.current = null;
                setMapViewport({
                  west,
                  south,
                  east,
                  north,
                  centerLatitude: latitude,
                  centerLongitude: longitude
                });
              }, 180);
            }
          }}
        >
          <Camera
            ref={cameraRef}
            {...(cameraTarget
              ? {
                  center: [cameraTarget.longitude, cameraTarget.latitude] as [number, number],
                  zoom: navigation ? 17 : 16,
                  pitch: navigation ? 58 : 0,
                  duration: 650
                }
              : {
                  initialViewState: {
                    center: [getBrowsingCountryMapView(browsingCountry.data).center.longitude, getBrowsingCountryMapView(browsingCountry.data).center.latitude] as [number, number],
                    zoom: getBrowsingCountryMapView(browsingCountry.data).zoom,
                    pitch: 0,
                    bearing: 0
                  }
                })}
          />

          {navigation ? (
            <GeoJSONSource id="arownd-navigation-route" data={routeFeatureCollection}>
              <Layer
                id="arownd-navigation-route-casing"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": isDark ? "#101820" : "#FFFFFF",
                  "line-width": 11,
                  "line-opacity": 0.92
                }}
              />
              <Layer
                id="arownd-navigation-route-line"
                type="line"
                layout={{ "line-cap": "round", "line-join": "round" }}
                paint={{
                  "line-color": designTokens.brand.blue,
                  "line-width": 6,
                  "line-opacity": 1
                }}
              />
            </GeoJSONSource>
          ) : null}

          {visibleStores.map((store) => (
            <Marker
              key={store.id}
              id={store.id}
              lngLat={[store.longitude, store.latitude]}
              anchor="center"
              onPress={() => {
                if (navigationRef.current) stopNavigation();
                selectedStoreIdRef.current = store.id;
                setSelectedStoreId(store.id);
              }}
            >
              <StoreMapMarker
                selected={selectedStoreId === store.id}
                verified={store.is_verified}
                isDark={isDark}
              />
            </Marker>
          ))}

          {hasLocationPermission ? <UserLocation animated accuracy /> : null}
        </MapLibreMap>

        {stores.isPending ? (
          <View pointerEvents="none" style={styles.mapStatusContainer}>
            <View style={[styles.mapStatusCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <ActivityIndicator size="small" color={theme.colors.accentOnSurface} />
              <UiText weight="600">{translate("mapStoresLoading", language)}</UiText>
            </View>
          </View>
        ) : stores.isError ? (
          <View style={styles.mapStatusContainer}>
            <View style={[styles.mapStatusCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <UiText weight="600" style={styles.mapStatusText}>{translate("mapStoresLoadError", language)}</UiText>
              <Pressable
                accessibilityRole="button"
                onPress={() => void stores.refetch()}
                style={[styles.mapRetryButton, { backgroundColor: theme.colors.accent }]}
              >
                <UiText weight="700" style={{ color: theme.colors.accentForeground }}>
                  {translate("mapStoresRetry", language)}
                </UiText>
              </Pressable>
            </View>
          </View>
        ) : stores.data?.length === 0 ? (
          <View pointerEvents="none" style={styles.mapStatusContainer}>
            <View style={[styles.mapStatusCard, { backgroundColor: theme.colors.surface, borderColor: theme.colors.border }]}>
              <UiText weight="600" style={styles.mapStatusText}>{translate("mapStoresEmpty", language)}</UiText>
              <UiText tone="muted" style={styles.mapStatusHint}>{translate("mapStoresEmptyHint", language)}</UiText>
            </View>
          </View>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={translate("mapLocateMe", language)}
          accessibilityState={{ disabled: isLocating }}
          onPress={() => void locateUser()}
          disabled={isLocating}
          style={[
            styles.locationButton,
            {
              top: 16,
              end: 16,
              backgroundColor: theme.colors.surface,
              borderColor: theme.colors.border,
              opacity: isLocating ? 0.65 : 1
            }
          ]}
        >
          {isLocating
            ? <ActivityIndicator size="small" color={theme.colors.foreground} />
            : <Icon name="locate-fixed" size={22} color={theme.colors.foreground} accessibilityHidden />}
        </Pressable>
      </View>

      <CustomerNavigation />

      <BottomSheet
        visible={Boolean(selectedStore)}
        onRequestClose={() => {
          selectedStoreIdRef.current = null;
          setSelectedStoreId(null);
          if (navigation) stopNavigation();
        }}
        title={selectedStore?.name ?? ""}
        maxHeight="60%"
        scrollable={!navigation}
      >
        {selectedStore ? (
          navigation ? (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.navigationContent}>
              <View style={styles.navigationHeader}>
                <View style={[styles.navigationBadge, { backgroundColor: theme.colors.successSurface }]}>
                  <View style={[styles.liveDot, { backgroundColor: theme.colors.success }]} />
                  <UiText tone="success" weight="700" style={styles.badgeText}>
                    {translate("mapNavigationActive", language)}
                  </UiText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={translate("mapNavigationEnd", language)}
                  onPress={stopNavigation}
                  hitSlop={8}
                  style={[styles.closeNavigation, { backgroundColor: theme.colors.surfaceSecondary }]}
                >
                  <Icon name="x" size={18} color={theme.colors.foreground} accessibilityHidden />
                </Pressable>
              </View>

              <View style={styles.navigationDestination}>
                {selectedStore.logo_url ? (
                  <Image source={{ uri: selectedStore.logo_url }} style={styles.destinationLogo} />
                ) : (
                  <View style={[styles.destinationLogo, styles.destinationLogoFallback, { backgroundColor: theme.colors.accent }]}>
                    <Icon name="store" size={22} color={theme.colors.accentForeground} accessibilityHidden />
                  </View>
                )}
                <View style={styles.storeCopy}>
                  <UiText weight="700" style={styles.storeName} numberOfLines={1}>{selectedStore.name}</UiText>
                  <UiText tone="muted" style={styles.storeLocation} numberOfLines={2}>
                    {[selectedStore.commune, selectedStore.address_line].filter(Boolean).join(" · ") || translate("mapAddressUnavailable", language)}
                  </UiText>
                </View>
              </View>

              <View style={[styles.routeSummary, { backgroundColor: theme.colors.surfaceSecondary }]}>
                <View style={styles.routeMetric}>
                  <UiText weight="800" style={styles.routeMetricValue}>
                    {formatDistance(remainingRoute?.distance ?? navigation.route.distance, language)}
                  </UiText>
                  <UiText tone="muted" style={styles.routeMetricLabel}>
                    {translate("mapNavigationDistance", language)}
                  </UiText>
                </View>
                <View style={[styles.metricDivider, { backgroundColor: theme.colors.border }]} />
                <View style={styles.routeMetric}>
                  <UiText weight="800" style={styles.routeMetricValue}>
                    {formatDuration(remainingRoute?.duration ?? navigation.route.duration, language)}
                  </UiText>
                  <UiText tone="muted" style={styles.routeMetricLabel}>
                    {translate("mapNavigationDuration", language)}
                  </UiText>
                </View>
              </View>

              <View style={[styles.instructionCard, { backgroundColor: theme.colors.surface }]}>
                <View style={[styles.instructionIcon, { backgroundColor: theme.colors.accent }]}>
                  <Icon name="navigation" size={24} color={theme.colors.accentForeground} accessibilityHidden />
                </View>
                <View style={styles.instructionCopy}>
                  <UiText tone="muted" style={styles.routeMetricLabel}>
                    {translate("mapNavigationNext", language)}
                  </UiText>
                  <UiText weight="700" style={styles.instructionText}>
                    {currentStep
                      ? getManeuverInstruction(currentStep, language)
                      : translate("mapNavigationContinue", language)}
                  </UiText>
                  {currentStepDistance !== null ? (
                    <UiText tone="muted" style={styles.storeLocation}>
                      {formatDistance(currentStepDistance, language)}
                    </UiText>
                  ) : null}
                </View>
              </View>

              {navigation.isRerouting ? (
                <View style={styles.reroutingRow}>
                  <ActivityIndicator size="small" color={theme.colors.accentOnSurface} />
                  <UiText tone="muted">{translate("mapNavigationRecalculating", language)}</UiText>
                </View>
              ) : null}

              <Button
                label={translate("mapNavigationEnd", language)}
                onPress={stopNavigation}
                variant="outline"
                fullWidth
                startIcon={<Icon name="x" size={18} color={theme.colors.foreground} accessibilityHidden />}
              />
            </ScrollView>
          ) : (
            <View style={styles.storeCard}>
              <View style={styles.storeHeading}>
                {selectedStore.logo_url ? (
                  <Image source={{ uri: selectedStore.logo_url }} style={styles.storeLogo} />
                ) : (
                  <View style={[styles.storeLogo, styles.storeLogoFallback, { backgroundColor: theme.colors.accent }]}>
                    <Icon name="store" size={28} color={theme.colors.accentForeground} accessibilityHidden />
                  </View>
                )}
                <View style={styles.storeCopy}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                    <UiText weight="700" style={[styles.storeName, { flexShrink: 1 }]} numberOfLines={2}>{selectedStore.name}</UiText>
                    {selectedStore.is_verified ? <VerifiedBadge size={17} accessibilityLabel={translate("storeVerified", language)} /> : null}
                  </View>
                  {selectedStore.is_verified ? (
                    <View style={[styles.verifiedBadge, { backgroundColor: theme.colors.successSurface }]}>
                      <Icon name="check" size={13} color={theme.colors.success} accessibilityHidden />
                      <UiText tone="success" weight="700" style={styles.badgeText}>
                        {translate("storeVerified", language)}
                      </UiText>
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={[styles.addressCard, { backgroundColor: theme.colors.surfaceSecondary }]}>
                <View style={[styles.addressIcon, { backgroundColor: theme.colors.surface }]}>
                  <Icon name="map-pin" size={19} color={theme.colors.accentOnSurface} accessibilityHidden />
                </View>
                <View style={styles.storeCopy}>
                  <UiText tone="muted" style={styles.routeMetricLabel}>
                    {translate("storeAddress", language)}
                  </UiText>
                  <UiText style={styles.addressText}>
                    {[selectedStore.commune, selectedStore.address_line].filter(Boolean).join(" · ") || translate("mapAddressUnavailable", language)}
                  </UiText>
                </View>
              </View>

              <View style={styles.actions}>
                <Button
                  label={translate("mapViewStore", language)}
                  onPress={openSelectedStore}
                  fullWidth
                />
                <Button
                  label={isStartingNavigation
                    ? translate("mapNavigationStarting", language)
                    : translate("mapDirections", language)}
                  onPress={() => void startNavigation()}
                  disabled={isStartingNavigation}
                  variant="outline"
                  fullWidth
                  startIcon={isStartingNavigation
                    ? <ActivityIndicator size="small" color={theme.colors.foreground} />
                    : <Icon name="navigation" size={18} color={theme.colors.foreground} accessibilityHidden />}
                />
              </View>
              {navigationError ? (
                <UiText tone="danger" style={styles.errorText}>
                  {translate("mapNavigationError", language)}
                </UiText>
              ) : null}
            </View>
          )
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
  mainHeader: {
    paddingHorizontal: designTokens.spacing.xl,
    paddingTop: designTokens.spacing.xs,
    paddingBottom: designTokens.spacing.sm
  },
  mapStatusContainer: {
    position: "absolute",
    top: 136,
    start: 20,
    end: 20,
    zIndex: 4,
    alignItems: "center"
  },
  mapStatusCard: {
    width: "100%",
    maxWidth: 360,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 16,
    padding: designTokens.spacing.md,
    alignItems: "center",
    gap: designTokens.spacing.sm,
    elevation: 3,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4
  },
  mapStatusText: {
    textAlign: "center"
  },
  mapStatusHint: {
    fontSize: designTokens.typography.caption,
    textAlign: "center"
  },
  mapRetryButton: {
    minHeight: 40,
    minWidth: 112,
    paddingHorizontal: designTokens.spacing.lg,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center"
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
  markerWrap: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    overflow: "visible"
  },
  markerCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: designTokens.brand.accent,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
    elevation: 3,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3
  },
  markerSelectedLight: {
    borderWidth: 1,
    borderColor: "#000000",
    elevation: 7,
    shadowColor: "#000000",
    shadowOpacity: 0.24,
    shadowRadius: 5
  },
  markerSelectedDark: {
    borderWidth: 1,
    borderColor: "#FFFFFF",
    elevation: 7,
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.18,
    shadowRadius: 5
  },
  markerVerified: {
    position: "absolute",
    right: -3,
    bottom: -3,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#111111",
    borderWidth: 2,
    borderColor: designTokens.brand.accent,
    alignItems: "center",
    justifyContent: "center"
  },
  storeCard: {
    gap: designTokens.spacing.lg
  },
  storeHeading: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md
  },
  storeLogo: {
    width: 66,
    height: 66,
    borderRadius: 20,
    backgroundColor: "#F2F2F2"
  },
  storeLogoFallback: {
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
  verifiedBadge: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: designTokens.spacing.sm,
    paddingVertical: designTokens.spacing.xs,
    borderRadius: 999
  },
  badgeText: {
    fontSize: designTokens.typography.caption
  },
  addressCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    padding: designTokens.spacing.md,
    borderRadius: 16
  },
  addressIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center"
  },
  addressText: {
    fontSize: designTokens.typography.body
  },
  actions: {
    gap: designTokens.spacing.sm
  },
  navigationContent: {
    gap: designTokens.spacing.md,
    paddingBottom: designTokens.spacing.sm
  },
  navigationHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between"
  },
  navigationBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 999,
    paddingHorizontal: designTokens.spacing.md,
    paddingVertical: designTokens.spacing.sm
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4
  },
  closeNavigation: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center"
  },
  navigationDestination: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md
  },
  destinationLogo: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: "#F2F2F2"
  },
  destinationLogoFallback: {
    alignItems: "center",
    justifyContent: "center"
  },
  routeSummary: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: 18,
    padding: designTokens.spacing.md
  },
  routeMetric: {
    flex: 1,
    alignItems: "center",
    gap: 4
  },
  routeMetricValue: {
    fontSize: designTokens.typography.title
  },
  routeMetricLabel: {
    fontSize: designTokens.typography.caption
  },
  metricDivider: {
    width: StyleSheet.hairlineWidth,
    height: 34
  },
  instructionCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.md,
    padding: designTokens.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#D6D9E0",
    borderRadius: 18
  },
  instructionIcon: {
    width: 48,
    height: 48,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center"
  },
  instructionCopy: {
    flex: 1,
    gap: designTokens.spacing.xs
  },
  instructionText: {
    fontSize: designTokens.typography.subtitle
  },
  reroutingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: designTokens.spacing.sm
  },
  errorText: {
    fontSize: designTokens.typography.caption
  }
});
