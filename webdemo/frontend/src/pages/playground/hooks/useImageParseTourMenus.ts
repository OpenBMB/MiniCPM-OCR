import { useCallback, useRef } from 'react';

import { isImageParseTourSettingsTrigger } from '../utils/imageParseTourSettings';

/** When the tour changes steps, close only the settings menu the tour opened automatically. */
export function useImageParseTourMenus() {
  const autoOpened = useRef<HTMLElement | null>(null);
  const toggle = useCallback((trigger: HTMLElement) => {
    trigger.dispatchEvent(
      new MouseEvent('pointerdown', { bubbles: true, button: 0, ctrlKey: false }),
    );
  }, []);
  const close = useCallback(() => {
    const trigger = autoOpened.current;
    if (trigger?.getAttribute('data-state') === 'open') toggle(trigger);
    autoOpened.current = null;
  }, [toggle]);
  const open = useCallback(
    (element: Element | undefined) => {
      if (!isImageParseTourSettingsTrigger(element)) return;
      const trigger = element as HTMLElement;
      if (trigger.getAttribute('data-state') !== 'open') {
        toggle(trigger);
        autoOpened.current = trigger;
      }
    },
    [toggle],
  );
  return { close, open };
}
