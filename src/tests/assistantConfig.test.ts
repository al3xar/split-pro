import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  resolveAssistantConfig,
} from '~/server/assistant/config';

const SECRET = 'server-secret';

describe('encryptSecret / decryptSecret', () => {
  it('round-trips and never stores the plain key', () => {
    const encrypted = encryptSecret('sk-live-1234', SECRET);
    expect(encrypted).not.toContain('sk-live');
    expect(decryptSecret(encrypted, SECRET)).toBe('sk-live-1234');
  });

  it('uses a fresh IV every time', () => {
    expect(encryptSecret('x', SECRET)).not.toBe(encryptSecret('x', SECRET));
  });

  it('returns null with a different server secret or tampered data', () => {
    const encrypted = encryptSecret('sk-live-1234', SECRET);
    expect(decryptSecret(encrypted, 'other')).toBeNull();
    expect(decryptSecret(`${encrypted.slice(0, -4)}AAAA`, SECRET)).toBeNull();
    expect(decryptSecret('garbage', SECRET)).toBeNull();
  });
});

describe('maskSecret', () => {
  it('shows only the last 4 characters', () => {
    expect(maskSecret('sk-live-abcd1234')).toBe('••••1234');
    expect(maskSecret('abc')).toBe('••••');
  });
});

describe('resolveAssistantConfig', () => {
  const env = {
    baseUrl: 'https://env.example/v1',
    model: 'env-model',
    apiKey: 'env-key',
    maxSteps: 5,
  };

  it('falls back to the environment when nothing is stored', () => {
    expect(resolveAssistantConfig(null, env)).toEqual({ ...env, source: 'env', enabled: true });
  });

  it('prefers stored values field by field', () => {
    expect(
      resolveAssistantConfig(
        { baseUrl: 'https://ui.example/v1', model: null, apiKey: 'ui-key', maxSteps: 3 },
        env,
      ),
    ).toEqual({
      baseUrl: 'https://ui.example/v1',
      model: 'env-model',
      apiKey: 'ui-key',
      maxSteps: 3,
      source: 'ui',
      enabled: true,
    });
  });

  it('is disabled without a URL or a model', () => {
    const empty = { baseUrl: undefined, model: undefined, apiKey: undefined, maxSteps: 5 };
    expect(resolveAssistantConfig(null, empty).enabled).toBe(false);
    expect(
      resolveAssistantConfig(
        { baseUrl: 'https://ui.example/v1', model: null, apiKey: null, maxSteps: null },
        empty,
      ).enabled,
    ).toBe(false);
  });
});
