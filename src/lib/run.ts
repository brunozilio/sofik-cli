/**
 * Non-interactive run mode: execute a single prompt and stream output to stdout.
 * Used when a positional argument or --print flag is provided.
 */
import { createClient, streamResponse } from "./anthropic.ts";
import { getAllTools } from "../tools/index.ts";
import type { Message } from "./types.ts";
import { logger } from "./logger.ts";

export async function runOnce(prompt: string): Promise<void> {
  const t0 = Date.now();
  logger.app.info("runOnce iniciado", { promptLength: prompt.length });

  const client = createClient();
  const tools = getAllTools();
  const messages: Message[] = [{ role: "user", content: prompt }];

  const stream = streamResponse(
    client,
    messages,
    tools,
    async (toolName, _input) => {
      logger.tool.info("runOnce ferramenta invocada", { toolName });
      process.stderr.write(`[${toolName}]\n`);
    },
    (result) => {
      if (result.is_error) {
        logger.tool.error("runOnce erro de ferramenta", { contentPreview: result.content.slice(0, 200) });
        process.stderr.write(`[Error] ${result.content.slice(0, 200)}\n`);
      }
    }
  );

  let outputLength = 0;
  for await (const chunk of stream) {
    outputLength += chunk.length;
    process.stdout.write(chunk);
  }
  process.stdout.write("\n");
  logger.app.info("runOnce concluído", { outputLength, durationMs: Date.now() - t0 });
}
