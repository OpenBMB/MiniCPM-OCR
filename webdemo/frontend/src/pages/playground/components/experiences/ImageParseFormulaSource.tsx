import { useId, useLayoutEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { Textarea } from '@map/ui';

import { isSupportedKatex } from '../../utils/math-katex';

interface ImageParseFormulaSourceProps {
  latex: string;
  display: boolean;
  onChange: (value: string) => void;
  onBlur: () => void;
  onHistory: (redo: boolean) => void;
  onComposing: (value: boolean) => void;
}

/** 编辑所选数学节点的 LaTeX；沿用原节点事务，不新增第二份公式或插入 HTML。 */
export function ImageParseFormulaSource({
  latex,
  display,
  onChange,
  onBlur,
  onHistory,
  onComposing,
}: ImageParseFormulaSourceProps) {
  const { t } = useTranslation('playground');
  const id = useId();
  const input = useRef<HTMLTextAreaElement>(null);
  const pendingSelection = useRef<{ value: string; start: number; end: number } | null>(null);
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const selection = pendingSelection.current;
    if (!selection) return;
    if (selection.value !== latex) {
      pendingSelection.current = null;
      return;
    }
    const element = input.current;
    if (!element) return;
    pendingSelection.current = null;
    element.setSelectionRange(
      Math.min(selection.start, element.value.length),
      Math.min(selection.end, element.value.length),
    );
  }, [latex]);
  const invalid = !latex.trim() || !isSupportedKatex(latex);
  function keyboard(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing || (!event.metaKey && !event.ctrlKey)) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      onHistory(event.shiftKey);
    }
  }
  return (
    <span className="inline-block w-full align-middle">
      <Textarea
        ref={input}
        id={id}
        value={latex}
        onChange={(event) => {
          pendingSelection.current = {
            value: event.target.value,
            start: event.currentTarget.selectionStart,
            end: event.currentTarget.selectionEnd,
          };
          onChange(event.target.value);
        }}
        onBlur={onBlur}
        onKeyDown={keyboard}
        onCompositionStart={() => onComposing(true)}
        onCompositionEnd={() => onComposing(false)}
        spellCheck={false}
        autoComplete="off"
        name="latex"
        aria-label={t('imageParseFormulaSource')}
        rows={display ? 3 : 1}
        className="min-h-8 resize-y font-mono text-xs leading-5"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
      />
      {invalid ? (
        <span id={`${id}-error`} role="alert" className="block text-xs text-destructive">
          {t('imageParseFormulaInvalid')}
        </span>
      ) : null}
    </span>
  );
}
