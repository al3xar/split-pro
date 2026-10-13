import { type ZodType } from 'zod';

import { type ChatMsg, type ToolDef } from './llm';

export interface AgentTool {
  name: string;
  description: string;
  /** JSON schema sent to the model; defaults to a free object */
  parameters?: Record<string, unknown>;
  /** Validates the model's arguments before running */
  schema: ZodType;
  /** Returning `{ proposal }` hands the proposal to the UI instead of writing anything */
  run: (args: any) => Promise<unknown>;
}

export interface Proposal {
  toolCallId: string;
  prefill: unknown;
}

const toolMessage = (toolCallId: string, payload: unknown): ChatMsg => ({
  role: 'tool',
  tool_call_id: toolCallId,
  content: JSON.stringify(payload),
});

/**
 * Lets the model call tools until it answers in text or `maxSteps` model calls are spent.
 * Returns only the messages produced in this run.
 */
export const runAgent = async ({
  messages,
  tools,
  complete,
  maxSteps,
}: {
  messages: ChatMsg[];
  tools: AgentTool[];
  complete: (messages: ChatMsg[], tools: ToolDef[]) => Promise<ChatMsg>;
  maxSteps: number;
}): Promise<{ messages: ChatMsg[]; proposals: Proposal[]; stoppedEarly: boolean }> => {
  const defs: ToolDef[] = tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? { type: 'object', properties: {} },
  }));
  const produced: ChatMsg[] = [];
  const proposals: Proposal[] = [];

  for (let step = 0; step < maxSteps; step += 1) {
    const reply = await complete([...messages, ...produced], defs);
    const calls = reply.tool_calls ?? [];
    produced.push(
      0 < calls.length
        ? { role: 'assistant', content: reply.content ?? null, tool_calls: calls }
        : { role: 'assistant', content: reply.content ?? '' },
    );
    if (0 === calls.length) {
      return { messages: produced, proposals, stoppedEarly: false };
    }

    for (const call of calls) {
      const tool = tools.find((t) => t.name === call.function.name);
      if (!tool) {
        produced.push(toolMessage(call.id, { error: `Unknown tool ${call.function.name}` }));
        // oxlint-disable-next-line no-continue
        continue;
      }
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch {
        args = undefined;
      }
      const parsed = tool.schema.safeParse(args);
      if (!parsed.success) {
        produced.push(
          toolMessage(call.id, { error: `Invalid arguments: ${parsed.error.message}` }),
        );
        // oxlint-disable-next-line no-continue
        continue;
      }
      try {
        const result = await tool.run(parsed.data);
        if (result && 'object' === typeof result && 'proposal' in result) {
          proposals.push({
            toolCallId: call.id,
            prefill: (result as { proposal: unknown }).proposal,
          });
          produced.push(
            toolMessage(call.id, {
              status:
                'Shown to the user in the add-expense form, awaiting the user decision. Nothing was saved yet.',
            }),
          );
        } else {
          produced.push(toolMessage(call.id, result));
        }
      } catch (error) {
        produced.push(
          toolMessage(call.id, { error: error instanceof Error ? error.message : 'Tool failed' }),
        );
      }
    }
  }
  return { messages: produced, proposals, stoppedEarly: true };
};
