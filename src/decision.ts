import type { Decision, InspectionResponse } from "./protocol.ts";

export type InterceptionDecision = {
  action: "allow" | "block";
  acknowledged: boolean;
  status: "confirmed" | "prevented" | "failed";
};

export function interceptionDecision(
  inspection: Pick<InspectionResponse, "decision" | "inspection_status" | "inspection_complete">,
  failureMode: "block" = "block"
): { decision: Decision; proceed: boolean; failure: boolean } {
  const valid = inspection.inspection_complete && inspection.inspection_status === "complete";
  const decision = valid ? inspection.decision : failureMode;
  return { decision, proceed: valid && decision !== "block", failure: !valid };
}

export function confirmedEnforcement(decision: Decision, acknowledged: boolean): InterceptionDecision {
  return {
    action: decision === "block" ? "block" : "allow",
    acknowledged,
    status: decision === "block" ? "prevented" : acknowledged ? "confirmed" : "failed"
  };
}

export function isTextFile(name: string): boolean {
  return /\.(?:txt|csv|json|xml|yaml|yml|log|env|sql|py|js|ts|go|rs)$/i.test(name);
}
