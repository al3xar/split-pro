/** Minimal OpenAI-compatible chat client (vLLM, Ollama, LM Studio, OpenAI…) with tool calling. */

export interface LlmConfig {
  baseUrl: string;
  apiKey?: string;
  model: string;
  timeoutMs?: number;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export const chatCompletion = async (
  config: LlmConfig,
  messages: ChatMsg[],
  tools: ToolDef[],
  fetchImpl: typeof fetch = fetch,
): Promise<ChatMsg> => {
  const response = await fetchImpl(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.2,
      ...(0 < tools.length
        ? {
            tools: tools.map((tool) => ({ type: 'function', function: tool })),
            tool_choice: 'auto',
          }
        : {}),
    }),
    signal: AbortSignal.timeout(config.timeoutMs ?? 60_000),
  });
  if (!response.ok) {
    throw new Error(`LLM_HTTP_${response.status}`);
  }
  const json = (await response.json()) as { choices?: { message?: ChatMsg }[] };
  const message = json.choices?.[0]?.message;
  if (!message) {
    throw new Error('LLM_EMPTY_RESPONSE');
  }
  return message;
};
