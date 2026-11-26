import { isProviderHealth, isRecord, UNAVAILABLE } from "./protocol.ts";
import { allProviders, providerAt } from "./providers.ts";
import { popupView } from "./popup-state.ts";
import type { ProviderAdapter } from "./providers.ts";
import type { ProviderHealth } from "./protocol.ts";

const refresh = document.querySelector<HTMLButtonElement>("#refresh")!;
const providerLink = document.querySelector<HTMLAnchorElement>("#provider-link")!;
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>("[role=tab]"));
let loading = false;

for (const provider of allProviders()) {
  const item = document.createElement("li");
  item.innerHTML = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2 17 5v5c0 4.4-2.8 7.2-7 8-4.2-.8-7-3.6-7-8V5Z"/><path d="m6.5 10 2.2 2.2 4.8-5"/></svg>';
  item.append(document.createTextNode(provider.name));
  document.querySelector("#provider-list")!.append(item);
}

refresh.addEventListener("click", () => void load(true));
for (const tab of tabs) {
  tab.addEventListener("click", () => selectTab(tab));
  tab.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (tabs.indexOf(tab) + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    selectTab(tabs[index]!);
    tabs[index]!.focus();
  });
}
void load(false);

async function load(force: boolean): Promise<void> {
  if (loading) return;
  loading = true;
  refresh.disabled = true;
  refresh.setAttribute("aria-busy", "true");
  render(UNAVAILABLE, null, false, 0, true);
  let adapter: ProviderAdapter | null = null;
  let editors = 0;
  let coverageAvailable = false;
  let health: ProviderHealth = UNAVAILABLE;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    adapter = tab?.url ? providerAt(tab.url) : null;
    const coveragePromise = readCoverage(tab?.id, adapter).then((coverage) => {
      editors = coverage.editors;
      coverageAvailable = coverage.available;
    });
    try {
      const response: unknown = await chrome.runtime.sendMessage({ type: "tma:health", refresh: force });
      if (isRecord(response) && response.ok === true && isProviderHealth(response.health)) health = response.health;
    } catch {
      health = UNAVAILABLE;
    }
    await coveragePromise;
  } catch {
    health = UNAVAILABLE;
  }
  render(health, adapter, coverageAvailable, editors, false);
  text("#announcement", `Status refreshed. ${document.querySelector("#state")?.textContent ?? ""}.`);
  loading = false;
  refresh.disabled = false;
  refresh.removeAttribute("aria-busy");
}

async function readCoverage(tabId: number | undefined, adapter: ProviderAdapter | null): Promise<{ editors: number; available: boolean }> {
  if (!adapter || tabId === undefined) return { editors: 0, available: false };
  try {
    const coverage: unknown = await chrome.tabs.sendMessage(tabId, { type: "tma:coverage" });
    if (isRecord(coverage) && coverage.provider === adapter.id && typeof coverage.surfaces === "number" && Number.isInteger(coverage.surfaces) && coverage.surfaces >= 0) {
      return { editors: coverage.surfaces, available: true };
    }
  } catch { /* restricted pages and stale provider controls have no coverage response */ }
  return { editors: 0, available: false };
}

function render(health: ProviderHealth, adapter: ProviderAdapter | null, coverageAvailable: boolean, editors: number, checking: boolean): void {
  const view = popupView({ health, adapter, coverageAvailable, editors, checking });
  text("#state", view.label);
  text("#detail", view.detail);
  text("#route", view.route);
  text("#agent-status", checking ? "Checking" : view.agentStatus);
  text("#version", view.agentVersion);
  text("#policy", view.policyVersion);
  text("#checked", view.checkedAt);
  document.querySelector("#status-card")!.setAttribute("data-state", view.state);
  providerLink.hidden = view.providerUrl === null;
  if (view.providerUrl) {
    providerLink.href = view.providerUrl;
    providerLink.setAttribute("aria-label", `Open ${adapter!.name} in a new tab`);
  } else {
    providerLink.removeAttribute("href");
  }
}

function selectTab(selected: HTMLButtonElement): void {
  for (const tab of tabs) {
    const active = tab === selected;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    document.getElementById(tab.getAttribute("aria-controls")!)!.hidden = !active;
  }
}

function text(selector: string, value: string): void {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}
