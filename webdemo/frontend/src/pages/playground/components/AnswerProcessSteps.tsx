/**
 * 回答过程时间线的行基元。
 *
 * 用途：思考段落与工具行共用同一条 marker 列（思考是项目符号、工具是工具图标），
 * 并在 marker 下方画出连接到下一项的竖线，让一次回答的过程读起来是一条线而不是几块卡片。
 */

import { type ReactNode } from 'react';

import { cn } from '@map/ui';

interface ProcessRailItemProps {
  /** marker 列里的内容：项目符号或工具图标；传 null 只占位不画（整条时间线只有一行时）。 */
  marker: ReactNode;
  /** 是否为最后一项；最后一项不画向下的连接线。 */
  last?: boolean;
  /** 失败态整行转红。 */
  tone?: 'default' | 'destructive';
  children: ReactNode;
}

/*
  每一项自带入场动画。流式期间时间线是一项一项长出来的，不给过渡的话新的一行会"啪"地
  顶在原位上——尤其搜索行只有一枚图标加一句话，凭空出现时观感最硬。
  keyed 元素只在首次挂载时跑一次，已有项继续追加文字不会重播；无延时，所以不需要
  fill-mode（那是 STAGGER_CLASS_NAME 给带延时的图标用的）。
*/
const ROW_ENTER_CLASS_NAME =
  'motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300';

/**
 * 渲染时间线上的一行（marker + 正文 + 向下的连接线）。
 *
 * 连接线是每项各画一段（marker 下方到本行底部），而不是一条贯穿全高的轨道：
 * 这样它天然在每个 marker 处断开，marker 才像是"挂"在线上而不是被线穿过。
 *
 * @param marker marker 列内容
 * @param last 是否为最后一项
 * @param tone 文字色调
 * @param children 行正文
 * @returns 时间线行
 */
export function ProcessRailItem({
  marker,
  last = false,
  tone = 'default',
  children,
}: ProcessRailItemProps) {
  return (
    <li
      className={cn(
        'grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-2 text-sm leading-6',
        ROW_ENTER_CLASS_NAME,
        tone === 'destructive' ? 'text-destructive' : 'text-muted-foreground',
      )}
    >
      <span className="relative flex h-full justify-center">
        <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-background">
          {marker}
        </span>
        {last ? null : (
          <span
            className="absolute bottom-0 left-1/2 top-6 w-px -translate-x-1/2 bg-border"
            aria-hidden="true"
          />
        )}
      </span>
      <div className="min-w-0 pb-2">{children}</div>
    </li>
  );
}

/** 思考段落的 marker：一个安静的小圆点，与工具图标同宽同列。 */
export function ProcessBullet() {
  return <span className="size-1.5 rounded-full bg-muted-foreground/50" aria-hidden="true" />;
}
