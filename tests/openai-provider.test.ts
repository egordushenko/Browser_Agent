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
});
