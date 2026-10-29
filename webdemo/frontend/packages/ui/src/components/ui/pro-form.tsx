import { type ReactNode, type FormHTMLAttributes } from 'react';
import { cn } from '../../utils';
import { Label } from './label';

/* ---- ProForm ---- */

export interface ProFormProps extends FormHTMLAttributes<HTMLFormElement> {
  /** 1 | 2 | 3 columns on desktop, always 1 on mobile */
  columns?: 1 | 2 | 3;
}

function ProForm({ columns = 1, className, children, ...props }: ProFormProps) {
  const gridClass = {
    1: 'grid-cols-1',
    2: 'grid-cols-1 md:grid-cols-2',
    3: 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3',
  }[columns];

  return (
    <form className={cn('space-y-4', className)} {...props}>
      <div className={cn('grid gap-4', gridClass)}>{children}</div>
    </form>
  );
}

/* ---- ProFormField ---- */

export interface ProFormFieldProps {
  label: string;
  /** 在标签旁展示的可选操作，保持在 label 元素之外。 */
  labelAction?: ReactNode;
  name?: string;
  required?: boolean;
  error?: string;
  help?: string;
  /** Span full row width (on multi-column forms) */
  span?: boolean;
  className?: string;
  children: ReactNode;
}

function ProFormField({
  label,
  labelAction,
  name,
  required,
  error,
  help,
  span,
  className,
  children,
}: ProFormFieldProps) {
  const fieldLabel = (
    <Label htmlFor={name} className="flex min-w-0 items-center gap-1">
      {required && <span className="text-destructive">*</span>}
      {label}
    </Label>
  );

  return (
    <div className={cn('space-y-1.5', span && 'md:col-span-full', className)}>
      {labelAction ? (
        <div className="flex min-h-7 items-center justify-between gap-2">
          {fieldLabel}
          {labelAction}
        </div>
      ) : (
        fieldLabel
      )}
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {help && !error && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/* ---- ProFormActions ---- */

function ProFormActions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end', className)}>
      {children}
    </div>
  );
}

export { ProForm, ProFormField, ProFormActions };
