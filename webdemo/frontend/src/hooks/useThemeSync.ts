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
 * 应用明暗主题。
 *
 * 用途：首屏直接同步主题；后续切换优先使用 View Transition 做合成层淡入淡出，
 * 避免给全量 DOM 注入 transition 导致长表格/大量卡片一起重算而卡顿。降级路径只给
 * 主要布局与控件做短色彩过渡，并尊重 reduced motion。
 *
 * @param instant 首屏初始化时直接应用，不放动画。
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
