import { useLocalStorageState } from 'ahooks';

/**
 * Typed localStorage state with JSON serialization.
 * Wrapper around ahooks useLocalStorageState with project prefix.
 *
 * @example
 * const [value, setValue] = useStorage<string>('sidebar-width', '240px');
 */
export function useStorage<T>(key: string, defaultValue?: T) {
  return useLocalStorageState<T>(`ude:${key}`, {
    defaultValue,
  });
}
