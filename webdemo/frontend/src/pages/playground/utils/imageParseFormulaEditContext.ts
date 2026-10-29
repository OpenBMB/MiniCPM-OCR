import { createContext } from 'react';

/** 双击命中的公式及其在当前块内的同文出现序号，避免选择相邻的相同公式。 */
export interface ImageParseFormulaTarget {
  latex: string;
  occurrence: number;
}

/** 公式节点共享会话入口与输入法状态，不将编辑状态写入文档。 */
export const ImageParseFormulaEditContext = createContext<{
  initial: ImageParseFormulaTarget | null;
  onComposing: (value: boolean) => void;
} | null>(null);

/** 从 KaTeX 的源码注解定位双击对象；正文双击不自动打开任何公式。 */
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
