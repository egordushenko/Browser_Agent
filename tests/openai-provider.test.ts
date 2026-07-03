import { describe, expect, test } from "vitest";
import { OpenAIProvider, type OpenAIResponsesClient } from "../src/llm/openai.js";

describe("OpenAIProvider", () => {
  test("maps Responses API function_call output into a ToolCall", async () => {
    const requests: unknown[] = [];
    const client: OpenAIResponsesClient = {
      responses: {
        create: async (request) => {
          requests.push(request);
          return {
            output: [
              {
                type: "function_call",
                call_id: "call-abc",
                name: "navigate",
                arguments: "{\"url\":\"https://example.com\"}",
              },
            ],
            usage: {
              input_tokens: 11,
              output_tokens: 7,
              total_tokens: 18,
            },
          };
        },
      },
    };

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-test",
      client,
    });

    const response = await provider.complete({
      system: "system prompt",
      messages: [{ role: "user", content: "open example.com" }],
      tools: [
        {
          type: "function",
          name: "navigate",
          description: "Navigate",
          strict: true,
          parameters: {
            type: "object",
            properties: { url: { type: "string" } },
            required: ["url"],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ tool_choice: "required" });
    expect(response).toEqual({
      toolCall: {
        id: "call-abc",
        name: "navigate",
        arguments: { url: "https://example.com" },
      },
      usage: {
        inputTokens: 11,
        outputTokens: 7,
        totalTokens: 18,
      },
    });
  });

  test("throws when the provider returns an in-body error (OpenRouter 200 error shape)", async () => {
    const client: OpenAIResponsesClient = {
      responses: {
        create: async () => ({
          error: { code: "rate_limit_exceeded", message: "Request too large for gpt-5.4" },
          output: [],
          usage: null as never,
        }),
      },
    };
    const provider = new OpenAIProvider({ apiKey: "test-key", model: "openai/gpt-5.4", client });

    await expect(
      provider.complete({ system: "s", messages: [{ role: "user", content: "hi" }], tools: [] }),
    ).rejects.toThrow(/Request too large for gpt-5.4/);
  });

  test("omits the tools field when no tools are provided", async () => {
    const requests: Record<string, unknown>[] = [];
    const client: OpenAIResponsesClient = {
      responses: {
        create: async (request) => {
          requests.push(request as Record<string, unknown>);
          return {
            output_text: "{\"answer\":\"No selector\",\"confidence\":\"low\"}",
            output: [],
            usage: {
              input_tokens: 3,
              output_tokens: 2,
              total_tokens: 5,
            },
          };
        },
      },
    };

    const provider = new OpenAIProvider({
      apiKey: "test-key",
      model: "gpt-test",
      client,
    });

    await provider.complete({
      system: "system prompt",
      messages: [{ role: "user", content: "read compact DOM" }],
      tools: [],
    });

    expect(requests[0]).not.toHaveProperty("tools");
  });
});
