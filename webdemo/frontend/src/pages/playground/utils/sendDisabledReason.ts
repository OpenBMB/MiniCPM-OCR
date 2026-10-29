/**
 * Readable reason when the Playground send button is unavailable.
 *
 * Purpose: collapse "model not ready / key loading / no key / decrypt failed" into one notice,
 * so a click on send does not look like nothing happened.
 */

/** Minimum session state needed to decide the send-disabled reason */
export interface SendDisabledState {
  modelId: string;
  keysLoading: boolean;
  hasKeys: boolean;
  keyId: string;
  secretReady: boolean;
  secretLoading: boolean;
  secretError: boolean;
  /** Whether any free-trial quota remains; the hidden trial key is preferred. */
  trialAvailable: boolean;
  webSearch: boolean;
}

/**
 * Give a clear reason when send is unavailable; return undefined when everything is ready.
 * @param state model and secret readiness
 * @param t playground copy function
 */
export function getSendDisabledReason(
  state: SendDisabledState,
  t: (key: string) => string,
): string | undefined {
  if (!state.modelId) return t('sendModelLoading');
  if (state.keysLoading) return t('sendKeyLoading');
  if (!state.trialAvailable && (!state.hasKeys || !state.keyId)) return t('sendNoApiKey');
  if (!state.webSearch && state.secretLoading) return t('sendKeyReading');
  if (!state.webSearch && state.secretError) return t('sendKeyFailed');
  if (!state.webSearch && !state.secretReady) return t('apiKeyNotReady');
  return undefined;
}
