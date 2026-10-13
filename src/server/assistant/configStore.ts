import { env } from '~/env';
import { db } from '~/server/db';

import {
  type AssistantConfig,
  type StoredAssistantConfig,
  decryptSecret,
  encryptSecret,
  resolveAssistantConfig,
} from './config';

const KEY = 'assistant.config';

/** Encryption key material: the server's auth secret (required in production). */
const serverSecret = () => env.NEXTAUTH_SECRET ?? 'splitpro-development-secret';

interface StoredRow {
  baseUrl: string | null;
  model: string | null;
  apiKeyEnc: string | null;
  maxSteps: number | null;
}

const readRow = async (): Promise<StoredRow | null> => {
  const row = await db.appMetadata.findUnique({ where: { key: KEY } });
  if (!row) {
    return null;
  }
  try {
    return JSON.parse(row.value) as StoredRow;
  } catch {
    return null;
  }
};

export const readStoredConfig = async (): Promise<StoredAssistantConfig | null> => {
  const row = await readRow();
  if (!row) {
    return null;
  }
  return {
    baseUrl: row.baseUrl,
    model: row.model,
    apiKey: row.apiKeyEnc ? decryptSecret(row.apiKeyEnc, serverSecret()) : null,
    maxSteps: row.maxSteps,
  };
};

export const getAssistantConfig = async (): Promise<AssistantConfig> =>
  resolveAssistantConfig(await readStoredConfig(), {
    baseUrl: env.LLM_BASE_URL,
    model: env.LLM_MODEL,
    apiKey: env.LLM_API_KEY,
    maxSteps: env.LLM_MAX_STEPS,
  });

/** `apiKey`: string = replace, null = remove, undefined = keep the stored one. */
export const saveAssistantConfig = async (input: {
  baseUrl: string | null;
  model: string | null;
  apiKey?: string | null;
  maxSteps: number | null;
}) => {
  const current = await readRow();
  const apiKeyEnc =
    undefined === input.apiKey
      ? (current?.apiKeyEnc ?? null)
      : null === input.apiKey || '' === input.apiKey
        ? null
        : encryptSecret(input.apiKey, serverSecret());
  const value = JSON.stringify({
    baseUrl: input.baseUrl,
    model: input.model,
    apiKeyEnc,
    maxSteps: input.maxSteps,
  } satisfies StoredRow);
  await db.appMetadata.upsert({
    where: { key: KEY },
    create: { key: KEY, value },
    update: { value },
  });
};

export const clearAssistantConfig = () => db.appMetadata.deleteMany({ where: { key: KEY } });
