import type { ReactNode } from 'react';
import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger, cn } from '@map/ui';

import {
  WORKSPACE_CONTROL,
  WORKSPACE_ICON_CONTROL,
} from '../../utils/imageParseWorkspaceStyles';

interface ImageParseToolButtonProps {
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  /** 直接展示操作文字；图标控件保持紧凑，文字控件用于工具栏主操作。 */
  showLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/** 文档工具按钮：统一尺寸、键盘焦点、无障碍名称、悬停提示和可选可见文字。 */
export function ImageParseToolButton({
  label,
  hint = label,
  onClick,
  disabled,
  pressed,
  showLabel = false,
  className,
  children,
}: ImageParseToolButtonProps) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      className={cn(
        showLabel ? cn(WORKSPACE_CONTROL, 'gap-1.5') : WORKSPACE_ICON_CONTROL,
        'text-muted-foreground hover:text-foreground',
        className,
      )}
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={hint}
      aria-pressed={pressed}
    >
      {children}
      {showLabel ? <span className="whitespace-nowrap">{label}</span> : null}
    </Button>
  );
  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          {disabled ? (
            // 原生禁用按钮不接收指针与焦点，用外层承接提示，按钮仍保持不可执行。
            <span
              tabIndex={0}
              className="inline-flex rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/30"
            >
              {button}
            </span>
          ) : (
            button
          )}
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
