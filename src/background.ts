import { interceptionDecision } from "./decision.ts";
import { errorMessage, NativeAgent, startNativeHealth } from "./native-agent.ts";
import { isRecord } from "./protocol.ts";
import type { EnforceRequest, InspectRequest, InspectionResponse } from "./protocol.ts";

const agent = new NativeAgent();
startNativeHealth(agent);

type InspectMessage = { type: "tma:inspect"; requests: InspectRequest[] };
type HealthMessage = { type: "tma:health"; refresh?: boolean };
type Message = InspectMessage | HealthMessage;
type InspectionResult = { ok: boolean; proceed: boolean; error?: string };

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (!isRecord(message)) return false;
  if (message.type === "tma:health") {
    void ((message as HealthMessage).refresh ? agent.checkHealth() : agent.currentHealth()).then((health) => sendResponse({ ok: true, health }));
    return true;
  }
  if (message.type !== "tma:inspect") return false;
  const requests = (message as InspectMessage).requests;
  void inspectAndConfirm(requests).then(sendResponse).catch((error) => {
    sendResponse({ ok: false, proceed: false, error: errorMessage(error) });
  });
  return true;
});

async function inspectAndConfirm(requests: InspectRequest[]): Promise<InspectionResult> {
  if (!Array.isArray(requests) || requests.length === 0 || requests.length > 20 || requests.some((request) => !validInspectRequest(request))) {
    return { ok: false, proceed: false, error: "Invalid inspection batch." };
  }
  const inspections: InspectionResponse[] = [];
  try {
    for (const request of requests) inspections.push((await agent.inspect(request)).inspection);
  } catch (error) {
    return { ok: false, proceed: false, error: errorMessage(error) };
  }
  const blocked = inspections.some((inspection) => !interceptionDecision(inspection).proceed);
  for (const inspection of inspections) {
    const enforcement: EnforceRequest = {
      type: "enforcement_result",
      request_id: crypto.randomUUID(),
      event_id: inspection.event_id,
      enforcement_status: blocked ? "prevented" : "confirmed",
      enforcement_confirmed: true
    };
    try {
      const acknowledgement = await agent.confirm(enforcement);
      if (!acknowledgement.accepted) return { ok: false, proceed: false, error: "Endpoint agent rejected enforcement acknowledgement." };
    } catch (error) {
      return { ok: false, proceed: false, error: errorMessage(error) };
    }
  }
  return blocked
    ? { ok: false, proceed: false, error: "Sensitive content blocked by policy or incomplete inspection." }
    : { ok: true, proceed: true };
}

function validInspectRequest(request: InspectRequest): boolean {
  if (!isRecord(request) || request.type !== "inspect" || typeof request.request_id !== "string" || request.channel !== "browser") return false;
  if (request.application !== "Chrome" && request.application !== "Edge") return false;
  if (!["chatgpt", "claude", "gemini", "copilot", "perplexity", "grok"].includes(request.provider)) return false;
  const hasFile = isRecord(request.file) && typeof request.file.name === "string" && typeof request.file.content_base64 === "string";
  const hasPrompt = isRecord(request.prompt) && typeof request.prompt.text === "string";
  return (hasFile || hasPrompt) && hasFile !== hasPrompt;
}
