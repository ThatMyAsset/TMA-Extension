import { networkPrompt, providerAt } from "./providers.ts";

const channel = "thatmyassets-dlp";
const originalFetch = window.fetch;
const originalOpen = XMLHttpRequest.prototype.open;
const originalSend = XMLHttpRequest.prototype.send;
const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;
const pending = new Map<string, { resolve: (allow: boolean) => void; message: string }>();
const requestUrls = new WeakMap<XMLHttpRequest, string>();
const requestHeaders = new WeakMap<XMLHttpRequest, Record<string, string>>();

window.addEventListener("message", (event) => {
  if (event.source !== window || !event.data || event.data.source !== "tma-content" || event.data.channel !== channel) return;
  const entry = pending.get(event.data.id);
  if (!entry) return;
  pending.delete(event.data.id);
  entry.message = typeof event.data.message === "string" ? event.data.message : "Request blocked.";
  entry.resolve(event.data.allow === true);
});

window.fetch = async function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const adapter = providerAt(location.href);
  if (!adapter) return originalFetch.call(this, input, init);
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = init?.method || (input instanceof Request ? input.method : "GET");
  if (method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD") return originalFetch.call(this, input, init);
  let pathname: string;
  try { pathname = new URL(url, location.href).pathname; } catch { return originalFetch.call(this, input, init); }
  if (!adapter.requestPaths.some((path) => path.test(pathname))) return originalFetch.call(this, input, init);
  try {
    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const body = init?.body !== undefined ? await bodyText(init.body) : input instanceof Request ? await input.clone().text() : "";
    const match = networkPrompt(adapter, url, body, headers.get("content-type") || "");
    if (match.matched) {
      if (!match.prompt) throw new Error("Unrecognized prompt payload on a protected provider route.");
      const allowed = await authorize(match.prompt);
      if (!allowed) throw new Error("Prompt request blocked by ThatMyAssets DLP.");
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes("ThatMyAssets")) throw new TypeError(error.message);
    if (error instanceof Error && error.message.includes("Unrecognized prompt")) throw new TypeError(error.message);
    throw error;
  }
  return originalFetch.call(this, input, init);
};

XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
  requestUrls.set(this, String(url));
  if (async === undefined) originalOpen.call(this, method, url, true);
  else originalOpen.call(this, method, url, async, username, password);
};
XMLHttpRequest.prototype.setRequestHeader = function(name: string, value: string) {
  requestHeaders.set(this, { ...requestHeaders.get(this), [name.toLowerCase()]: value });
  originalSetHeader.call(this, name, value);
};
XMLHttpRequest.prototype.send = function(body?: Document | XMLHttpRequestBodyInit | null) {
  const adapter = providerAt(location.href);
  if (!adapter) { originalSend.call(this, body); return; }
  const url = requestUrls.get(this) || "";
  let pathname: string;
  try { pathname = new URL(url, location.href).pathname; } catch { originalSend.call(this, body); return; }
  if (!adapter.requestPaths.some((path) => path.test(pathname))) { originalSend.call(this, body); return; }
  const headers = requestHeaders.get(this) || {};
  void bodyText(body ?? "").then(async (text) => {
    const match = networkPrompt(adapter, new URL(url, location.href).href, text, headers["content-type"] || "");
    if (match.matched) {
      if (!match.prompt || !(await authorize(match.prompt))) {
        this.dispatchEvent(new ProgressEvent("error"));
        this.dispatchEvent(new ProgressEvent("loadend"));
        return;
      }
    }
    originalSend.call(this, body);
  }).catch(() => {
    this.dispatchEvent(new ProgressEvent("error"));
    this.dispatchEvent(new ProgressEvent("loadend"));
  });
};

async function authorize(prompt: string): Promise<boolean> {
  const id = crypto.randomUUID();
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const entry = { resolve, message: "" };
  pending.set(id, entry);
  window.postMessage({ source: "tma-main", channel, id, prompt }, location.origin);
  return promise;
}

async function bodyText(body: unknown): Promise<string> {
  if (typeof body === "string") return body;
  if (body instanceof Blob) return body.text();
  if (body instanceof URLSearchParams) return body.toString();
  if (body instanceof ArrayBuffer) return new TextDecoder().decode(body);
  if (ArrayBuffer.isView(body)) return new TextDecoder().decode(body);
  if (body instanceof FormData) throw new TypeError("ThatMyAssets cannot inspect multipart network uploads on this route; use the protected file control.");
  if (body instanceof ReadableStream) throw new TypeError("ThatMyAssets cannot inspect streaming request bodies.");
  return body == null ? "" : String(body);
}
