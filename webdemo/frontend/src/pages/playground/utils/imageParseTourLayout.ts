import type { Driver } from 'driver.js';

/**
 * 引导期间跟踪目标几何变化，让加载、换行及容器滚动后的遮罩和提示框保持对齐。
 * @param instance 当前引导实例
 * @returns 切步、关闭或卸载时取消检测的入口
 */
export function trackImageParseTourLayout(
  instance: Pick<Driver, 'isActive' | 'getActiveElement' | 'refresh'>,
): () => void {
  instance.refresh();
  const element = instance.getActiveElement();
  if (!element || element.id === 'driver-dummy-element') return () => {};
  let previous = element.getBoundingClientRect();
  let stopped = false;
  let frame: number;
  const check = () => {
    if (
      stopped ||
      !instance.isActive() ||
      !element.isConnected ||
      instance.getActiveElement() !== element
    )
      return;
    // ResizeObserver 不感知同尺寸的位置变化；逐帧只读取当前目标，变化时才重绘。
    const rect = element.getBoundingClientRect();
    if (
      rect.x !== previous.x ||
      rect.y !== previous.y ||
      rect.width !== previous.width ||
      rect.height !== previous.height
    ) {
      previous = rect;
      instance.refresh();
    }
    frame = window.requestAnimationFrame(check);
  };
  frame = window.requestAnimationFrame(check);
  return () => {
    stopped = true;
    window.cancelAnimationFrame(frame);
  };
}
