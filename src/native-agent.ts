import { isAck, isHealth, isInspection, isProviderHealth, isRecord, UNAVAILABLE } from "./protocol.ts";
import type { Ack, EnforceRequest, HealthResponse, InspectRequest, InspectionResponse, ProviderHealth } from "./protocol.ts";

const HOST = "com.thatmyassets.dlp";
const HEALTH_KEY = "agentHealth";
const HEALTH_ALARM = "agent-health";
const REQUEST_TIMEOUT_MS = 15_000;

type Pending = {
  matches: (value: unknown) => boolean;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export class NativeAgent {
  private port: chrome.runtime.Port | null = null;
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private health: ProviderHealth = UNAVAILABLE;
  private ready: Promise<void>;

  constructor() {
    this.ready = chrome.storage.local.get(HEALTH_KEY).then((stored) => {
      if (isProviderHealth(stored[HEALTH_KEY])) this.health = stored[HEALTH_KEY];
    }).catch(() => undefined);
  }

  async currentHealth(): Promise<ProviderHealth> {
    await this.ready;
    if (!this.health.checkedAt || !Number.isFinite(Date.parse(this.health.checkedAt)) || Date.now() - Date.parse(this.health.checkedAt) > 10_000) return this.checkHealth();
    return this.health;
  }

  checkHealth(): Promise<ProviderHealth> {
    return this.serialize(async () => {
      try {
        const id = crypto.randomUUID();
        const response = await this.request<HealthResponse>({ type: "health", request_id: id, browser: true }, (value) => isHealth(value, id));
        return this.saveHealth({
          state: response.status === "protected" ? "protected" : "limited",
          agentStatus: response.status,
          agentVersion: response.agent_version,
          policyVersion: response.policy_version,
          checkedAt: new Date().toISOString(),
          detail: response.connection.last_sync_error
            ? `Control Plane sync failed: ${response.connection.last_sync_error}`
            : response.connection.control_plane_state !== "connected"
              ? `Control Plane is ${response.connection.control_plane_state.replaceAll("_", " ")}; this endpoint may not appear on the Dashboard.`
              : response.status === "protected" ? "Native agent and Control Plane are connected; inspection is ready." : `Native agent reports ${response.status}; enforcement remains fail-closed.`,
          controlPlaneState: response.connection.control_plane_state,
          deviceId: response.connection.device_id,
          lastHeartbeat: response.connection.last_heartbeat,
          lastPolicySync: response.connection.last_policy_sync,
          lastSyncError: response.connection.last_sync_error ?? null
        });
      } catch (error) {
        return this.saveHealth({ ...UNAVAILABLE, checkedAt: new Date().toISOString(), detail: errorMessage(error) });
      }
    });
  }

  inspect(request: InspectRequest): Promise<{ inspection: InspectionResponse }> {
    return this.serialize(async () => {
      const inspection = await this.request<InspectionResponse>(request, (value) => isInspection(value, request.request_id));
      return { inspection };
    });
  }

  confirm(request: EnforceRequest): Promise<Ack> {
    return this.serialize(() => this.request<Ack>(request, (value) => isAck(value, request.request_id, request.event_id)));
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async request<T>(body: { request_id: string; type: string; browser?: boolean }, matches: (value: unknown) => boolean): Promise<T> {
    const id = body.request_id;
    const port = this.connect();
    const { promise, resolve, reject } = Promise.withResolvers<T>();
    const timer = setTimeout(() => {
      this.pending.delete(id);
      this.disconnect(new Error("Native agent request timed out."));
      reject(new Error("Native agent request timed out."));
    }, REQUEST_TIMEOUT_MS);
    this.pending.set(id, { matches, resolve: resolve as (value: unknown) => void, reject, timer });
    try { port.postMessage(body); } catch (error) {
      clearTimeout(timer);
      this.pending.delete(id);
      reject(error instanceof Error ? error : new Error(String(error)));
    }
    return promise;
  }

  private connect(): chrome.runtime.Port {
    if (this.port) return this.port;
    const port = chrome.runtime.connectNative(HOST);
    this.port = port;
    port.onMessage.addListener((value: unknown) => {
      if (!isRecord(value) || typeof value.request_id !== "string") return;
      const entry = this.pending.get(value.request_id);
      if (!entry) return;
      this.pending.delete(value.request_id);
      clearTimeout(entry.timer);
      if (entry.matches(value)) entry.resolve(value);
      else entry.reject(new Error("Native agent returned an invalid or inconsistent response."));
    });
    port.onDisconnect.addListener(() => {
      const message = chrome.runtime.lastError?.message || "Native agent disconnected.";
      this.disconnect(new Error(message));
      void this.saveHealth({ ...UNAVAILABLE, checkedAt: new Date().toISOString(), detail: message });
    });
    return port;
  }

  private disconnect(error: Error): void {
    const port = this.port;
    this.port = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    if (port) {
      try { port.disconnect(); } catch { /* already disconnected */ }
    }
  }

  private async saveHealth(health: ProviderHealth): Promise<ProviderHealth> {
    this.health = health;
    try { await chrome.storage.local.set({ [HEALTH_KEY]: health }); } catch { /* live status still returned */ }
    return health;
  }
}

export function startNativeHealth(agent: NativeAgent): void {
  void agent.checkHealth();
  chrome.alarms.create(HEALTH_ALARM, { periodInMinutes: 0.5 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === HEALTH_ALARM) void agent.checkHealth();
  });
  chrome.runtime.onStartup.addListener(() => void agent.checkHealth());
  chrome.runtime.onInstalled.addListener(() => void agent.checkHealth());
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Native agent unavailable.";
}
