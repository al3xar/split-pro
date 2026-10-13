import { z } from 'zod';

import { type AgentTool, runAgent } from '~/server/assistant/agent';
import { type ChatMsg, chatCompletion } from '~/server/assistant/llm';

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: 'function' as const,
  function: { name, arguments: JSON.stringify(args) },
});

const sumTool: AgentTool = {
  name: 'sum',
  description: 'Adds two numbers',
  schema: z.object({ a: z.number(), b: z.number() }),
  run: async ({ a, b }: { a: number; b: number }) => ({ result: a + b }),
};

const proposeTool: AgentTool = {
  name: 'propose_expense',
  description: 'Proposes an expense',
  schema: z.object({ name: z.string(), amount: z.number() }),
  run: async (args: { name: string; amount: number }) => ({ proposal: args }),
};

/** A fake model that answers with the scripted replies in order. */
const scripted = (replies: ChatMsg[]) => {
  const seen: ChatMsg[][] = [];
  return {
    seen,
    complete: async (messages: ChatMsg[]) => {
      seen.push(messages);
      return replies[seen.length - 1] ?? { role: 'assistant' as const, content: 'done' };
    },
  };
};

const user: ChatMsg = { role: 'user', content: 'hola' };

describe('runAgent', () => {
  it('returns the answer when the model needs no tools', async () => {
    const model = scripted([{ role: 'assistant', content: 'Hola!' }]);
    const result = await runAgent({
      messages: [user],
      tools: [sumTool],
      complete: model.complete,
      maxSteps: 5,
    });
    expect(result.messages).toEqual([{ role: 'assistant', content: 'Hola!' }]);
    expect(result.stoppedEarly).toBe(false);
  });

  it('runs a tool and feeds the result back to the model', async () => {
    const model = scripted([
      { role: 'assistant', content: null, tool_calls: [call('c1', 'sum', { a: 2, b: 3 })] },
      { role: 'assistant', content: 'Son 5' },
    ]);
    const result = await runAgent({
      messages: [user],
      tools: [sumTool],
      complete: model.complete,
      maxSteps: 5,
    });
    expect(result.messages[1]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: '{"result":5}',
    });
    expect(result.messages.at(-1)?.content).toBe('Son 5');
    expect(model.seen[1]).toHaveLength(3);
  });

  it('invalid tool call is reported back', async () => {
    const model = scripted([
      {
        role: 'assistant',
        content: null,
        tool_calls: [call('c1', 'nope', {}), call('c2', 'sum', { a: 'x' })],
      },
      { role: 'assistant', content: 'Perdón' },
    ]);
    const result = await runAgent({
      messages: [user],
      tools: [sumTool],
      complete: model.complete,
      maxSteps: 5,
    });
    expect(JSON.parse(result.messages[1]!.content!)).toMatchObject({
      error: expect.stringContaining('Unknown tool'),
    });
    expect(JSON.parse(result.messages[2]!.content!)).toMatchObject({
      error: expect.stringContaining('Invalid arguments'),
    });
    expect(result.messages.at(-1)?.content).toBe('Perdón');
  });

  it('stops after max steps', async () => {
    const looping = {
      role: 'assistant' as const,
      content: null,
      tool_calls: [call('c', 'sum', { a: 1, b: 1 })],
    };
    const model = scripted(Array.from({ length: 10 }, () => looping));
    const result = await runAgent({
      messages: [user],
      tools: [sumTool],
      complete: model.complete,
      maxSteps: 3,
    });
    expect(model.seen).toHaveLength(3);
    expect(result.stoppedEarly).toBe(true);
  });

  it('propose_expense returns a proposal without writing', async () => {
    const model = scripted([
      {
        role: 'assistant',
        content: null,
        tool_calls: [call('p1', 'propose_expense', { name: 'Cena', amount: 40 })],
      },
      { role: 'assistant', content: 'Te lo he preparado' },
    ]);
    const result = await runAgent({
      messages: [user],
      tools: [proposeTool],
      complete: model.complete,
      maxSteps: 5,
    });
    expect(result.proposals).toEqual([{ toolCallId: 'p1', prefill: { name: 'Cena', amount: 40 } }]);
    expect(result.messages[1]!.content).toContain('awaiting the user');
  });
});

describe('chatCompletion', () => {
  it('posts an OpenAI-compatible request and returns the first message', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }),
    }));
    const message = await chatCompletion(
      { baseUrl: 'https://llm.example/v1/', apiKey: 'k', model: 'm' },
      [user],
      [{ name: 'sum', description: 'd', parameters: { type: 'object' } }],
      fetchImpl as unknown as typeof fetch,
    );
    expect(message).toEqual({ role: 'assistant', content: 'ok' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.example/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer k');
    expect(JSON.parse(init.body as string)).toMatchObject({
      model: 'm',
      tools: [{ type: 'function', function: { name: 'sum' } }],
    });
  });

  it('throws on HTTP errors', async () => {
    const fetchImpl = jest.fn(async () => ({ ok: false, status: 401, json: async () => ({}) }));
    await expect(
      chatCompletion(
        { baseUrl: 'https://llm.example/v1', model: 'm' },
        [user],
        [],
        fetchImpl as unknown as typeof fetch,
      ),
    ).rejects.toThrow('LLM_HTTP_401');
  });
});
