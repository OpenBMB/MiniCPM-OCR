/**
 * Playground 发送按钮不可用时的可读原因。
 *
 * 用途：把「模型未就绪 / Key 加载 / 无 Key / 解密失败」收敛成一句提示，
 * 避免用户点击发送后看起来没有响应。
 */

/** 判断发送禁用原因所需的最小会话状态 */
export interface SendDisabledState {
  modelId: string;
  keysLoading: boolean;
  hasKeys: boolean;
  keyId: string;
  secretReady: boolean;
  secretLoading: boolean;
  secretError: boolean;
  /** 是否还有任一类免费体验额度；优先使用隐藏体验 Key。 */
  trialAvailable: boolean;
  webSearch: boolean;
}

/**
 * 发送不可用时给出明确原因；全部就绪则返回 undefined。
 * @param state 模型与密钥就绪态
 * @param t playground 文案函数
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
