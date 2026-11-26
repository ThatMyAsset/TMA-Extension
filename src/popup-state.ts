import type { AgentStatus, ProviderHealth } from "./protocol.ts";
import type { ProviderAdapter } from "./providers.ts";

export type ProtectionState = "protected" | "limited" | "degraded" | "unavailable" | "pending";

export type PopupSnapshot = {
  health: ProviderHealth;
  adapter: ProviderAdapter | null;
  coverageAvailable: boolean;
  editors: number;
  checking: boolean;
};

const labels: Record<ProtectionState, string> = {
  protected: "Protected",
  limited: "Limited protection",
  degraded: "Agent degraded",
  unavailable: "Protection unavailable",
  pending: "Enrollment pending"
};
export function popupView({ health, adapter, coverageAvailable, editors, checking }: PopupSnapshot) {
  const routeUnprotected = adapter === null || !coverageAvailable || editors === 0;
  const state: ProtectionState = checking ? "pending" : health.state === "protected" && routeUnprotected ? "limited" : health.agentStatus === "pending_enrollment" ? "pending" : health.agentStatus ?? health.state;
  let route = "Outside supported routes";
  if (adapter) {
    route = coverageAvailable ? `${adapter.name} · ${editors} editor${editors === 1 ? "" : "s"}` : `${adapter.name} · Controls unavailable`;
  }
  const detail = checking ? "Contacting the native agent…" : adapter === null && health.state === "protected"
    ? `${health.detail} This page is outside supported routes; no interception is active here.`
    : routeUnprotected ? `${health.detail} Page controls were not detected. Reload this provider page before relying on interception.` : health.detail;
  const agentStatus = health.agentStatus ? statusLabel(health.agentStatus) : "Not connected";
  return {
    state,
    label: checking ? "Checking protection" : labels[state],
    detail,
    route,
    agentStatus,
    agentVersion: health.agentVersion || "Not connected",
    policyVersion: health.policyVersion || "No policy reported",
    checkedAt: health.checkedAt && Number.isFinite(Date.parse(health.checkedAt)) ? new Date(health.checkedAt).toLocaleString() : "Never",
    providerUrl: adapter ? `https://${adapter.hosts[0]}/` : null,
    canInspect: state === "protected" && adapter !== null && coverageAvailable && editors > 0
  };
}

export function statusLabel(status: AgentStatus): string {
  return status === "pending_enrollment" ? "Pending enrollment" : status[0]!.toUpperCase() + status.slice(1);
}
