import { createContext } from 'react';

/** The formula hit by a double-click and its occurrence index among identical text in the current block, so an adjacent identical formula is not selected. */
export interface ImageParseFormulaTarget {
  latex: string;
  occurrence: number;
}

/** Formula nodes share the session entry and IME state; edit state is not written into the document. */
export const ImageParseFormulaEditContext = createContext<{
  initial: ImageParseFormulaTarget | null;
  onComposing: (value: boolean) => void;
} | null>(null);

/** Locate the double-click target from KaTeX's source annotation; a double-click on the body does not open any formula automatically. */
export function imageParseFormulaTarget(
  target: EventTarget,
  block: HTMLElement,
): ImageParseFormulaTarget | null {
  if (!(target instanceof Element)) return null;
  const formula = target.closest('.katex');
  const latex = formula?.querySelector('annotation')?.textContent;
  if (!formula || latex === undefined || latex === null) return null;
  const matches = [...block.querySelectorAll('.katex')].filter(
    (node) => node.querySelector('annotation')?.textContent === latex,
  );
  return { latex, occurrence: matches.indexOf(formula) };
}
