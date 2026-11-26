import test from "node:test";
import assert from "node:assert/strict";
import { popupView, statusLabel } from "../src/popup-state.ts";
import { providerAt, type ProviderAdapter } from "../src/providers.ts";
import type { ProviderHealth } from "../src/protocol.ts";

const chatgpt = providerAt("https://chatgpt.com/")!;
const health = (state: ProviderHealth["state"], agentStatus: ProviderHealth["agentStatus"]): ProviderHealth => ({
  state, agentStatus, agentVersion: "1.2.3", policyVersion: "policy-7", checkedAt: "2026-11-27T12:00:00Z", detail: "Agent detail."
});
const view = (current: ProviderHealth, adapter: ProviderAdapter | null = chatgpt, coverageAvailable = true, editors = 1, checking = false) =>
  popupView({ health: current, adapter, coverageAvailable, editors, checking });

test("protected agent and detected controls produce full protection", () => {
  const result = view(health("protected", "protected"));
  assert.equal(result.state, "protected");
  assert.equal(result.label, "Protected");
  assert.equal(result.canInspect, true);
  assert.equal(result.route, "ChatGPT · 1 editor");
  assert.equal(result.agentVersion, "1.2.3");
  assert.equal(result.policyVersion, "policy-7");
});

test("missing or zero editors downgrades healthy agent to limited", () => {
  for (const [available, editors] of [[true, 0], [false, 0]] as const) {
    const result = view(health("protected", "protected"), chatgpt, available, editors);
    assert.equal(result.state, "limited");
    assert.equal(result.canInspect, false);
    assert.match(result.detail, /Page controls were not detected/);
  }
});

test("unsupported route is limited even when the native agent is protected", () => {
  const result = view(health("protected", "protected"), null);
  assert.equal(result.state, "limited");
  assert.match(result.detail, /outside supported routes/);
  assert.equal(result.route, "Outside supported routes");
  assert.equal(result.canInspect, false);
  assert.equal(result.providerUrl, null);
});

test("agent limited, degraded, pending, and unavailable states remain distinct", () => {
  assert.equal(view(health("limited", "limited")).state, "limited");
  assert.equal(view(health("limited", "degraded")).state, "degraded");
  assert.equal(view(health("limited", "pending_enrollment")).state, "pending");
  assert.equal(view(health("limited", "pending_enrollment")).label, "Enrollment pending");
  assert.equal(view(health("unavailable", null)).state, "unavailable");
  assert.equal(view(health("unavailable", null)).agentStatus, "Not connected");
});

test("checking takes visual priority without losing the active provider", () => {
  const result = view(health("protected", "protected"), chatgpt, false, 0, true);
  assert.equal(result.state, "pending");
  assert.equal(result.label, "Checking protection");
  assert.equal(result.detail, "Contacting the native agent…");
  assert.equal(result.route, "ChatGPT · Controls unavailable");
});

test("missing metadata and invalid check timestamps have honest fallbacks", () => {
  const result = view({ ...health("unavailable", null), agentVersion: "", policyVersion: "", checkedAt: "invalid" });
  assert.equal(result.agentVersion, "Not connected");
  assert.equal(result.policyVersion, "No policy reported");
  assert.equal(result.checkedAt, "Never");
});

test("native enrollment status has readable label", () => {
  assert.equal(statusLabel("pending_enrollment"), "Pending enrollment");
  assert.equal(statusLabel("degraded"), "Degraded");
});
