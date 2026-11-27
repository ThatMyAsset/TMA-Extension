import test from "node:test";
import assert from "node:assert/strict";
import { confirmedEnforcement, interceptionDecision, isTextFile } from "../src/decision.ts";
import { isHealth, isInspection } from "../src/protocol.ts";

const base = { type: "inspection", request_id: "r", inspection_status: "complete", inspection_complete: true, decision: "allow", risk_score: 0, findings: [], policy_version: "p", event_id: "e" } as const;

test("complete allow and audit proceed; complete block stops", () => {
  assert.equal(interceptionDecision(base).proceed, true);
  assert.equal(interceptionDecision({ ...base, decision: "audit" }).proceed, true);
  assert.equal(interceptionDecision({ ...base, decision: "block" }).proceed, false);
});

test("incomplete inspection always fails closed", () => {
  for (const status of ["incomplete", "failed", "unsupported", "timeout"] as const) {
    const result = interceptionDecision({ ...base, inspection_status: status, inspection_complete: false, decision: "allow" });
    assert.equal(result.proceed, false);
    assert.equal(result.decision, "block");
  }
  assert.equal(interceptionDecision({ ...base, inspection_complete: false }).proceed, false);
});

test("confirmation cannot release a block or unacknowledged allow", () => {
  assert.deepEqual(confirmedEnforcement("allow", false), { action: "allow", acknowledged: false, status: "failed" });
  assert.deepEqual(confirmedEnforcement("block", true), { action: "block", acknowledged: true, status: "prevented" });
});

test("text allowlist excludes binaries and includes YAML", () => {
  assert.equal(isTextFile("notes.TXT"), true);
  assert.equal(isTextFile("config.yaml"), true);
  assert.equal(isTextFile("image.png"), false);
  assert.equal(isTextFile("no-extension"), false);
});

test("protocol validators reject semantic inconsistencies", () => {
  assert.equal(isInspection(base, "r"), true);
  assert.equal(isInspection({ ...base, inspection_complete: false }, "r"), false);
  assert.equal(isInspection({ ...base, risk_score: 101 }, "r"), false);
  assert.equal(isHealth({ type: "health", request_id: "h", status: "protected", agent_version: "1", policy_version: "p", connection: { enrolled: true, device_id: "device", control_plane_configured: true, control_plane_state: "connected", last_heartbeat: "2026-11-27T12:00:00Z", last_policy_sync: "2026-11-27T12:00:00Z" } }, "h"), true);
});
