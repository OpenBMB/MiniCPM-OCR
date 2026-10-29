import { useEffect, useRef } from 'react';
import { useAppStore } from '@map/store';

function getSystemDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

const THEME_TRANSITION_MS = 180;
const THEME_TRANSITION_STYLE_ID = 'map-theme-transition-style';

let fallbackTimer: number | undefined;

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function setDarkClass(isDark: boolean) {
  document.documentElement.classList.toggle('dark', isDark);
}

function ensureThemeTransitionStyle() {
  if (document.getElementById(THEME_TRANSITION_STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = THEME_TRANSITION_STYLE_ID;
  style.textContent = `
@media not (prefers-reduced-motion: reduce) {
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation-duration: ${THEME_TRANSITION_MS}ms;
    animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
  }

  html.map-theme-fallback-transition :where(
    body,
    main,
    aside,
    header,
    nav,
    section,
    article,
    button,
    input,
    textarea,
    select,
    [role='tab'],
    [role='button'],
    [role='combobox'],
    [role='dialog'],
    .map-main-scroll,
    .map-sidebar-scroll
  ) {
    transition:
      background-color ${THEME_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
      border-color ${THEME_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
      color ${THEME_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
      fill ${THEME_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1),
      stroke ${THEME_TRANSITION_MS}ms cubic-bezier(0.22, 1, 0.36, 1);
  }
}
`;
  document.head.appendChild(style);
}

function applyFallbackDark(isDark: boolean) {
  const root = document.documentElement;
  window.clearTimeout(fallbackTimer);

  ensureThemeTransitionStyle();
  root.classList.add('map-theme-fallback-transition');

  window.requestAnimationFrame(() => {
    setDarkClass(isDark);
    fallbackTimer = window.setTimeout(() => {
      root.classList.remove('map-theme-fallback-transition');
    }, THEME_TRANSITION_MS + 50);
  });
}

/**
 * Apply the light or dark theme.
 *
 * Purpose: the first screen syncs the theme directly. Later switches prefer a View Transition cross-fade on the compositor,
 * so a transition is not injected on the whole DOM, which would restyle long tables and many cards together and stutter. The fallback only gives
 * the main layout and controls a short color transition, and it respects reduced motion.
 *
 * @param instant On first-screen init, apply directly with no animation.
 */
function applyDark(isDark: boolean, instant: boolean) {
  if (instant || prefersReducedMotion()) {
    setDarkClass(isDark);
    return;
  }

  ensureThemeTransitionStyle();

  if (typeof document.startViewTransition === 'function') {
    document.startViewTransition(() => setDarkClass(isDark));
    return;
  }

  applyFallbackDark(isDark);
}

export function useThemeSync() {
  const theme = useAppStore((s) => s.theme);
  const isFirst = useRef(true);

  useEffect(() => {
    const isDark = theme === 'dark' || (theme === 'system' && getSystemDark());
    applyDark(isDark, isFirst.current);
    isFirst.current = false;

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyDark(mq.matches, false);
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);
}
