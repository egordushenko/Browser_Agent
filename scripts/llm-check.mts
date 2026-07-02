import { loadConfig } from "../src/config.js";
import { getToolSchemas } from "../src/agent/tools.js";
import { OpenAIProvider } from "../src/llm/openai.js";

const config = loadConfig(process.env, [], process.cwd());
console.log("baseUrl:", config.llm.baseUrl ?? "(default OpenAI)");
console.log("orchestratorModel:", config.llm.orchestratorModel);
console.log("domModel:", config.llm.subAgentModel);
console.log("apiKey set:", Boolean(config.llm.apiKey), "prefix:", config.llm.apiKey?.slice(0, 6));

if (!config.llm.apiKey) {
  process.exit(1);
}

const provider = new OpenAIProvider({
  apiKey: config.llm.apiKey,
  baseUrl: config.llm.baseUrl,
  model: config.llm.orchestratorModel,
});

function dump(e: unknown): string {
  const err = e as { message?: string; status?: number; code?: string; error?: unknown };
  return JSON.stringify({ message: err?.message, status: err?.status, code: err?.code, error: err?.error }, null, 2);
}

try {
  const res = await provider.complete({
    system: "You are a connectivity test.",
    messages: [{ role: "user", content: "Reply with the single word: ok" }],
    tools: [],
  });
  console.log("no-tools call OK:", res.text?.slice(0, 60), res.usage);
} catch (e) {
  console.log("no-tools call FAILED:", dump(e));
}

try {
  const res = await provider.complete({
    system: "You are a browser orchestrator test.",
    messages: [{ role: "user", content: "Navigate to https://example.com" }],
    tools: getToolSchemas(),
  });
  console.log("tools call OK:", JSON.stringify(res.toolCall) ?? res.text?.slice(0, 60));
} catch (e) {
  console.log("tools call FAILED:", dump(e));
}
