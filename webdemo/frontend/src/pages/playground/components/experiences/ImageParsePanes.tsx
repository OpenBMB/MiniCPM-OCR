import { useTranslation } from 'react-i18next';
import { cn } from '@map/ui';
import type { SplitPane } from '../../hooks/useSplitPane';

/**
 * 分栏分隔条。窄屏是上下布局，没有横向分栏可拖，所以整条隐藏。
 *
 * 仅在交互时显示居中短提示，不贯穿顶部工具栏；透明抓取区不增加布局宽度。
 */
export function PaneDivider({ split }: { split: SplitPane }) {
  const { t } = useTranslation('playground');
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t('imageParseSplitter')}
      aria-valuenow={Math.round(split.ratio)}
      aria-valuemin={split.min}
      aria-valuemax={split.max}
      tabIndex={0}
      data-dragging={split.dragging}
      onPointerDown={split.onPointerDown}
      onPointerMove={split.onPointerMove}
      onPointerUp={split.onPointerUp}
      onPointerCancel={split.onPointerUp}
      onLostPointerCapture={split.onPointerUp}
      onKeyDown={split.onKeyDown}
      onDoubleClick={split.reset}
      className={cn(
        'relative z-10 -mx-px hidden w-px shrink-0 touch-none select-none cursor-col-resize bg-transparent lg:block',
        'after:absolute after:inset-y-0 after:-left-3 after:-right-3 after:content-[""]',
        '[@media(pointer:coarse)]:after:-left-[22px] [@media(pointer:coarse)]:after:-right-[22px]',
        'before:pointer-events-none before:absolute before:left-0 before:top-1/2 before:h-12 before:w-px before:-translate-y-1/2 before:rounded-full before:bg-primary/30 before:opacity-0',
        'before:transition-[opacity,background-color] before:duration-150 before:content-[""]',
        'hover:before:opacity-100 focus-visible:outline-none focus-visible:before:bg-primary focus-visible:before:opacity-100',
        'data-[dragging=true]:before:bg-primary/60 data-[dragging=true]:before:opacity-100',
        'motion-reduce:before:transition-none',
      )}
    />
  );
}
