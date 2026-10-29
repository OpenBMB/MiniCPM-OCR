import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import {
  COOKIE_CONSENT_STORAGE_KEY,
  CookieConsentManager,
  readCookieConsent,
  requestCookieSettings,
} from './CookieConsent';

afterEach(() => {
  window.localStorage.clear();
});

describe('CookieConsent', () => {
  it('does not grant optional categories before the user chooses', () => {
    expect(readCookieConsent()).toBeNull();

    render(<CookieConsentManager locale="en-US" privacyPolicyHref="/console/legal/privacy" />);

    expect(screen.getByRole('dialog', { name: 'Cookie preferences' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject optional' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept all' })).toBeInTheDocument();
    expect(window.localStorage.getItem(COOKIE_CONSENT_STORAGE_KEY)).toBeNull();
  });

  it('stores a reject decision with only necessary storage enabled', () => {
    render(<CookieConsentManager locale="en-US" />);

    fireEvent.click(screen.getByRole('button', { name: 'Reject optional' }));

    expect(screen.queryByRole('dialog', { name: 'Cookie preferences' })).not.toBeInTheDocument();
    expect(readCookieConsent()).toEqual({
      version: 1,
      necessary: true,
      analytics: false,
      marketing: false,
    });
  });

  it('allows optional categories to be changed from Cookie Settings', async () => {
    window.localStorage.setItem(
      COOKIE_CONSENT_STORAGE_KEY,
      JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false }),
    );
    render(<CookieConsentManager locale="en-US" />);

    requestCookieSettings();

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Cookie preferences' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Analytics' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }));

    expect(readCookieConsent()).toMatchObject({
      necessary: true,
      analytics: true,
      marketing: false,
    });
  });

  it('closes Cookie Settings from the close button without changing saved preferences', async () => {
    const existingConsent = {
      version: 1,
      necessary: true,
      analytics: true,
      marketing: false,
    };
    window.localStorage.setItem(COOKIE_CONSENT_STORAGE_KEY, JSON.stringify(existingConsent));
    render(<CookieConsentManager locale="en-US" />);

    requestCookieSettings();

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Cookie preferences' })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close cookie preferences' }));

    expect(screen.queryByRole('dialog', { name: 'Cookie preferences' })).not.toBeInTheDocument();
    expect(readCookieConsent()).toEqual(existingConsent);
  });
});
