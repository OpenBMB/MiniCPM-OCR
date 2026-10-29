export { useApi } from './useApi';
export { useResponsive, useBreakpoint } from './useResponsive';
export { useStorage } from './useStorage';
export { useThemeSync } from './useThemeSync';
export { useGlobalShortcuts } from './useGlobalShortcuts';
export { useCaptchaGate, type CaptchaGate } from './useCaptchaGate';

// Re-export commonly used ahooks for convenience
export {
  useRequest,
  useDebounce,
  useDebounceFn,
  useThrottle,
  useThrottleFn,
  useBoolean,
  useToggle,
  useMount,
  useUnmount,
  useUpdateEffect,
  usePrevious,
  useClickAway,
  useEventListener,
  useKeyPress,
  useInterval,
  useTimeout,
  useLockFn,
  useMemoizedFn,
  useCreation,
  useLatest,
  useLocalStorageState,
  useSessionStorageState,
  useTitle,
  useFavicon,
  useDocumentVisibility,
  useNetwork,
  useScroll,
  useSize,
  useInViewport,
  useHover,
  useFocusWithin,
} from 'ahooks';
