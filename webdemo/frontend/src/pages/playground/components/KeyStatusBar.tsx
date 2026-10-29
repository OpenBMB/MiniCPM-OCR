/**
 * Session key status bar.
 *
 * Purpose: Playground does not expose an API Key selector — the secret is taken automatically from the key under the "default project" (see usePlaygroundModel). This component prompts only for "free quota / loading / no Key / secret unavailable." Free quota is shown first; when it is used up and there is no user Key, it offers a "go create an API Key" guide.
 */

import { useNavigate } from 'react-router-dom';
import { Badge, Button } from '@map/ui';
import { useTranslation } from 'react-i18next';

interface KeyStatusBarProps {
  /** Whether the key list is loading */
  loading: boolean;
  /** Whether a usable Key exists */
  hasKeys: boolean;
  /** Whether the plaintext secret is being decrypted */
  secretLoading: boolean;
  /** Whether the plaintext secret is unavailable */
  secretError: boolean;
  /** Remaining free uses for the current experience; undefined means the status is unavailable */
  trialRemaining?: number;
  /** Whether fetching the free-trial status failed */
  trialError?: boolean;
}

/**
 * Key status indicator; when there is no Key, guide the user to create one.
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

  // No usable Key on the account: guide the user to the API Keys page to create one
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
  // Do not show a mark in the ready state (avoid a redundant "session ready"); prompt only while loading, with no Key, or on error
  return null;
}
