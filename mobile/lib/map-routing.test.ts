import { describe, expect, it } from "vitest";

import {
  distanceBetweenCoordinates,
  distanceToRouteMeters,
  formatDistance,
  formatDuration,
  getActiveStepIndex,
  getManeuverInstruction,
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

  it("advances to the next maneuver when the user reaches it", () => {
    expect(getActiveStepIndex(
      steps,
      { longitude: 3, latitude: 36 },
      0
    )).toBe(1);
  });

  it("localizes maneuver instructions", () => {
    expect(getManeuverInstruction(steps[1], "ar")).toContain("انعطف يسارًا");
    expect(getManeuverInstruction(steps[1], "en")).toContain("Turn left");
  });

  it("formats route distance and duration in the selected language", () => {
    expect(formatDistance(850, "ar")).toContain("م");
    expect(formatDistance(1_500, "en")).toContain("km");
    expect(formatDuration(3_600, "en")).toBe("1 hr");
    expect(formatDuration(3_600, "ar")).toBe("1 س");
  });
});
