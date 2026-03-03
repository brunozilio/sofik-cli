import type { LLMProvider, StreamParams } from "./types.ts";
import { AnthropicProvider } from "./anthropic.ts";
import { CopilotProvider } from "./copilot.ts";

export type { LLMProvider, StreamParams };

const PROVIDERS: LLMProvider[] = [
  new AnthropicProvider(),
  new CopilotProvider(),
];

export function getProvider(model: string): LLMProvider {
  const provider = PROVIDERS.find((p) => p.supportsModel(model));
  if (!provider) {
    throw new Error(
      `No provider found for model "${model}".\n` +
      `Available providers: ${PROVIDERS.map((p) => p.name).join(", ")}`
    );
  }
  return provider;
}

export async function* streamResponse(params: StreamParams): AsyncGenerator<string> {
  const provider = getProvider(params.model);
  yield* provider.stream(params);
}
