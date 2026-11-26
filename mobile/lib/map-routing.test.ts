import { describe, expect, it } from "vitest";

import {
  decodePolyline6,
  distanceBetweenCoordinates,
  distanceToRouteMeters,
  formatDistance,
  formatDuration,
  getActiveStepIndex,
  getManeuverInstruction,
  getRemainingRouteCoordinates,
  getRemainingRouteMetrics,
  type RouteStep
} from "./map-routing";

const steps: RouteStep[] = [
  {
    name: "",
    distance: 120,
    duration: 20,
    maneuverType: "depart",
    location: { longitude: 3, latitude: 36 }
  },
  {
    name: "Rue Didouche Mourad",
    distance: 80,
    duration: 15,
    maneuverType: "turn",
    modifier: "left",
    location: { longitude: 3.001, latitude: 36 }
  },
  {
    name: "",
    distance: 0,
    duration: 0,
    maneuverType: "arrive",
    location: { longitude: 3.002, latitude: 36 }
  }
];

describe("map routing helpers", () => {
  it("decodes Valhalla polyline6 geometry with six-digit precision", () => {
    const encodeValue = (value: number) => {
      let encoded = "";
      let current = value < 0 ? ~(value << 1) : value << 1;
      while (current >= 0x20) {
        encoded += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
        current >>= 5;
      }
      return encoded + String.fromCharCode(current + 63);
    };
    const points = [
      { longitude: 3.0588, latitude: 36.7538 },
      { longitude: 3.0598, latitude: 36.7548 }
    ];
    let previousLatitude = 0;
    let previousLongitude = 0;
    const shape = points.map((point) => {
      const latitude = Math.round(point.latitude * 1_000_000);
      const longitude = Math.round(point.longitude * 1_000_000);
      const encoded = encodeValue(latitude - previousLatitude) + encodeValue(longitude - previousLongitude);
      previousLatitude = latitude;
      previousLongitude = longitude;
      return encoded;
    }).join("");

    const decoded = decodePolyline6(shape);
    expect(decoded).toHaveLength(2);
    expect(decoded[0]?.latitude).toBeCloseTo(points[0]!.latitude, 6);
    expect(decoded[0]?.longitude).toBeCloseTo(points[0]!.longitude, 6);
    expect(decoded[1]?.latitude).toBeCloseTo(points[1]!.latitude, 6);
    expect(decoded[1]?.longitude).toBeCloseTo(points[1]!.longitude, 6);
  });

  it("calculates the distance between two coordinates", () => {
    expect(distanceBetweenCoordinates(
      { longitude: 0, latitude: 0 },
      { longitude: 0, latitude: 1 }
    )).toBeGreaterThan(111_000);
  });

  it("finds distance from the current position to the route", () => {
    const route = [
      { longitude: 0, latitude: 0 },
      { longitude: 0.01, latitude: 0 }
    ];
    expect(distanceToRouteMeters({ longitude: 0.005, latitude: 0 }, route)).toBeLessThan(1);
  });

  it("keeps the departure step while the user is still at the route origin", () => {
    expect(getActiveStepIndex(
      steps,
      { longitude: 3, latitude: 36 },
      0,
      [{ longitude: 3, latitude: 36 }, { longitude: 3.001, latitude: 36 }, { longitude: 3.002, latitude: 36 }]
    )).toBe(0);
  });

  it("advances after the user moves away from the departure point", () => {
    expect(getActiveStepIndex(
      steps,
      { longitude: 3.0005, latitude: 36 },
      0,
      [{ longitude: 3, latitude: 36 }, { longitude: 3.001, latitude: 36 }, { longitude: 3.002, latitude: 36 }]
    )).toBe(1);
  });

  it("advances after passing a maneuver even when GPS never entered its arrival radius", () => {
    expect(getActiveStepIndex(
      steps,
      { longitude: 3.0015, latitude: 36 },
      1,
      [{ longitude: 3, latitude: 36 }, { longitude: 3.001, latitude: 36 }, { longitude: 3.002, latitude: 36 }]
    )).toBe(2);
  });

  it("does not advance a maneuver while the user is still approaching it", () => {
    expect(getActiveStepIndex(
      steps,
      { longitude: 3.0006, latitude: 36 },
      1,
      [{ longitude: 3, latitude: 36 }, { longitude: 3.001, latitude: 36 }, { longitude: 3.002, latitude: 36 }]
    )).toBe(1);
  });

  it("calculates remaining distance and duration from the active step", () => {
    const route = {
      coordinates: [],
      steps,
      distance: 500,
      duration: 100
    };
    expect(getRemainingRouteMetrics(route, 1)).toEqual({ distance: 80, duration: 15 });
  });

  it("returns the route geometry from the nearest point to the destination", () => {
    const route = [
      { longitude: 0, latitude: 0 },
      { longitude: 0.01, latitude: 0 },
      { longitude: 0.02, latitude: 0 }
    ];
    expect(getRemainingRouteCoordinates(route, { longitude: 0.005, latitude: 0 })).toEqual([
      { longitude: 0.005, latitude: 0 },
      { longitude: 0.01, latitude: 0 },
      { longitude: 0.02, latitude: 0 }
    ]);
  });

  it("calculates remaining metrics from live position along the route", () => {
    const route = {
      coordinates: [
        { longitude: 0, latitude: 0 },
        { longitude: 0.01, latitude: 0 },
        { longitude: 0.02, latitude: 0 }
      ],
      steps,
      distance: 2_000,
      duration: 200
    };
    const remaining = getRemainingRouteMetrics(
      route,
      1,
      { longitude: 0.01, latitude: 0 }
    );
    expect(remaining.distance).toBeCloseTo(1_000, -1);
    expect(remaining.duration).toBeCloseTo(100, -1);
  });

  it("localizes maneuver instructions", () => {
    expect(getManeuverInstruction(steps[1]!, "ar")).toContain("انعطف يسارًا");
    expect(getManeuverInstruction(steps[1]!, "en")).toContain("Turn left");
  });

  it("formats route distance and duration in the selected language", () => {
    expect(formatDistance(850, "ar")).toContain("م");
    expect(formatDistance(1_500, "en")).toContain("km");
    expect(formatDuration(3_600, "en")).toBe("1 hr");
    expect(formatDuration(3_600, "ar")).toBe("1 س");
  });
});
