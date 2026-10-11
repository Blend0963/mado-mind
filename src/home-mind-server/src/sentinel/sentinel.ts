import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { HomeAssistantClient, EntityState } from "../ha/client.js";

/**
 * Read-only proactive observer. It may create Home Assistant notifications,
 * but deliberately never calls device-control services.
 */
export class HomeSentinel {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  private readonly lastAlert = new Map<string, number>();
  private readonly journalPath = "/data/sentinel-events.jsonl";
  private readonly cooldownMs = 60 * 60 * 1000;

  constructor(
    private readonly ha: HomeAssistantClient,
    private readonly intervalSeconds = 60
  ) {}

  start(): void {
    if (this.timer) return;
    console.log(`[Sentinel] Read-only monitoring enabled (every ${this.intervalSeconds}s)`);
    void this.scan();
    this.timer = setInterval(() => void this.scan(), this.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const entities = await this.ha.getEntities();
      const windows = entities.filter(isOpenWindow);
      const heating = entities.filter(isHeating);
      for (const window of windows) {
        for (const heater of heating) {
          const key = `window-heating:${window.entity_id}:${heater.entity_id}`;
          const title = "Home Mind — fenêtre ouverte et chauffage actif";
          const message = `«${friendlyName(window)}» est ouverte et «${friendlyName(heater)}» semble chauffer. Vérifie si c’est volontaire.`;
          await this.alertOncePerCooldown(key, title, message, {
            rule: "window_heating",
            entities: [window.entity_id, heater.entity_id],
            states: [window.state, heater.state],
          });
        }
      }
    } catch (error) {
      console.warn("[Sentinel] Scan failed:", error instanceof Error ? error.message : error);
    } finally {
      this.running = false;
    }
  }

  private async alertOncePerCooldown(
    key: string,
    title: string,
    message: string,
    event: Record<string, unknown>
  ): Promise<void> {
    const now = Date.now();
    const last = this.lastAlert.get(key) ?? 0;
    if (now - last < this.cooldownMs) return;
    this.lastAlert.set(key, now);
    const record = { timestamp: new Date(now).toISOString(), key, title, message, ...event };
    try {
      await this.ha.callService("persistent_notification", "create", undefined, {
        title,
        message,
        notification_id: `home_mind_${safeId(key)}`,
      });
      await mkdir(dirname(this.journalPath), { recursive: true });
      await appendFile(this.journalPath, JSON.stringify(record) + "\n", "utf8");
      console.log("[Sentinel] Alert:", title, key);
    } catch (error) {
      // Let a later scan retry if notification delivery failed.
      this.lastAlert.delete(key);
      console.warn("[Sentinel] Could not deliver alert:", error instanceof Error ? error.message : error);
    }
  }
}

function isOpenWindow(entity: EntityState): boolean {
  if (!entity.entity_id.startsWith("binary_sensor.")) return false;
  const deviceClass = String(entity.attributes.device_class ?? "").toLowerCase();
  const id = entity.entity_id.toLowerCase();
  return entity.state === "on" && (
    deviceClass === "window" || deviceClass === "door" ||
    deviceClass === "opening" || /window|fenetre|door|porte/.test(id)
  );
}

function isHeating(entity: EntityState): boolean {
  if (entity.entity_id.startsWith("climate.")) {
    const action = String(entity.attributes.hvac_action ?? "").toLowerCase();
    return action === "heating" || (entity.state !== "off" && entity.state !== "unavailable" &&
      entity.state !== "unknown" && entity.state !== "cool" && entity.state !== "dry" && entity.state !== "fan_only");
  }
  const id = entity.entity_id.toLowerCase();
  return /^(switch|water_heater|humidifier)\./.test(entity.entity_id) &&
    entity.state === "on" && /heat|chauff|radiat|boiler|chaudiere/.test(id + " " + friendlyName(entity).toLowerCase());
}

function friendlyName(entity: EntityState): string {
  return String(entity.attributes.friendly_name ?? entity.entity_id);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 180);
}
