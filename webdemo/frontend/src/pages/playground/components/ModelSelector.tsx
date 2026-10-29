/**
 * 模型选择器（顶栏）。
 *
 * 用途：从可调用模型列表中选择对话模型（真功能）。
 */

import { Select, SelectContent, SelectItem, SelectTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import type { MapModel } from '@/api/map';
import { LimitedFreeTag } from '@/components/LimitedFreeTag';
import { useBreakpoint } from '@/hooks/useResponsive';
import { isFreeModel } from '@/utils/modelExperience';

interface ModelSelectorProps {
  models: MapModel[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
}

/**
 * 模型下拉。
 * @param models 模型列表
 * @param loading 列表加载态
 * @param value 当前选中 id
 * @param onChange 选择回调
 */
export function ModelSelector({ models, loading, value, onChange }: ModelSelectorProps) {
  const { t } = useTranslation('playground');
  const selected = models.find((m) => m.id === value);
  const isMobile = !useBreakpoint('lg');

  return (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <Select value={value} onValueChange={onChange} disabled={loading || models.length === 0}>
        {/* 触发器单行横排展示（名字 + 上下文），不用 SelectValue，避免镜像下拉项的两行布局造成「换行」观感 */}
        {/* 顶栏内的「裸」触发器：显式清掉基础组件的聚焦/展开态边框与 ring，切换后不残留紫框 */}
        <SelectTrigger className="h-9 w-auto min-w-0 max-w-full gap-2 border-0 bg-transparent px-2 shadow-none hover:bg-muted/60 hover:border-0 focus-visible:border-0 focus-visible:ring-0 data-[state=open]:border-0">
          {selected ? (
            // 用 div 包裹：避开 SelectTrigger 的 [&>span]:line-clamp-1 把 display 改成 -webkit-box，
            // 否则 flex/gap 会被覆盖、名字与上下文会贴在一起。
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="truncate font-semibold">{selected.display_name || selected.id}</span>
              {isFreeModel(selected) && <LimitedFreeTag />}
              {selected.context_window > 0 && (
                <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                  {formatWindow(selected.context_window, t)}
                </span>
              )}
              {selected.parameter_count && (
                <span className="hidden shrink-0 text-xs font-normal text-muted-foreground sm:inline">
                  {selected.parameter_count}
                </span>
              )}
            </div>
          ) : (
            <span className="text-muted-foreground">
              {loading ? t('modelsLoading') : t('selectModel')}
            </span>
          )}
        </SelectTrigger>
        <SelectContent side={isMobile ? 'top' : undefined} scrollMode="native">
          {models.map((m) => {
            const name = m.display_name || m.id;
            // 仅当 id 与展示名不同才在副标题展示 id，避免「名字 + 名字·上下文」重复
            const showId = Boolean(m.display_name) && m.display_name !== m.id;
            // 副标题按「id · 上下文」拼装，缺项自动省略——没有上下文窗口时不留下孤零零的「—」
            const subtitle = [
              showId ? m.id : '',
              m.parameter_count || '',
              m.context_window > 0 ? formatWindow(m.context_window, t) : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <SelectItem key={m.id} value={m.id}>
                <div className="flex flex-col">
                  <span className="font-medium">
                    {name}
                    {isFreeModel(m) && <LimitedFreeTag className="ml-2 align-middle" />}
                  </span>
                  {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
                </div>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
    </div>
  );
}

/** 上下文窗口友好显示（如 128K） */
function formatWindow(
  n: number,
  t: (key: string, options: { count: string | number }) => string,
): string {
  if (!n) return '—';
  return t('contextWindow', { count: n >= 1000 ? `${Math.round(n / 1000)}K` : n });
}
