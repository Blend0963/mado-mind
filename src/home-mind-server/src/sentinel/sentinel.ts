import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { HomeAssistantClient, EntityState } from "../ha/client.js";

export interface SentinelEvent {
  id: string;
  entityId: string;
  name: string;
  previousState: string;
  state: string;
  changedAt: string;
}

interface SentinelOptions {
  enabled: boolean;
  entities: string[];
  intervalSeconds: number;
  journalPath: string;
  notifyService?: string;
}

export class HomeMindSentinel {
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly previous = new Map<string, string>();
  private readonly recentAlerts = new Map<string, number>();
  private running = false;
  private lastPollAt: string | null = null;
  private lastError: string | null = null;

  constructor(private readonly ha: HomeAssistantClient, private readonly options: SentinelOptions) {}

  start(): void {
    if (!this.options.enabled || this.timer) return;
    console.log(`Sentinelle: active, ${this.options.entities.length} entité(s), intervalle ${this.options.intervalSeconds}s`);
    void this.poll(true);
    this.timer = setInterval(() => void this.poll(false), this.options.intervalSeconds * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  status() {
    return {
      enabled: this.options.enabled,
      watchedEntities: this.options.entities,
      intervalSeconds: this.options.intervalSeconds,
      lastPollAt: this.lastPollAt,
      lastError: this.lastError,
      mode: "observe-only",
    };
  }

  async recentEvents(limit = 50): Promise<SentinelEvent[]> {
    try {
      const content = await readFile(this.options.journalPath, "utf8");
      return content.split("\n").filter(Boolean).slice(-Math.max(1, Math.min(limit, 200)))
        .reverse().flatMap((line) => {
          try { return [JSON.parse(line) as SentinelEvent]; } catch { return []; }
        });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private async poll(initial: boolean): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const states = await this.ha.getEntities();
      const byId = new Map(states.map((state) => [state.entity_id, state]));
      const watched = this.options.entities.length
        ? this.options.entities.map((id) => byId.get(id)).filter((s): s is EntityState => Boolean(s))
        : [];
      for (const state of watched) {
        const previousState = this.previous.get(state.entity_id);
        this.previous.set(state.entity_id, state.state);
        if (previousState === undefined || previousState === state.state) continue;
        const event: SentinelEvent = {
          id: `${Date.now()}-${state.entity_id}`,
          entityId: state.entity_id,
          name: String(state.attributes.friendly_name ?? state.entity_id),
          previousState,
          state: state.state,
          changedAt: new Date().toISOString(),
        };
        await mkdir(dirname(this.options.journalPath), { recursive: true });
        await appendFile(this.options.journalPath, JSON.stringify(event) + "\n", "utf8");
        await this.notifyIfNeeded(event);
      }
      this.lastPollAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      console.warn("Sentinelle: lecture Home Assistant impossible:", this.lastError);
    } finally {
      this.running = false;
    }
  }

  private async notifyIfNeeded(event: SentinelEvent): Promise<void> {
    const service = this.options.notifyService?.trim();
    if (!service) return;
    const now = Date.now();
    const last = this.recentAlerts.get(event.entityId) ?? 0;
    if (now - last < 15 * 60 * 1000) return;
    this.recentAlerts.set(event.entityId, now);
    const split = service.split(".", 2);
    if (split.length !== 2 || split[0] !== "notify" || !split[1]) {
      console.warn("Sentinelle: service de notification invalide; attendu notify.nom_du_service");
      return;
    }
    try {
      await this.ha.callService("notify", split[1], undefined, {
        title: "Home Mind — changement détecté",
        message: `${event.name} : ${event.previousState} → ${event.state}`,
      });
    } catch (error) {
      console.warn("Sentinelle: notification non envoyée:", error instanceof Error ? error.message : error);
    }
  }
}
