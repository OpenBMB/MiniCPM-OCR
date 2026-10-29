/**
 * 会话密钥状态条。
 *
 * 用途：Playground 不暴露 API Key 选择器——密钥自动取「默认项目」下的 key（见
 * usePlaygroundModel）。本组件只在「免费次数 / 加载中 / 无 Key / 密钥不可用」时给出提示；
 * 免费额度优先展示；全部用完且无用户 Key 时提供「去创建 API Key」引导。
 */

import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '@map/ui';
import { useTranslation } from 'react-i18next';

interface KeyStatusBarProps {
  /** 密钥列表是否加载中 */
  loading: boolean;
  /** 是否存在可用 Key */
  hasKeys: boolean;
  /** 明文密钥解密中 */
  secretLoading: boolean;
  /** 明文密钥不可用 */
  secretError: boolean;
  /** 当前体验剩余免费次数；undefined 表示状态不可用 */
  trialRemaining?: number;
  /** 免费体验状态是否获取失败 */
  trialError?: boolean;
}

/**
 * 密钥状态指示；无 Key 时引导去创建。
 */
export function KeyStatusBar({
  loading,
  hasKeys,
  secretLoading,
  secretError,
  trialRemaining,
  trialError,
}: KeyStatusBarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('playground');

  if (loading) {
    return (
      <Badge variant="secondary" className="font-normal">
        {t('keyLoading')}
      </Badge>
    );
  }

  if (trialRemaining !== undefined && trialRemaining > 0) {
    return (
      <Badge variant="secondary" className="font-normal tabular-nums">
        {t('trialRemaining', { count: trialRemaining })}
      </Badge>
    );
  }

  if (!hasKeys && trialError) {
    return (
      <Badge variant="warning" className="font-normal">
        {t('trialUnavailable')}
      </Badge>
    );
  }

  // 账号下无可用 Key：引导去 API Keys 页创建
  if (!hasKeys) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span>{t('noApiKey')}</span>
        <Button size="sm" variant="outline" onClick={() => navigate('/keys')}>
          {t('createApiKey')}
        </Button>
      </div>
    );
  }

  if (secretLoading) {
    return (
      <Badge variant="secondary" className="font-normal">
        {t('keyDecrypting')}
      </Badge>
    );
  }
  if (secretError) {
    return (
      <Badge variant="warning" className="font-normal">
        {t('keyUnavailable')}
      </Badge>
    );
  }
  // 就绪态不展示标记（避免冗余的「会话就绪」），仅在加载/无 Key/出错时给出提示
  return null;
}
