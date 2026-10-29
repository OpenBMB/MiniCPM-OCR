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
  /** Show the action text directly; icon controls stay compact, and text controls are for the toolbar's primary action. */
  showLabel?: boolean;
  className?: string;
  children: ReactNode;
}

/** Document tool button: shared size, keyboard focus, accessible name, hover hint, and optional visible text. */
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
            // A natively disabled button does not receive pointer or focus. The outer layer carries the hint, and the button stays non-executable.
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
