import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { ImageParseTextRange } from '../utils/imageParseBlocks';

/** 当前块提供同步导出和销毁；切块必须先销毁旧实例。 */
export interface ImageParseBlockController {
  save: () => boolean;
  destroy: () => void;
  composing: () => boolean;
}

/** 管理唯一活动块；外部点击或键盘移出时保存，结果更新时丢弃过期会话。 */
export function useImageParseVisualEditor(
  source: string,
  onSave: (value: string, editedRange?: ImageParseTextRange) => void,
) {
  const [active, setActive] = useState<ImageParseTextRange | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<{ range: ImageParseTextRange; source: string } | null>(null);
  const controller = useRef<ImageParseBlockController | null>(null);
  const pendingBlur = useRef(false);
  const footprint = useRef<{ element: HTMLElement; timer: ReturnType<typeof setTimeout> } | null>(
    null,
  );
  const releaseFootprint = useCallback(() => {
    if (!footprint.current) return;
    clearTimeout(footprint.current.timer);
    footprint.current.element.style.minHeight = '';
    footprint.current = null;
  }, []);
  useEffect(() => () => releaseFootprint(), [releaseFootprint]);
  useLayoutEffect(
    () => () => {
      const current = controller.current;
      controller.current = null;
      session.current = null;
      pendingBlur.current = false;
      current?.destroy();
    },
    [],
  );
  const saveCallback = useRef(onSave);
  useLayoutEffect(() => {
    saveCallback.current = onSave;
  }, [onSave]);

  const finish = useCallback((save = true) => {
    if (save && controller.current?.composing()) {
      pendingBlur.current = true;
      return false;
    }
    if (save && controller.current && !controller.current.save()) return false;
    const previous = controller.current;
    controller.current = null;
    session.current = null;
    previous?.destroy();
    pendingBlur.current = false;
    setActive(null);
    return true;
  }, []);

  const begin = useCallback(
    (range: ImageParseTextRange) => {
      if (!finish()) return;
      releaseFootprint();
      session.current = { range, source };
      setActive(range);
    },
    [finish, source, releaseFootprint],
  );

  const saveBlock = useCallback((fragment: string) => {
    const current = session.current;
    if (!current) return;
    const { range, source: original } = current;
    const next = original.slice(0, range.start) + fragment + original.slice(range.end);
    if (next !== original) saveCallback.current(next, range);
  }, []);

  const register = useCallback((value: ImageParseBlockController) => {
    controller.current = value;
  }, []);

  useEffect(() => {
    if (session.current && session.current.source !== source) finish(false);
  }, [source, finish]);

  useEffect(() => {
    if (!active) return;
    function outside(event: Event) {
      const editorRoot = root.current?.querySelector('[data-visual-editing="true"]');
      if (!(event.target instanceof Node) || editorRoot?.contains(event.target)) return;
      if (
        editorRoot instanceof HTMLElement &&
        event.target instanceof Element &&
        event.target.closest('[data-edit-block]')
      ) {
        // 首击保存后暂保留旧块高度，第二击仍命中同一预览块；切换后立即释放。
        releaseFootprint();
        editorRoot.style.minHeight = `${editorRoot.getBoundingClientRect().height}px`;
        footprint.current = { element: editorRoot, timer: setTimeout(releaseFootprint, 400) };
      }
      finish();
    }
    function focusout(event: FocusEvent) {
      const editorRoot = root.current?.querySelector('[data-visual-editing="true"]');
      if (event.relatedTarget instanceof Node && !editorRoot?.contains(event.relatedTarget))
        finish();
    }
    function compositionend() {
      // ProseMirror 完成输入法事务后再导出，避免丢失最后一个中文字符。
      const current = controller.current;
      if (pendingBlur.current)
        setTimeout(() => {
          if (pendingBlur.current && controller.current === current) finish();
        }, 0);
    }
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('focusout', focusout);
    document.addEventListener('compositionend', compositionend);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('focusout', focusout);
      document.removeEventListener('compositionend', compositionend);
    };
  }, [active, finish, releaseFootprint]);

  return { active, root, begin, finish, saveBlock, register };
}
