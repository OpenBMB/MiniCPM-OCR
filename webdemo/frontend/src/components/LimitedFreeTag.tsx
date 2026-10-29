import { Badge } from '@map/ui';
import { useTranslation } from 'react-i18next';

/**
 * 「免费调用」标签：模型当前落在定价免费时间窗内时紧跟模型名展示。
 * 门户下拉（顶栏）与模型列表页共用一份，保证文案与样式一致；容器侧用 items-center 令其与名字垂直居中。
 * @param className 额外类名（如列表项内的行内对齐间距）
 * @returns 免费调用小徽标
 */
export function LimitedFreeTag({ className }: { className?: string }) {
  const { t } = useTranslation('models');
  return (
    <Badge
      variant="warning"
      className={`shrink-0 px-1.5 py-0 text-[10px] font-medium leading-tight ${className ?? ''}`}
    >
      {t('limitedFree')}
    </Badge>
  );
}
