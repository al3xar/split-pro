import { generateKeyPairSync, randomUUID } from 'node:crypto';

/**
 * Minimal client for Tricount's undocumented API (the one its Android app uses), enough to
 * read a shared Tricount by its public key. It may change without notice; failures surface
 * as `TricountApiError` so callers can explain them.
 */
const BASE_URL = 'https://api.tricount.bunq.com';
const USER_AGENT = 'com.bunq.tricount.android:RELEASE:7.0.7:3174:ANDROID:13:C';
const TIMEOUT_MS = 20_000;

export class TricountApiError extends Error {}

const request = async (path: string, init: RequestInit & { headers: Record<string, string> }) => {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...init,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch((error: unknown) => {
    throw new TricountApiError(`Network error: ${String(error)}`);
  });
  if (!response.ok) {
    throw new TricountApiError(`HTTP ${response.status} for ${path.split('?')[0]}`);
  }
  return (await response.json()) as unknown;
};

const findInResponse = (json: unknown, key: string): Record<string, unknown> | undefined => {
  const items = (json as { Response?: Record<string, unknown>[] })?.Response ?? [];
  return items.find((item) => key in item)?.[key] as Record<string, unknown> | undefined;
};

export const fetchTricountRegistry = async (key: string): Promise<unknown> => {
  const appId = randomUUID();
  const headers = {
    'User-Agent': USER_AGENT,
    'app-id': appId,
    'X-Bunq-Client-Request-Id': randomUUID(),
    'Content-Type': 'application/json',
  };
  const { publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'pkcs1', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });

  const session = await request('/v1/session-registry-installation', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      app_installation_uuid: appId,
      client_public_key: publicKey,
      device_description: 'Android',
    }),
  });
  const token = findInResponse(session, 'Token')?.token;
  const userId = findInResponse(session, 'UserPerson')?.id;
  if ('string' !== typeof token || ('number' !== typeof userId && 'string' !== typeof userId)) {
    throw new TricountApiError('Unexpected session response');
  }

  return request(`/v1/user/${userId}/registry?public_identifier_token=${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: { ...headers, 'X-Bunq-Client-Authentication': token },
  });
};
