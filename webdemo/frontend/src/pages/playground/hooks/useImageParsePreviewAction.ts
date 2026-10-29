import { useEffect, useState, type RefObject } from 'react';

interface ActionPosition {
  id: string;
  top: number;
  left: number;
  right: number;
  height: number;
}

/** 跟踪选中块的位置；操作条放在块外，不跟随悬停变化。 */
export function useImageParsePreviewAction(
  ref: RefObject<HTMLElement | null>,
  selectedId: string | undefined,
  content: string,
  visible: boolean,
) {
  const actionId = selectedId;
  const [position, setPosition] = useState<ActionPosition | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root || !actionId || !visible) return;
    const resize = new ResizeObserver(update);
    let target: HTMLElement | undefined;
    function update() {
      if (!root) return;
      const next = [...root.querySelectorAll<HTMLElement>('[data-ocr-linked-ids]')].find(
        (node) =>
          (JSON.parse(node.dataset.ocrLinkedIds!) as string[]).includes(actionId!) &&
          !node.closest('[data-visual-editing="true"]'),
      );
      if (target !== next) {
        if (target) resize.unobserve(target);
        target = next;
        if (target) resize.observe(target);
      }
      const bounds = root.getBoundingClientRect();
      const block = target?.getBoundingClientRect();
      const nextPosition = block
        ? {
            id: actionId!,
            top: block.top - bounds.top,
            left: block.left - bounds.left,
            right: Math.max(0, bounds.right - block.right),
            height: block.height,
          }
        : null;
      setPosition((previous) =>
        previous?.id === nextPosition?.id &&
        previous?.top === nextPosition?.top &&
        previous?.left === nextPosition?.left &&
        previous?.right === nextPosition?.right &&
        previous?.height === nextPosition?.height
          ? previous
          : nextPosition,
      );
    }
    update();
    resize.observe(root);
    const mutation = new MutationObserver(update);
    mutation.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-visual-editing'],
    });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [ref, actionId, content, visible]);
  return visible && position?.id === actionId ? position : null;
}
