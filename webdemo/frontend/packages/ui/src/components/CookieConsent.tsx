import { useEffect, useState } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { Switch } from './ui/switch';

export const COOKIE_CONSENT_STORAGE_KEY = 'map-cookie-consent-v1';
export const COOKIE_SETTINGS_EVENT = 'map:open-cookie-settings';

export type CookieConsentState = {
  version: 1;
  necessary: true;
  analytics: boolean;
  marketing: boolean;
};

type CookieConsentLocale = 'en-US' | 'zh-CN';

type CookieConsentProps = {
  locale?: CookieConsentLocale;
  privacyPolicyHref?: string;
};

const defaultConsent: CookieConsentState = {
  version: 1,
  necessary: true,
  analytics: false,
  marketing: false,
};

const copy = {
  'en-US': {
    title: 'Cookie preferences',
    banner:
      'We use cookies and similar technologies to keep the platform secure, remember your preferences, and improve the service.',
    learnMore: 'Read our Privacy Policy',
    necessary: 'Strictly Necessary',
    necessaryDescription:
      'Required for authentication, security, and core platform functions. This includes the HttpOnly map_oauth_state cookie used to verify OAuth sign-in requests.',
    analytics: 'Analytics',
    analyticsDescription: 'Helps us understand usage and improve platform performance.',
    marketing: 'Marketing',
    marketingDescription: 'Used for advertising and marketing measurement. Currently not enabled.',
    acceptAll: 'Accept all',
    rejectOptional: 'Reject optional',
    manage: 'Manage settings',
    save: 'Save preferences',
    settings: 'Cookie preferences',
    close: 'Close cookie preferences',
  },
  'zh-CN': {
    title: 'Cookie 偏好设置',
    banner: '我们使用 Cookie 及类似技术来保障平台安全、记住您的偏好并改进服务。',
    learnMore: '阅读隐私政策',
    necessary: '严格必要',
    necessaryDescription:
      '用于身份认证、安全防护和平台核心功能，无法关闭。其中包括用于校验 OAuth 登录请求的 HttpOnly map_oauth_state Cookie。',
    analytics: '分析',
    analyticsDescription: '帮助我们了解使用情况并改进平台性能。',
    marketing: '营销',
    marketingDescription: '用于广告和营销效果衡量，目前未启用。',
    acceptAll: '全部接受',
    rejectOptional: '拒绝可选项',
    manage: '管理设置',
    save: '保存偏好',
    settings: 'Cookie 偏好设置',
    close: '关闭 Cookie 偏好设置',
  },
} as const;

export function readCookieConsent(storage?: Storage): CookieConsentState | null {
  try {
    storage ??= window.localStorage;
    const raw = storage.getItem(COOKIE_CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('version' in parsed) ||
      parsed.version !== 1 ||
      !('necessary' in parsed) ||
      parsed.necessary !== true ||
      !('analytics' in parsed) ||
      typeof parsed.analytics !== 'boolean' ||
      !('marketing' in parsed) ||
      typeof parsed.marketing !== 'boolean'
    ) {
      return null;
    }
    return {
      version: 1,
      necessary: true,
      analytics: parsed.analytics,
      marketing: parsed.marketing,
    };
  } catch {
    return null;
  }
}

export function writeCookieConsent(
  state: Pick<CookieConsentState, 'analytics' | 'marketing'>,
  storage?: Storage,
): CookieConsentState {
  const next: CookieConsentState = {
    version: 1,
    necessary: true,
    analytics: state.analytics,
    marketing: state.marketing,
  };
  try {
    storage ??= window.localStorage;
    storage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Private browsing or storage restrictions must not prevent sign-in or service use.
  }
  return next;
}

/** Opens the shared settings panel from a footer or another trusted first-party control. */
export function requestCookieSettings(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(COOKIE_SETTINGS_EVENT));
  }
}

export function CookieConsentManager({
  locale = 'en-US',
  privacyPolicyHref = '/console/legal/privacy',
}: CookieConsentProps) {
  const text = copy[locale];
  const [saved, setSaved] = useState<CookieConsentState | null>(() => readCookieConsent());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [draft, setDraft] = useState({ analytics: false, marketing: false });

  useEffect(() => {
    const openSettings = () => {
      const current = saved ?? defaultConsent;
      setDraft({ analytics: current.analytics, marketing: current.marketing });
      setSettingsOpen(true);
    };
    window.addEventListener(COOKIE_SETTINGS_EVENT, openSettings);
    return () => window.removeEventListener(COOKIE_SETTINGS_EVENT, openSettings);
  }, [saved]);

  function commit(next: Pick<CookieConsentState, 'analytics' | 'marketing'>) {
    setSaved(writeCookieConsent(next));
    setSettingsOpen(false);
  }

  function openSettings() {
    const current = saved ?? defaultConsent;
    setDraft({ analytics: current.analytics, marketing: current.marketing });
    setSettingsOpen(true);
  }

  return (
    <>
      {saved === null && !settingsOpen && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby="map-cookie-consent-title"
          className="fixed inset-x-4 bottom-4 z-[70] mx-auto max-w-3xl rounded-xl border border-border bg-card p-5 shadow-[0_16px_48px_-12px_rgba(0,0,0,0.24)] sm:inset-x-6 sm:p-6"
        >
          <h2 id="map-cookie-consent-title" className="text-base font-semibold text-foreground">
            {text.title}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{text.banner}</p>
          <a
            href={privacyPolicyHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          >
            {text.learnMore}
          </a>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={openSettings}>
              {text.manage}
            </Button>
            <Button type="button" variant="outline" onClick={() => commit(defaultConsent)}>
              {text.rejectOptional}
            </Button>
            <Button type="button" onClick={() => commit({ analytics: true, marketing: true })}>
              {text.acceptAll}
            </Button>
          </div>
        </section>
      )}

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent closeLabel={text.close} onClose={() => setSettingsOpen(false)}>
          <DialogHeader>
            <DialogTitle>{text.settings}</DialogTitle>
            <DialogDescription>
              {text.necessaryDescription} {text.analyticsDescription}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <ConsentRow
              label={text.necessary}
              description={text.necessaryDescription}
              checked
              disabled
              ariaLabel={text.necessary}
            />
            <ConsentRow
              label={text.analytics}
              description={text.analyticsDescription}
              checked={draft.analytics}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, analytics: checked }))
              }
              ariaLabel={text.analytics}
            />
            <ConsentRow
              label={text.marketing}
              description={text.marketingDescription}
              checked={draft.marketing}
              onCheckedChange={(checked) =>
                setDraft((current) => ({ ...current, marketing: checked }))
              }
              ariaLabel={text.marketing}
            />
          </div>
          <div className="mt-5 flex justify-end">
            <Button type="button" onClick={() => commit(draft)}>
              {text.save}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ConsentRow({
  label,
  description,
  checked,
  disabled,
  onCheckedChange,
  ariaLabel,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{label}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
        aria-label={ariaLabel}
      />
    </div>
  );
}
