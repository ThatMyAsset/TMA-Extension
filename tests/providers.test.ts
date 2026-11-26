import test from "node:test";
import assert from "node:assert/strict";
import { allProviders, networkPrompt, providerAt } from "../src/providers.ts";

test("recognizes only HTTPS supported routes", () => {
  assert.equal(providerAt("https://chatgpt.com/c/abc")?.id, "chatgpt");
  assert.equal(providerAt("https://claude.ai/chat/abc")?.id, "claude");
  assert.equal(providerAt("https://gemini.google.com/app")?.id, "gemini");
  assert.equal(providerAt("https://copilot.microsoft.com/")?.id, "copilot");
  assert.equal(providerAt("https://www.perplexity.ai/search/test")?.id, "perplexity");
  assert.equal(providerAt("https://x.com/i/grok")?.id, "grok");
  assert.equal(providerAt("http://chatgpt.com/"), null);
  assert.equal(providerAt("https://notchatgpt.com/"), null);
  assert.equal(providerAt("https://chatgpt.com.evil.test/"), null);
  assert.equal(providerAt("https://claude.ai/settings"), null);
});

test("provides all six adapters without shared route state", () => {
  assert.deepEqual(allProviders().map((provider) => provider.id), ["chatgpt", "claude", "gemini", "copilot", "perplexity", "grok"]);
});

test("extracts only known prompt request shapes", () => {
  const chatgpt = providerAt("https://chatgpt.com/")!;
  assert.deepEqual(networkPrompt(chatgpt, "/backend-api/conversation", JSON.stringify({ messages: [{ content: { parts: ["hello", { text: "world" }] } }] }), "application/json"), { matched: true, prompt: "hello\nworld" });
  assert.equal(networkPrompt(chatgpt, "/backend-api/conversation", "not-json", "application/json").prompt, null);
  assert.equal(networkPrompt(chatgpt, "/backend-api/conversation", "{}", "application/json").prompt, null);
  assert.equal(networkPrompt(chatgpt, "/api/auth/session", "{}", "application/json").matched, false);
  const claude = providerAt("https://claude.ai/chat/new")!;
  assert.equal(networkPrompt(claude, "/api/organizations/o/chat_conversations/c/completion", JSON.stringify({ prompt: "secret" }), "application/json").prompt, "secret");
  const perplexity = providerAt("https://www.perplexity.ai/")!;
  assert.equal(networkPrompt(perplexity, "/rest/sse/perplexity_ask", JSON.stringify({ query_str: "question" }), "application/json").prompt, "question");
});
