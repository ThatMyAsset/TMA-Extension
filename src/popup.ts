import { isProviderHealth, isRecord } from "./protocol.ts";
import { providerAt } from "./providers.ts";
import type { ProviderHealth } from "./protocol.ts";

const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
refresh.addEventListener("click", () => void load(true));
void load(false);

async function load(force: boolean): Promise<void> {
  refresh.disabled = true;
  text("#state", force ? "Checking endpoint" : "Reading endpoint status");
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const adapter = tab?.url ? providerAt(tab.url) : null;
  let editors = 0;
  let coverageAvailable = false;
  if (adapter && tab?.id !== undefined) {
    try {
      const coverage: unknown = await chrome.tabs.sendMessage(tab.id, { type: "tma:coverage" });
      if (isRecord(coverage) && coverage.provider === adapter.id && typeof coverage.surfaces === "number") {
        editors = coverage.surfaces;
        coverageAvailable = true;
      }
    } catch { coverageAvailable = false; }
  }
  text("#route", adapter ? coverageAvailable ? `${adapter.name} · ${editors} editor${editors === 1 ? "" : "s"} detected` : `${adapter.name} · controls unavailable` : "Unsupported route");
  let health: ProviderHealth = { state: "unavailable", agentStatus: null, agentVersion: "", policyVersion: "", checkedAt: "", detail: "Native agent not connected." };
  try {
    const response: unknown = await chrome.runtime.sendMessage({ type: "tma:health", refresh: force });
    if (isRecord(response) && response.ok === true && isProviderHealth(response.health)) health = response.health;
  } catch (error) {
    health.detail = error instanceof Error ? error.message : "Native agent unavailable.";
  }
  const routeUnprotected = adapter !== null && (!coverageAvailable || editors === 0);
  const state = health.state === "protected" && routeUnprotected ? "limited" : health.state;
  text("#state", state === "protected" ? "Agent protected" : state === "limited" ? "Limited protection" : "Protection unavailable");
  text("#detail", routeUnprotected ? `${health.detail} Current page controls are not detected; do not rely on prompt interception until the provider page reloads successfully.` : health.detail);
  text("#version", health.agentVersion || "Not connected");
  text("#policy", health.policyVersion || "No policy reported");
  text("#checked", health.checkedAt ? new Date(health.checkedAt).toLocaleString() : "Never");
  document.querySelector("#dot")?.setAttribute("data-state", health.state);
  refresh.disabled = false;
}

function text(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}
