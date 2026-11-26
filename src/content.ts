import { isTextFile } from "./decision.ts";
import { providerAt, submitIntent } from "./providers.ts";
import type { PromptSurface } from "./providers.ts";
import { isRecord } from "./protocol.ts";
import type { InspectRequest } from "./protocol.ts";

const MAX_TEXT_BYTES = 512 * 1024;
const MAX_BATCH_FILES = 20;
const replayed = new WeakSet<Event>();
const released = new WeakSet<EventTarget>();
const inFlight = new WeakSet<EventTarget>();
const channel = "thatmyassets-dlp";
const networkReplies = new Map<string, (allow: boolean, message: string) => void>();
let adapter = providerAt(location.href);
let protectedRoute = location.href;
let surfaces: PromptSurface[] = [];
let notice: HTMLElement | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

start();

function start(): void {
  chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (isRecord(message) && message.type === "tma:coverage") sendResponse({ provider: adapter?.id ?? null, surfaces: surfaces.filter((surface) => surface.editable.isConnected).length, networkApis: adapter?.requestPaths.length ?? 0 });
  });
  refreshSurfaces();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  const observe = () => {
    if (!document.documentElement) { document.addEventListener("DOMContentLoaded", observe, { once: true }); return; }
    new MutationObserver(() => {
      if (location.href !== protectedRoute) {
        protectedRoute = location.href;
        adapter = providerAt(location.href);
      }
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(refreshSurfaces, 50);
    }).observe(document.documentElement, { subtree: true, childList: true });
  };
  observe();

  document.addEventListener("submit", (event) => {
    if (replayed.has(event)) return;
    if (event.target instanceof EventTarget && released.delete(event.target)) return;
    const surface = surfaces.find((item) => submitIntent(event, item));
    if (surface) void hold(event, surface.root, () => replaySubmit(event, surface));
  }, true);
  document.addEventListener("keydown", (event) => {
    if (replayed.has(event)) return;
    const surface = surfaces.find((item) => submitIntent(event, item));
    if (surface) void hold(event, surface.editable, () => {
      const copy = new KeyboardEvent("keydown", replayKey(event));
      replayed.add(copy);
      surface.editable.dispatchEvent(copy);
    });
  }, true);
  document.addEventListener("click", (event) => {
    if (replayed.has(event)) return;
    if (event.target instanceof EventTarget && released.delete(event.target)) return;
    const surface = surfaces.find((item) => submitIntent(event, item));
    if (surface) void hold(event, surface.submit ?? surface.root, () => surface.submit?.click());
  }, true);
  document.addEventListener("change", (event) => {
    if (!adapter) return;
    if (replayed.has(event) || !(event.target instanceof HTMLInputElement) || event.target.type !== "file") return;
    const input = event.target;
    if (!input.files?.length) return;
    void hold(event, input, () => {
      const copy = new Event("change", { bubbles: true });
      replayed.add(copy);
      input.dispatchEvent(copy);
    }, Array.from(input.files));
  }, true);
  document.addEventListener("drop", (event) => {
    if (replayed.has(event) || !(event.target instanceof Node) || !event.dataTransfer?.files.length) return;
    if (!surfaces.some((surface) => surface.root.contains(event.target as Node) || surface.editable.contains(event.target as Node))) return;
    const files = Array.from(event.dataTransfer.files);
    void hold(event, event.target, () => {
      const copy = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: event.dataTransfer, clientX: event.clientX, clientY: event.clientY });
      replayed.add(copy);
      if (!(event.target instanceof EventTarget) || !event.target.dispatchEvent(copy)) throw new Error("Provider rejected the released drop event.");
    }, files);
  }, true);
  document.addEventListener("paste", (event) => {
    if (replayed.has(event) || !(event.target instanceof Node) || !event.clipboardData?.files.length) return;
    if (!surfaces.some((surface) => surface.root.contains(event.target as Node) || surface.editable.contains(event.target as Node))) return;
    const files = Array.from(event.clipboardData.files);
    void hold(event, event.target, () => {
      const copy = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: event.clipboardData });
      replayed.add(copy);
      if (!(event.target instanceof EventTarget) || !event.target.dispatchEvent(copy)) throw new Error("Provider rejected the released paste event.");
    }, files);
  }, true);

  window.addEventListener("message", (event) => {
    if (event.source !== window || !isRecord(event.data) || event.data.source !== "tma-main" || event.data.channel !== channel) return;
    if (typeof event.data.id !== "string" || typeof event.data.prompt !== "string") return;
    const id = event.data.id;
    const timer = setTimeout(() => {
      networkReplies.delete(id);
      window.postMessage({ source: "tma-content", channel, id, allow: false, message: "Inspection timed out; request blocked." }, location.origin);
    }, 60_000);
    networkReplies.set(id, (allow, message) => {
      clearTimeout(timer);
      networkReplies.delete(id);
      window.postMessage({ source: "tma-content", channel, id, allow, message }, location.origin);
    });
    void inspect({ prompt: { text: event.data.prompt }, file: null }).then((result) => {
      networkReplies.get(id)?.(result.proceed, result.message);
    }).catch(() => networkReplies.get(id)?.(false, "Native agent unavailable."));
  });
}

function refreshSurfaces(): void {
  adapter = providerAt(location.href);
  surfaces = adapter?.discover(document) ?? [];
}

async function hold(event: Event, target: EventTarget, replay: () => void, explicitFiles?: File[]): Promise<void> {
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!adapter || location.href !== protectedRoute) {
    show("Provider route changed; submission blocked. Reload on a supported route.", "blocked");
    return;
  }
  if (inFlight.has(target)) {
    show("Inspection already in progress; submission held.", "pending");
    return;
  }
  inFlight.add(target);
  show("Inspecting locally before release…", "pending");
  try {
    const surface = surfaces.find((item) => item.root === target || item.editable === target || item.root.contains(target as Node));
    const prompt = surface?.read().trim() || "";
    if (new TextEncoder().encode(prompt).length > MAX_TEXT_BYTES) throw new Error("Prompt exceeds the 512 KiB inspection limit");
    const files = explicitFiles ?? filesFor(surface);
    const release = () => {
      if (surface?.submit) released.add(surface.submit);
      const form = surface?.editable.closest("form") ?? (surface?.root instanceof HTMLFormElement ? surface.root : null);
      if (form) released.add(form);
      replay();
    };
    if (!prompt && files.length === 0) { release(); return; }
    if (files.length > MAX_BATCH_FILES) throw new Error(`Too many files; maximum ${MAX_BATCH_FILES} per submission.`);
    const requests: Array<Pick<InspectRequest, "prompt" | "file">> = [];
    if (prompt) requests.push({ prompt: { text: prompt }, file: null });
    for (const file of files) requests.push({ prompt: null, file: { name: file.name, content_base64: await fileBase64(file) } });
    const result = await inspectBatch(requests);
    if (!result.proceed) throw new Error(result.message);
    release();
    show("Inspection complete; local release acknowledged by endpoint agent.", "allowed");
  } catch (error) {
    if (explicitFiles && event.target instanceof HTMLInputElement && event.target.type === "file") event.target.value = "";
    show(`${error instanceof Error ? error.message : "Inspection unavailable."} Action blocked.`, "blocked");
  } finally {
    inFlight.delete(target);
  }
}

function filesFor(surface: PromptSurface | undefined): File[] {
  if (!surface) return [];
  const form = surface.root.closest("form") ?? (surface.root instanceof HTMLFormElement ? surface.root : null);
  if (!form) return [];
  return Array.from(form.querySelectorAll<HTMLInputElement>("input[type='file']")).flatMap((input) => Array.from(input.files ?? []));
}

function replaySubmit(event: SubmitEvent, surface: PromptSurface): void {
  const form = event.target instanceof HTMLFormElement ? event.target : surface.editable.closest("form");
  if (form) {
    if (event.submitter instanceof HTMLElement) form.requestSubmit(event.submitter as HTMLButtonElement);
    else form.requestSubmit();
  } else {
    surface.submit?.click();
  }
}

function replayKey(event: KeyboardEvent): KeyboardEventInit {
  return { key: event.key, code: event.code, location: event.location, repeat: event.repeat, bubbles: true, cancelable: true };
}

async function inspect(item: Pick<InspectRequest, "prompt" | "file">): Promise<{ proceed: boolean; message: string }> {
  return inspectBatch([item]);
}

async function inspectBatch(items: Array<Pick<InspectRequest, "prompt" | "file">>): Promise<{ proceed: boolean; message: string }> {
  const current = adapter;
  if (!current) return { proceed: false, message: "Provider route changed during inspection." };
  const requests: InspectRequest[] = items.map((item) => ({
    type: "inspect", request_id: crypto.randomUUID(), provider: current.id, channel: "browser",
    application: /Edg\//.test(navigator.userAgent) ? "Edge" : "Chrome", ...item
  }));
  let response: unknown;
  try { response = await chrome.runtime.sendMessage({ type: "tma:inspect", requests }); }
  catch (error) { return { proceed: false, message: error instanceof Error ? error.message : "Native agent unavailable." }; }
  if (!isRecord(response)) return { proceed: false, message: "Native agent unavailable." };
  return { proceed: response.ok === true && response.proceed === true, message: typeof response.error === "string" ? response.error : response.proceed === true ? "Released after confirmed inspection." : "Blocked by DLP policy or unavailable inspection." };
}

async function fileBase64(file: File): Promise<string> {
  if (!isTextFile(file.name)) throw new Error(`${file.name}: unsupported file type. Initial enforcement accepts text formats only`);
  if (file.size > MAX_TEXT_BYTES) throw new Error(`${file.name}: exceeds the 512 KiB inspection limit`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch { throw new Error(`${file.name}: not valid UTF-8 text`); }
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function show(message: string, state: "pending" | "allowed" | "blocked"): void {
  if (!document.documentElement) return;
  if (!notice) {
    notice = document.createElement("div");
    notice.dataset.tmaIgnore = "true";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.style.cssText = "position:fixed;z-index:2147483647;right:20px;bottom:20px;max-width:360px;padding:13px 16px;border:1px solid #38463f;border-radius:8px;background:#111a15;color:#eef7f1;box-shadow:0 8px 32px #0005;font:13px/1.5 system-ui,sans-serif;white-space:normal";
    document.documentElement.append(notice);
  }
  notice.dataset.state = state;
  notice.style.borderColor = state === "blocked" ? "#c45c4b" : state === "allowed" ? "#5d9e79" : "#76877d";
  notice.textContent = `ThatMyAssets: ${message}`;
  clearTimeout(noticeTimer);
  if (state !== "pending") noticeTimer = setTimeout(() => notice?.remove(), state === "blocked" ? 12_000 : 5_000);
}
