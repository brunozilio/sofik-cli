/**
 * Non-interactive run mode: execute a single prompt and stream output to stdout.
 * Used when a positional argument or --print flag is provided.
 */
import { createClient, streamResponse } from "./anthropic.ts";
import { getAllTools } from "../tools/index.ts";
import type { Message } from "./types.ts";

export async function runOnce(prompt: string): Promise<void> {
  const client = createClient();
  const tools = getAllTools();
  const messages: Message[] = [{ role: "user", content: prompt }];

  const stream = streamResponse(
    client,
    messages,
    tools,
    async (toolName, _input) => {
      process.stderr.write(`[${toolName}]\n`);
    },
    (result) => {
      if (result.is_error) {
        process.stderr.write(`[Error] ${result.content.slice(0, 200)}\n`);
      }
    }
  );

  for await (const chunk of stream) {
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
}
