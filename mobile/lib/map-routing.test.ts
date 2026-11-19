import { describe, expect, it } from "vitest";

import {
  distanceBetweenCoordinates,
  distanceToRouteMeters,
  formatDistance,
  formatDuration,
  getActiveStepIndex,
  getManeuverInstruction,
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
