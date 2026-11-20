import type { Language } from "@/lib/i18n";

export type RoutePoint = {
  longitude: number;
  latitude: number;
};

export type RouteStep = {
  name: string;
  distance: number;
  duration: number;
  maneuverType: string;
  modifier?: string;
  location: RoutePoint;
};

export type DrivingRoute = {
  coordinates: RoutePoint[];
  steps: RouteStep[];
  distance: number;
  duration: number;
};

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: { coordinates?: [number, number][] };
    legs?: Array<{
      steps?: Array<{
        name?: string;
        distance?: number;
        duration?: number;
        maneuver?: {
          type?: string;
          modifier?: string;
          location?: [number, number];
        };
      }>;
    }>;
  }>;
};

export async function fetchDrivingRoute(
  origin: RoutePoint,
  destination: RoutePoint,
  signal?: AbortSignal
): Promise<DrivingRoute> {
  const coordinates = [
    `${origin.longitude},${origin.latitude}`,
    `${destination.longitude},${destination.latitude}`
  ].join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=false&annotations=false`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    ...(signal ? { signal } : {})
  });

  if (!response.ok) throw new Error("route_service_unavailable");
  const payload = await response.json() as OsrmResponse;
  const route = payload.routes?.[0];
  const rawCoordinates = route?.geometry?.coordinates;
  if (payload.code !== "Ok" || !route || !rawCoordinates || rawCoordinates.length < 2) {
    throw new Error("route_not_found");
  }

  const steps: RouteStep[] = (route.legs?.[0]?.steps ?? []).flatMap((step) => {
    const location = step.maneuver?.location;
    if (!location || location.length < 2) return [];
    return [{
      name: step.name ?? "",
      distance: step.distance ?? 0,
      duration: step.duration ?? 0,
      maneuverType: step.maneuver?.type ?? "continue",
      ...(step.maneuver?.modifier ? { modifier: step.maneuver.modifier } : {}),
      location: {
        longitude: location[0],
        latitude: location[1]
      }
    }];
  });

  return {
    coordinates: rawCoordinates.map(([longitude, latitude]) => ({ longitude, latitude })),
    steps,
    distance: route.distance ?? 0,
    duration: route.duration ?? 0
  };
}

export function distanceBetweenCoordinates(first: RoutePoint, second: RoutePoint): number {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const firstLatitude = radians(first.latitude);
  const secondLatitude = radians(second.latitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(firstLatitude) * Math.cos(secondLatitude) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function projectPointToSegment(
  position: RoutePoint,
  start: RoutePoint,
  end: RoutePoint
): { distance: number; fraction: number } {
  const earthRadius = 6_371_000;
  const radians = (value: number) => value * Math.PI / 180;
  const referenceLatitude = radians(position.latitude);
  const project = (point: RoutePoint) => ({
    x: earthRadius * Math.cos(referenceLatitude) * radians(point.longitude - position.longitude),
    y: earthRadius * radians(point.latitude - position.latitude)
  });
  const first = project(start);
  const second = project(end);
  const deltaX = second.x - first.x;
  const deltaY = second.y - first.y;
  const segmentLengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (segmentLengthSquared === 0) {
    return { distance: Math.hypot(first.x, first.y), fraction: 0 };
  }

  const fraction = Math.max(0, Math.min(1,
    -(first.x * deltaX + first.y * deltaY) / segmentLengthSquared
  ));
  return {
    distance: Math.hypot(first.x + fraction * deltaX, first.y + fraction * deltaY),
    fraction
  };
}

function distanceToSegmentMeters(position: RoutePoint, start: RoutePoint, end: RoutePoint): number {
  return projectPointToSegment(position, start, end).distance;
}

function getRouteProgressMeters(position: RoutePoint, route: RoutePoint[]): number {
  if (route.length === 0) return Number.POSITIVE_INFINITY;
  if (route.length === 1) return distanceBetweenCoordinates(position, route[0]!);

  let travelled = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  let bestProgress = 0;

  for (let index = 0; index < route.length - 1; index += 1) {
    const start = route[index];
    const end = route[index + 1];
    if (!start || !end) continue;

    const segmentLength = distanceBetweenCoordinates(start, end);
    const projection = projectPointToSegment(position, start, end);
    if (projection.distance < bestDistance) {
      bestDistance = projection.distance;
      bestProgress = travelled + segmentLength * projection.fraction;
    }
    travelled += segmentLength;
  }

  return bestProgress;
}

export function distanceToRouteMeters(position: RoutePoint, route: RoutePoint[]): number {
  if (route.length === 0) return Number.POSITIVE_INFINITY;
  if (route.length === 1) {
    const onlyPoint = route[0];
    return onlyPoint ? distanceBetweenCoordinates(position, onlyPoint) : Number.POSITIVE_INFINITY;
  }

  const stride = Math.max(1, Math.floor(route.length / 160));
  let nearest = Number.POSITIVE_INFINITY;

  for (let index = 0; index < route.length - 1; index += stride) {
    const start = route[index];
    const end = route[Math.min(index + stride, route.length - 1)];
    if (start && end) {
      nearest = Math.min(nearest, distanceToSegmentMeters(position, start, end));
    }
  }

  return nearest;
}

export function getRemainingRouteMetrics(
  route: DrivingRoute,
  currentStepIndex: number
): { distance: number; duration: number } {
  const remainingSteps = route.steps.slice(Math.max(0, currentStepIndex));
  if (remainingSteps.length === 0) return { distance: 0, duration: 0 };
  return remainingSteps.reduce(
    (total, step) => ({
      distance: total.distance + step.distance,
      duration: total.duration + step.duration
    }),
    { distance: 0, duration: 0 }
  );
}

export function getActiveStepIndex(
  steps: RouteStep[],
  position: RoutePoint,
  currentIndex: number,
  routeCoordinates: RoutePoint[]
): number {
  if (steps.length === 0) return 0;

  let nextIndex = Math.min(Math.max(0, currentIndex), steps.length - 1);
  const currentProgress = getRouteProgressMeters(position, routeCoordinates);

  while (nextIndex < steps.length - 1) {
    const currentStep = steps[nextIndex];
    if (!currentStep || currentStep.maneuverType === "arrive") break;

    const distance = distanceBetweenCoordinates(position, currentStep.location);
    if (currentStep.maneuverType === "depart") {
      if (distance <= 28) break;
      nextIndex += 1;
      continue;
    }

    if (distance <= 28) {
      nextIndex += 1;
      continue;
    }

    const stepProgress = getRouteProgressMeters(currentStep.location, routeCoordinates);
    if (currentProgress > stepProgress + 20) {
      nextIndex += 1;
      continue;
    }

    break;
  }

  return nextIndex;
}

const maneuverLabels: Record<Language, Record<string, string>> = {
  ar: {
    depart: "ابدأ السير",
    arrive: "لقد وصلت إلى وجهتك",
    continue: "واصل السير",
    turn_left: "انعطف يسارًا",
    turn_right: "انعطف يمينًا",
    slight_left: "انعطف قليلًا إلى اليسار",
    slight_right: "انعطف قليلًا إلى اليمين",
    sharp_left: "انعطف بشدة إلى اليسار",
    sharp_right: "انعطف بشدة إلى اليمين",
    uturn: "استدر للخلف",
    roundabout: "ادخل الدوار",
    rotary: "واصل عبر الدوار",
    merge: "اندمج مع الطريق",
    fork_left: "اسلك التفرع الأيسر",
    fork_right: "اسلك التفرع الأيمن",
    "on ramp": "اسلك مدخل الطريق",
    "off ramp": "اسلك مخرج الطريق",
    "end of road_left": "انعطف يسارًا عند نهاية الطريق",
    "end of road_right": "انعطف يمينًا عند نهاية الطريق"
  },
  en: {
    depart: "Start driving",
    arrive: "You have arrived",
    continue: "Continue straight",
    turn_left: "Turn left",
    turn_right: "Turn right",
    slight_left: "Turn slightly left",
    slight_right: "Turn slightly right",
    sharp_left: "Turn sharp left",
    sharp_right: "Turn sharp right",
    uturn: "Make a U-turn",
    roundabout: "Enter the roundabout",
    rotary: "Continue through the roundabout",
    merge: "Merge onto the road",
    fork_left: "Keep left at the fork",
    fork_right: "Keep right at the fork",
    "on ramp": "Take the ramp",
    "off ramp": "Take the exit",
    "end of road_left": "Turn left at the end of the road",
    "end of road_right": "Turn right at the end of the road"
  }
};

export function getManeuverInstruction(step: RouteStep, language: Language): string {
  const modifier = step.modifier ?? "";
  let key = step.maneuverType;

  if (key === "turn" && modifier === "uturn") {
    key = "uturn";
  } else if (key === "turn" || key === "new name" || key === "end of road" || key === "fork") {
    key = modifier ? `${key}_${modifier.replace(/ /g, "_")}` : "continue";
  } else if (key === "roundabout turn" || key === "exit roundabout") {
    key = "roundabout";
  } else if (key === "use lane") {
    key = "continue";
  } else if (key === "on ramp" || key === "off ramp") {
    // Keep the OSRM maneuver name; both dictionaries contain these labels.
  }

  const labels = maneuverLabels[language];
  const label = labels[key] ?? labels.continue ?? (language === "ar" ? "واصل السير" : "Continue straight");
  return step.name ? `${label} · ${step.name}` : label;
}

export function formatDistance(meters: number, language: Language): string {
  const locale = language === "ar" ? "ar-DZ" : "en-DZ";
  if (meters < 1_000) {
    return `${new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 0 }).format(Math.max(0, meters))} ${language === "ar" ? "م" : "m"}`;
  }
  return `${new Intl.NumberFormat(`${locale}-u-nu-latn`, { maximumFractionDigits: 1 }).format(meters / 1_000)} ${language === "ar" ? "كم" : "km"}`;
}

export function formatDuration(seconds: number, language: Language): string {
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (language === "ar") {
    if (hours > 0 && minutes > 0) return `${hours} س ${minutes} د`;
    if (hours > 0) return `${hours} س`;
    return `${totalMinutes} د`;
  }
  if (hours > 0 && minutes > 0) return `${hours} hr ${minutes} min`;
  if (hours > 0) return `${hours} hr`;
  return `${totalMinutes} min`;
}
