import { useEffect, useRef, useState } from 'react';

/**
 * 跟踪下载菜单展开状态，使悬停提示在菜单打开时关闭，避免抢占 Escape。
 * @returns 菜单受控状态与展开回调
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
    // Radix 关闭焦点事件可能延迟触发，读取按钮实时状态避免快速下载完成后误阻止原生回焦。
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
