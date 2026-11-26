import type { ProviderId } from "./providers.ts";

export type Decision = "block" | "audit" | "allow";
export type EnforcementStatus = "pending" | "confirmed" | "prevented" | "failed" | "not_required";
export type InspectionStatus = "complete" | "incomplete" | "failed" | "unsupported" | "timeout";
export type AgentStatus = "protected" | "limited" | "degraded" | "pending_enrollment";
export type Finding = { category: string; severity: "low" | "medium" | "high" | "critical"; detector: string };

export type HealthResponse = {
  type: "health";
  request_id: string;
  status: AgentStatus;
  agent_version: string;
  policy_version: string;
};

export type InspectionResponse = {
  type: "inspection";
  request_id: string;
  inspection_status: InspectionStatus;
  inspection_complete: boolean;
  decision: Decision;
  risk_score: number;
  findings: Finding[];
  policy_version: string;
  event_id: string;
};

export type InspectRequest = {
  type: "inspect";
  request_id: string;
  provider: ProviderId;
  channel: "browser";
  application: "Chrome" | "Edge";
  file: { name: string; content_base64: string } | null;
  prompt: { text: string } | null;
};

export type Ack = { type: "enforcement_result_ack"; request_id: string; event_id: string; accepted: boolean };

export type EnforceRequest = {
  type: "enforcement_result";
  request_id: string;
  event_id: string;
  enforcement_status: EnforcementStatus;
  enforcement_confirmed: boolean;
};

export type ProviderHealth = {
  state: "protected" | "limited" | "unavailable";
  agentStatus: AgentStatus | null;
  agentVersion: string;
  policyVersion: string;
  checkedAt: string;
  detail: string;
};

export const UNAVAILABLE: ProviderHealth = {
  state: "unavailable", agentStatus: null, agentVersion: "", policyVersion: "", checkedAt: "",
  detail: "Native agent not connected. Supported routes block prompts and file uploads."
};

export function isHealth(value: unknown, requestId: string): value is HealthResponse {
  if (!isRecord(value)) return false;
  return value.type === "health" && value.request_id === requestId &&
    ["protected", "limited", "degraded", "pending_enrollment"].includes(String(value.status)) &&
    typeof value.agent_version === "string" && typeof value.policy_version === "string";
}

export function isInspection(value: unknown, requestId: string): value is InspectionResponse {
  if (!isRecord(value)) return false;
  if (value.type !== "inspection" || value.request_id !== requestId || !isDecision(value.decision)) return false;
  if (!["complete", "incomplete", "failed", "unsupported", "timeout"].includes(String(value.inspection_status))) return false;
  if (typeof value.inspection_complete !== "boolean" || value.inspection_complete !== (value.inspection_status === "complete")) return false;
  if (typeof value.risk_score !== "number" || value.risk_score < 0 || value.risk_score > 100 || !Number.isFinite(value.risk_score)) return false;
  if (typeof value.policy_version !== "string" || typeof value.event_id !== "string" || !value.event_id || !Array.isArray(value.findings)) return false;
  return value.findings.every((finding) => isRecord(finding) && typeof finding.category === "string" &&
    ["low", "medium", "high", "critical"].includes(String(finding.severity)) && typeof finding.detector === "string");
}

export function isAck(value: unknown, requestId: string, eventId: string): value is Ack {
  return isRecord(value) && value.type === "enforcement_result_ack" && value.request_id === requestId &&
    value.event_id === eventId && value.accepted === true;
}

export function isProviderHealth(value: unknown): value is ProviderHealth {
  return isRecord(value) && ["protected", "limited", "unavailable"].includes(String(value.state)) &&
    (value.agentStatus === null || ["protected", "limited", "degraded", "pending_enrollment"].includes(String(value.agentStatus))) &&
    typeof value.agentVersion === "string" && typeof value.policyVersion === "string" &&
    typeof value.checkedAt === "string" && typeof value.detail === "string";
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isDecision(value: unknown): value is Decision {
  return value === "block" || value === "audit" || value === "allow";
}
