import { useEffect, useRef, useState } from 'react';

/**
 * Track whether the download menu is open, so the hover tooltip closes while the menu is open and does not take over Escape.
 * @returns controlled menu state and the open callback
 */
export function useImageParseDownloadMenu(downloading: boolean) {
  const [open, setOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  useEffect(() => {
    if (downloading || !restoreFocus.current) return;
    restoreFocus.current = false;
    if (document.activeElement === document.body) triggerRef.current?.focus();
  }, [downloading]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) setTooltipOpen(false);
  }

  function onCloseAutoFocus(event: Event) {
    // A Radix close-focus event may fire late; read the button's live state so a fast download finishing does not wrongly block native focus return.
    if (!triggerRef.current?.disabled) return;
    event.preventDefault();
    restoreFocus.current = true;
  }

  return {
    open,
    onOpenChange,
    triggerRef,
    onCloseAutoFocus,
    tooltipOpen: !open && tooltipOpen,
    onTooltipOpenChange: setTooltipOpen,
  };
}
