/**
 * 发送禁用原因单测：模型、密钥与明文密钥各阶段给出明确提示。
 */

import { describe, expect, it } from 'vitest';
import { getSendDisabledReason, type SendDisabledState } from '../sendDisabledReason';

const ready: SendDisabledState = {
  modelId: 'm1',
  keysLoading: false,
  hasKeys: true,
  keyId: 'k1',
  secretReady: true,
  secretLoading: false,
  secretError: false,
  trialAvailable: true,
  webSearch: false,
};

describe('getSendDisabledReason', () => {
  it('returns undefined when the session can send', () => {
    expect(getSendDisabledReason(ready, (key) => key)).toBeUndefined();
  });

  it('explains missing models, keys, and unread secrets', () => {
    expect(getSendDisabledReason({ ...ready, modelId: '' }, (key) => key)).toBe('sendModelLoading');
    expect(getSendDisabledReason({ ...ready, keysLoading: true }, (key) => key)).toBe(
      'sendKeyLoading',
    );
    expect(
      getSendDisabledReason(
        { ...ready, hasKeys: false, keyId: '', trialAvailable: false },
        (key) => key,
      ),
    ).toBe('sendNoApiKey');
    expect(
      getSendDisabledReason({ ...ready, secretReady: false, secretLoading: true }, (key) => key),
    ).toBe('sendKeyReading');
  });

  it('allows sending during web search even before the secret is ready', () => {
    expect(
      getSendDisabledReason(
        { ...ready, webSearch: true, secretReady: false, secretLoading: true },
        (key) => key,
      ),
    ).toBeUndefined();
  });

  it('allows a new user to send with the free trial credential', () => {
    const state = {
      ...ready,
      hasKeys: false,
      keyId: 'trial-key',
      secretReady: true,
      trialAvailable: true,
    } satisfies SendDisabledState;

    expect(getSendDisabledReason(state, (key) => key)).toBeUndefined();
  });

  it('asks for an API key after the free trial is exhausted', () => {
    const state = {
      ...ready,
      hasKeys: false,
      keyId: '',
      secretReady: false,
      trialAvailable: false,
    } satisfies SendDisabledState;

    expect(getSendDisabledReason(state, (key) => key)).toBe('sendNoApiKey');
  });
});
