import { isRecord } from "./protocol.ts";

export type ProviderId = "chatgpt" | "claude" | "gemini" | "copilot" | "perplexity" | "grok";

export type PromptSurface = {
  root: HTMLElement;
  editable: HTMLElement;
  read: () => string;
  write: (value: string) => void;
  submit: HTMLElement | null;
  native: HTMLTextAreaElement | HTMLInputElement | null;
};

export type ProviderAdapter = {
  id: ProviderId;
  name: string;
  hosts: readonly string[];
  paths: readonly RegExp[];
  requestPaths: readonly RegExp[];
  promptRoots: readonly string[];
  nativeSubmit: readonly string[];
  discover(root: ParentNode): PromptSurface[];
};

type Spec = Omit<ProviderAdapter, "discover">;

const specs: readonly Spec[] = [
  {
    id: "chatgpt", name: "ChatGPT", hosts: ["chatgpt.com", "chat.openai.com"], paths: [/^\/(?:c\/.*)?$/],
    requestPaths: [/^\/backend-api\/(?:f\/)?conversation\/?$/],
    promptRoots: ["form:has(#prompt-textarea)", "form:has(textarea[data-testid])", "#thread-bottom-container", "main"],
    nativeSubmit: ["button[data-testid='send-button']", "button[aria-label='Send prompt']", "button[aria-label='Send message']"]
  },
  {
    id: "claude", name: "Claude", hosts: ["claude.ai"], paths: [/^\/(?:chat\/.*|new)?$/],
    requestPaths: [/^\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion\/?$/],
    promptRoots: ["fieldset:has(div[contenteditable='true'])", "form:has(div[contenteditable='true'])", "main"],
    nativeSubmit: ["button[aria-label='Send Message']", "button[aria-label='Send message']", "button[data-testid='send-button']"]
  },
  {
    id: "gemini", name: "Gemini", hosts: ["gemini.google.com"], paths: [/^\/(?:app(?:\/.*)?)?$/],
    requestPaths: [],
    promptRoots: ["form:has(div[contenteditable='true'])", ".input-area-container", "main"],
    nativeSubmit: ["button[aria-label='Send message']", "button[mattooltip='Send message']"]
  },
  {
    id: "copilot", name: "Copilot", hosts: ["copilot.microsoft.com"], paths: [/.*/],
    requestPaths: [],
    promptRoots: ["form:has(textarea)", "form:has(div[contenteditable='true'])", "main"],
    nativeSubmit: ["button[aria-label='Submit']", "button[aria-label='Send message']", "button[data-testid='send-button']"]
  },
  {
    id: "perplexity", name: "Perplexity", hosts: ["www.perplexity.ai", "perplexity.ai"], paths: [/^\/(?:search\/.*)?$/],
    requestPaths: [/^\/rest\/sse\/perplexity_ask\/?$/],
    promptRoots: ["form:has(textarea)", "form:has(div[contenteditable='true'])", "main"],
    nativeSubmit: ["button[aria-label='Submit']", "button[aria-label='Send message']"]
  },
  {
    id: "grok", name: "Grok", hosts: ["grok.com", "x.com"], paths: [/^\/(?:.*)?$/, /^\/i\/grok(?:\/.*)?$/],
    requestPaths: [/^\/rest\/app-chat\/conversations\/new\/?$/],
    promptRoots: ["form:has(textarea)", "form:has(div[contenteditable='true'])", "main"],
    nativeSubmit: ["button[aria-label='Send']", "button[aria-label='Send message']", "button[type='submit']"]
  }
];

export function providerAt(url: string): ProviderAdapter | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== "https:") return null;
  for (const spec of specs) {
    if (spec.hosts.includes(parsed.hostname) && spec.paths.some((path) => path.test(parsed.pathname))) return makeAdapter(spec);
  }
  return null;
}

export function allProviders(): readonly ProviderAdapter[] { return specs.map(makeAdapter); }

export function surfaceFrom(root: HTMLElement, editable: HTMLElement, selectors: readonly string[]): PromptSurface {
  const scopedRoot = root === editable ? (editable.closest("form") ?? editable) : root;
  return {
    root: scopedRoot,
    editable,
    read: () => editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement ? editable.value : editable.innerText,
    write: (value: string) => writeEditable(editable, value),
    native: editable instanceof HTMLTextAreaElement || editable instanceof HTMLInputElement ? editable : null,
    submit: findSubmit(scopedRoot, selectors)
  };
}

function writeEditable(node: HTMLElement, value: string): void {
  if (node instanceof HTMLTextAreaElement || node instanceof HTMLInputElement) {
    const prototype = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(node, value);
  } else {
    node.replaceChildren(document.createTextNode(value));
  }
  node.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

function findSubmit(root: HTMLElement, selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    const local = root.querySelector<HTMLElement>(selector);
    if (local) return local;
  }
  const form = root.closest("form") ?? (root instanceof HTMLFormElement ? root : null);
  if (form) {
    for (const selector of selectors) {
      const local = form.querySelector<HTMLElement>(selector);
      if (local) return local;
    }
  }
  return null;
}

function makeAdapter(spec: Spec): ProviderAdapter {
  return {
    ...spec,
    discover(root: ParentNode): PromptSurface[] {
      const found: PromptSurface[] = [];
      const seen = new Set<HTMLElement>();
      for (const selector of spec.promptRoots) {
        for (const candidate of Array.from(root.querySelectorAll<HTMLElement>(selector))) {
          const editables = Array.from(candidate.matches("textarea, input, [contenteditable='true']")
            ? [candidate]
            : candidate.querySelectorAll<HTMLElement>("textarea, input:not([type='hidden']):not([type='file']), [contenteditable='true']"));
          for (const editable of editables) {
            if (seen.has(editable) || !isUsablePrompt(editable)) continue;
            seen.add(editable);
            found.push(surfaceFrom(candidate, editable, spec.nativeSubmit));
          }
        }
      }
      return found;
    }
  };
}

export function isUsablePrompt(node: HTMLElement): boolean {
  if (node.closest("[data-tma-ignore='true']")) return false;
  if (node instanceof HTMLInputElement && (node.type !== "text" && node.type !== "search")) return false;
  if (node instanceof HTMLTextAreaElement && (node.disabled || node.readOnly)) return false;
  if (node instanceof HTMLInputElement && (node.disabled || node.readOnly)) return false;
  if (node instanceof HTMLElement && !node.isContentEditable && !(node instanceof HTMLTextAreaElement) && !(node instanceof HTMLInputElement)) return false;
  return !node.hasAttribute("disabled") && node.getAttribute("aria-disabled") !== "true" && node.getAttribute("aria-readonly") !== "true";
}

export function submitIntent(event: SubmitEvent | KeyboardEvent | MouseEvent, surface: PromptSurface): boolean {
  if (event instanceof SubmitEvent) return event.target === surface.root || event.target === surface.editable.closest("form");
  if (event instanceof KeyboardEvent) {
    return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.target === surface.editable;
  }
  return surface.submit !== null && event.target instanceof Node && surface.submit.contains(event.target);
}

export type NetworkPrompt = { matched: boolean; prompt: string | null };

export function networkPrompt(adapter: ProviderAdapter, url: string, body: string, contentType: string): NetworkPrompt {
  let parsed: URL;
  try { parsed = new URL(url, "https://route.invalid"); } catch { return { matched: false, prompt: null }; }
  if (!adapter.requestPaths.some((path) => path.test(parsed.pathname))) return { matched: false, prompt: null };
  if (!contentType.toLowerCase().includes("application/json") || new TextEncoder().encode(body).length > 512 * 1024) {
    return { matched: true, prompt: null };
  }
  try {
    const value: unknown = JSON.parse(body);
    if (!isRecord(value)) return { matched: true, prompt: null };
    if (adapter.id === "chatgpt") {
      if (!Array.isArray(value.messages)) return { matched: true, prompt: null };
      const last = value.messages[value.messages.length - 1];
      if (!isRecord(last) || !isRecord(last.content) || !Array.isArray(last.content.parts)) return { matched: true, prompt: null };
      const parts = last.content.parts.map((part: unknown) => typeof part === "string" ? part : isRecord(part) && typeof part.text === "string" ? part.text : "");
      return { matched: true, prompt: parts.some(Boolean) ? parts.join("\n") : null };
    }
    const key = adapter.id === "claude" ? "prompt" : adapter.id === "perplexity" ? "query_str" : "message";
    return { matched: true, prompt: typeof value[key] === "string" && value[key].length > 0 ? value[key] : null };
  } catch {
    return { matched: true, prompt: null };
  }
}
