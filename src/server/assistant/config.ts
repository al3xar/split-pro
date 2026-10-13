import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Assistant LLM settings: stored values (set from the UI) win over environment variables. */

export interface StoredAssistantConfig {
  baseUrl: string | null;
  model: string | null;
  /** Plain key, already decrypted */
  apiKey: string | null;
  maxSteps: number | null;
}

export interface EnvAssistantConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxSteps: number;
}

export interface AssistantConfig {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  maxSteps: number;
  source: 'ui' | 'env';
  enabled: boolean;
}

const keyFrom = (secret: string) =>
  createHash('sha256').update(`assistant-config:${secret}`).digest();

/** AES-256-GCM; output "iv.tag.ciphertext" in base64url. */
export const encryptSecret = (plain: string, secret: string) => {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv);
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((b) => b.toString('base64url')).join('.');
};

/** Null when the data was tampered with or the server secret changed. */
export const decryptSecret = (value: string, secret: string): string | null => {
  try {
    const [iv, tag, data] = value.split('.').map((part) => Buffer.from(part, 'base64url'));
    if (!iv || !tag || !data || 12 !== iv.length || 16 !== tag.length) {
      return null;
    }
    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
};

export const maskSecret = (value: string) => `••••${4 < value.length ? value.slice(-4) : ''}`;

export const resolveAssistantConfig = (
  stored: StoredAssistantConfig | null,
  env: EnvAssistantConfig,
): AssistantConfig => {
  const baseUrl = stored?.baseUrl || env.baseUrl;
  const model = stored?.model || env.model;
  return {
    baseUrl,
    model,
    apiKey: stored?.apiKey || env.apiKey,
    maxSteps: stored?.maxSteps ?? env.maxSteps,
    source: stored ? 'ui' : 'env',
    enabled: Boolean(baseUrl && model),
  };
};
