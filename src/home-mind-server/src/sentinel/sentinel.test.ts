import { describe, expect, it, vi } from "vitest";
import { HomeMindSentinel } from "./sentinel.js";

describe("HomeMindSentinel", () => {
  it("is disabled without starting a polling timer", () => {
    const ha = { getEntities: vi.fn() } as any;
    const sentinel = new HomeMindSentinel(ha, {
      enabled: false, entities: ["binary_sensor.front_door"], intervalSeconds: 60,
      journalPath: "/tmp/home-mind-sentinel-test/events.jsonl",
    });
    sentinel.start();
    expect(ha.getEntities).not.toHaveBeenCalled();
    expect(sentinel.status().enabled).toBe(false);
    sentinel.stop();
  });

  it("reports observe-only mode and configured watched entities", () => {
    const ha = { getEntities: vi.fn() } as any;
    const sentinel = new HomeMindSentinel(ha, {
      enabled: true, entities: ["binary_sensor.front_door"], intervalSeconds: 60,
      journalPath: "/tmp/home-mind-sentinel-test/events.jsonl",
    });
    expect(sentinel.status()).toMatchObject({
      enabled: true, watchedEntities: ["binary_sensor.front_door"],
      intervalSeconds: 60, mode: "observe-only",
    });
    sentinel.stop();
  });
});
