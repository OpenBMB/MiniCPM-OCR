/**
 * 回答下方的来源胶囊。
 *
 * 用途：用一枚「一叠站点图标 + N 个网页」的胶囊取代整条横滑卡片，回答与过程之间只留一个
 * 通往来源抽屉的入口。来源的标题、摘要、序号统一由抽屉承载，正文下方不再重复一遍。
 */

import { useTranslation } from 'react-i18next';

import { cn } from '@map/ui';

import type { Citation } from '../types';
import { StackedFavicons } from './StackedFavicons';

interface SourcesChipProps {
  /** 本轮回答使用的全部来源。 */
  citations: Citation[];
  /** 打开来源抽屉。 */
  onOpen?: () => void;
  /** 来源抽屉当前是否已打开（供胶囊标注 aria-expanded）。 */
  panelOpen?: boolean;
}

/**
 * 渲染来源胶囊。
 * @param citations 本轮回答使用的全部来源
 * @param onOpen 打开来源抽屉
 * @param panelOpen 来源抽屉是否已打开
 * @returns 来源胶囊；无来源或无法打开抽屉时不渲染
 */
export function SourcesChip({ citations, onOpen, panelOpen }: SourcesChipProps) {
  const { t } = useTranslation('playground');
  if (citations.length === 0 || !onOpen) return null;

  const label = t('sourcesChipLabel', { count: citations.length });

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-expanded={panelOpen}
      aria-label={`${label}，${t('openReferences')}`}
      data-testid="sources-chip"
      className={cn(
        /*
          mt-1 而不是照抄下方指标行的 mt-2.5：上面那行正文是 leading-7，自带 7.5px 半行距，
          眼睛看到的间距是「半行距 + 外边距」。4 + 7.5 ≈ 10 + 1.5，胶囊才落在正中间；
          两边写同一个数反而会明显偏下。前提是正文尾元素的下边距已清零（见 MarkdownRenderer）。
        */
        'mt-1 inline-flex min-h-9 items-center gap-2 rounded-full bg-muted py-1.5 pl-2.5 pr-3',
        'text-xs text-muted-foreground transition-colors duration-200',
        /*
          hover 拿 primary 淡染，不是把灰加深。--muted-foreground 是低饱和中灰 (220 9% 46%)，
          混进浅色底会把饱和度一起拉掉，合成色正好落在 --border 上——用画分隔线的颜色铺满
          一整块，在这排冷蓝界面里成了唯一偏离蓝轴的一处，所以显脏。primary 在明暗两套主题
          里同值且亮度居中，换成它两种模式都是同向反馈；8% 取自 @map/ui 既有的同类 hover。
        */
        'hover:bg-primary/[0.08] hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
      )}
    >
      <StackedFavicons citations={citations} />
      <span className="tabular-nums">{label}</span>
    </button>
  );
}
