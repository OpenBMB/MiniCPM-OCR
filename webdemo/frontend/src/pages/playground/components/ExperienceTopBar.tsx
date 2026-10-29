/**
 * 体验中心「语音合成 / 实时音视频」顶栏。
 *
 * 用途：语音合成 / 实时语音共用的轻量顶栏——移动端汉堡键 + 图标 + 标题 + 副标题。
 * 图像解析自带文档工作台顶栏，不走这里。区别于语言模型顶栏（含模型选择器等真功能）。
 */
import { Link } from 'react-router-dom';
import { AudioWaveform, BookOpen, Phone } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import { Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { experienceDocsPath, type ExperienceKey } from '../utils/experienceRoute';

interface ExperienceTopBarProps {
  /** 顶栏标题（如「语音合成」「实时音视频」） */
  title: string;
  /** 副标题，一句话说明能力 */
  subtitle?: string;
  /** 标题前图标 */
  icon: React.ReactNode;
  /** 当前体验，用于跳转对应模型文档 */
  experience: Exclude<ExperienceKey, 'language'>;
  /** 移动端：显示汉堡键以唤出侧栏抽屉 */
  showMenuButton?: boolean;
  onOpenSidebar?: () => void;
}

/**
 * 语音体验顶栏。
 */
export function ExperienceTopBar({
  title,
  subtitle,
  icon,
  experience,
  showMenuButton,
  onOpenSidebar,
}: ExperienceTopBarProps) {
  const { t } = useTranslation('playground');
  const locale = useAppStore((state) => state.locale);
  const docsTitle = getPortalRouteTitle('/docs', locale, 'API 文档');
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/25 bg-card px-4">
      <div className="flex min-w-0 items-center gap-3">
        {showMenuButton && (
          <button
            type="button"
            onClick={onOpenSidebar}
            aria-label={t('openMenu')}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
        )}
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold leading-tight text-foreground">
            {title}
          </span>
          {subtitle && (
            <span className="truncate text-xs leading-tight text-muted-foreground">{subtitle}</span>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={experienceDocsPath(experience)}
              target="_blank"
              rel="noreferrer"
              aria-label={docsTitle}
              className="inline-flex h-8 w-8 items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:w-auto lg:px-3"
            >
              <BookOpen className="size-4" aria-hidden="true" />
              <span className="hidden text-xs font-medium lg:inline">{docsTitle}</span>
            </Link>
          </TooltipTrigger>
          <TooltipContent>{docsTitle}</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}

/**
 * 非语言体验顶栏图标。语言对话走独立顶栏，不经过这里。
 * @param experience 当前体验键
 */
export function experienceIcon(experience: ExperienceKey): React.ReactNode {
  if (experience === 'tts') return <AudioWaveform className="h-4 w-4" />;
  return <Phone className="h-4 w-4" />;
}
