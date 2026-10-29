import { describe, expect, it } from 'vitest';
import type { MapApiKey, MapPlaygroundTrial } from '@/api/map';
import {
  resolvePlaygroundCredential,
  resolvePlaygroundCredentialExperience,
} from './usePlaygroundCredential';

const trial: MapPlaygroundTrial = {
  remaining: { language: 1, tts: 0, realtime: 0, 'image-parse': 0 },
  api_key_id: 'trial-key',
  project_id: 'trial-project',
  secret: 'trial-secret',
};

const normalKey: MapApiKey = {
  id: 'normal-key',
  project_id: 'normal-project',
  name: 'normal',
  prefix: 'sk-live',
  status: 'active',
  created_at: '2026-01-01T00:00:00Z',
};

describe('resolvePlaygroundCredential', () => {
  it('prioritizes the hidden trial key while quota remains', () => {
    expect(resolvePlaygroundCredential([normalKey], trial, 'normal-project', 'language')).toEqual({
      keyId: 'trial-key',
      projectId: 'trial-project',
      secret: 'trial-secret',
    });
  });

  it('falls back to the default normal key after the trial is exhausted', () => {
    const exhausted = {
      ...trial,
      remaining: { language: 0, tts: 0, realtime: 0, 'image-parse': 0 },
    };
    expect(
      resolvePlaygroundCredential([normalKey], exhausted, 'normal-project', 'language'),
    ).toEqual({
      keyId: 'normal-key',
      projectId: 'normal-project',
      secret: undefined,
    });
  });

  it('returns no credential when the trial is exhausted and no normal key exists', () => {
    const exhausted = {
      ...trial,
      remaining: { language: 0, tts: 0, realtime: 0, 'image-parse': 0 },
    };
    expect(resolvePlaygroundCredential([], exhausted, undefined, 'language')).toEqual({
      keyId: '',
      projectId: undefined,
      secret: undefined,
    });
  });

  it('selects the credential by the current experience quota', () => {
    const partial = {
      ...trial,
      remaining: { language: 0, tts: 1, realtime: 0, 'image-parse': 0 },
    };
    expect(resolvePlaygroundCredential([normalKey], partial, 'normal-project', 'language')).toEqual(
      {
        keyId: 'normal-key',
        projectId: 'normal-project',
        secret: undefined,
      },
    );
    expect(resolvePlaygroundCredential([normalKey], partial, 'normal-project', 'tts')).toEqual({
      keyId: 'trial-key',
      projectId: 'trial-project',
      secret: 'trial-secret',
    });
  });
});

describe('resolvePlaygroundCredentialExperience', () => {
  it('keeps the requested experience while models are loading', () => {
    expect(
      resolvePlaygroundCredentialExperience(
        'tts',
        { tts: false, realtime: false, 'image-parse': false },
        true,
      ),
    ).toBe('tts');
  });

  it('falls back to language when the requested experience has no models', () => {
    expect(
      resolvePlaygroundCredentialExperience(
        'tts',
        { tts: false, realtime: true, 'image-parse': true },
        false,
      ),
    ).toBe('language');
  });

  it('keeps the requested experience when its models are available', () => {
    expect(
      resolvePlaygroundCredentialExperience(
        'realtime',
        { tts: false, realtime: true, 'image-parse': false },
        false,
      ),
    ).toBe('realtime');
  });
});
