/**
 * 体验中心左侧栏。
 *
 * 用途：顶部「返回 + 折叠」；「模型体验」分组按当前用户可见模型动态展示；底部历史列表按当前体验
 * 使用对应的数据和操作。
 */

import { ScanText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { isDocumentExperience, type ExperienceKey } from '../utils/experienceRoute';
import { SidebarSection, type SidebarItem } from './SidebarSection';
import {
  PlaygroundHistoryList,
  type PlaygroundSidebarHistory,
  type SidebarSession,
} from './PlaygroundHistoryList';

export type { ExperienceKey, SidebarSession };

interface PlaygroundSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  /** 模型体验当前激活项 */
  activeExperience: ExperienceKey;
  onSelectExperience: (key: ExperienceKey) => void;
  /** 最近对话 */
  sessions: SidebarSession[];
  activeSessionId?: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
  /** 当前用户是否有语音合成模型（无则不渲染该入口） */
  hasTtsModels?: boolean;
  /** 当前用户是否有实时音视频模型（无则不渲染该入口） */
  hasRealtimeModels?: boolean;
  /** 当前用户是否有文档解析模型（无则不渲染该入口） */
  hasImageParseModels?: boolean;
  /** 是否还有更多历史可加载 */
  hasMore?: boolean;
  /** 正在加载更多 */
  loadingMore?: boolean;
  /** 显式加载下一页 */
  onLoadMore?: () => void;
  /** OCR 云端个人历史；正文由 OCR 工作台按需读取。 */
  imageParseHistory?: PlaygroundSidebarHistory;
}

/**
 * 模型体验分组项。语言模型恒在；语音合成 / 实时音视频 / 文档解析均按当前用户可见模型动态增减。
 * @param hasTts 是否有语音合成模型
 * @param hasRealtime 是否有实时音视频模型
 * @param hasImageParse 是否有文档解析模型
 * @returns 可展示的体验入口列表
 */
function experienceItems(
  hasTts: boolean,
  hasRealtime: boolean,
  hasImageParse: boolean,
  labels: {
    language: string;
    tts: string;
    realtime: string;
    imageParse: string;
  },
): SidebarItem[] {
  if (hasImageParse) {
    return [
      {
        key: 'image-parse',
        label: labels.imageParse,
        icon: <ScanText className="h-4 w-4" aria-hidden="true" />,
      },
    ];
  }
  return [];
}

/**
 * 左侧栏。
 */
export function PlaygroundSidebar({
  collapsed,
  onToggle,
  activeExperience,
  onSelectExperience,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  onNewChat,
  hasTtsModels = false,
  hasRealtimeModels = false,
  hasImageParseModels = false,
  hasMore,
  loadingMore,
  onLoadMore,
  imageParseHistory,
}: PlaygroundSidebarProps) {
  const navigate = useNavigate();
  const { t } = useTranslation('playground');
  const documentSessions =
    imageParseHistory?.sessions.filter((session) => session.category !== 'example') ?? [];

  return (
    <aside
      className={`flex h-full shrink-0 flex-col bg-card transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* 顶部：返回 + 折叠 */}
      <div className="flex h-14 shrink-0 items-center justify-between px-3">
        <button
          type="button"
          onClick={() => navigate('/playground/document-parse')}
          title={t('title')}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-semibold text-foreground transition-colors hover:bg-muted/60"
        >
          <span className={collapsed ? 'text-xs' : undefined}>{collapsed ? 'OCR' : t('title')}</span>
        </button>
        <button
          type="button"
          onClick={onToggle}
          title={collapsed ? t('expandSidebar') : t('collapseSidebar')}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <line x1="9" y1="3" x2="9" y2="21" />
          </svg>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 px-2">
          <SidebarSection
            title={t('modelExperiences')}
            items={experienceItems(hasTtsModels, hasRealtimeModels, hasImageParseModels, {
              language: t('languageModels'),
              tts: t('tts'),
              realtime: t('realtime'),
              imageParse: t('imageParse'),
            })}
            activeKey={activeExperience}
            collapsed={collapsed}
            onSelect={(key) => onSelectExperience(key as ExperienceKey)}
          />
        </div>

        {!collapsed && activeExperience === 'language' && (
          <PlaygroundHistoryList
            kind="language"
            sessions={sessions}
            activeSessionId={activeSessionId}
            onSelectSession={onSelectSession}
            onDeleteSession={onDeleteSession}
            onNewChat={onNewChat}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
          />
        )}
        {!collapsed && isDocumentExperience(activeExperience) && imageParseHistory ? (
          <div data-history-scroll="" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <PlaygroundHistoryList
              kind="image-parse"
              {...imageParseHistory}
              scrollMode="parent"
              sessions={documentSessions}
              hasCachedSessions={documentSessions.length > 0}
            />
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/* —— 内联图标（保持与门户一致的细线风格，避免新增依赖） —— */
function IconText() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 7V4h16v3M9 20h6M12 4v16" />
    </svg>
  );
}
function IconWave() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" />
    </svg>
  );
}
