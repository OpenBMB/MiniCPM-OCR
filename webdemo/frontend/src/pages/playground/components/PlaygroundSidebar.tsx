/**
 * Left sidebar of the experience center.
 *
 * Purpose: "back + collapse" at the top; the "model experiences" group is shown dynamically from the models visible to the current user; the history list at the bottom uses the data and actions for the current experience.
 */

import { ListChecks, ScanText } from 'lucide-react';
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
  /** Currently active item in model experiences */
  activeExperience: ExperienceKey;
  onSelectExperience: (key: ExperienceKey) => void;
  /** Recent conversations */
  sessions: SidebarSession[];
  activeSessionId?: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onNewChat: () => void;
  /** Whether the current user has a speech-synthesis model (otherwise do not render that entry) */
  hasTtsModels?: boolean;
  /** Whether the current user has a realtime audio-video model (otherwise do not render that entry) */
  hasRealtimeModels?: boolean;
  /** Whether the current user has a document-parse model (otherwise do not render that entry) */
  hasImageParseModels?: boolean;
  /** Whether more history can be loaded */
  hasMore?: boolean;
  /** Loading more */
  loadingMore?: boolean;
  /** Explicitly load the next page */
  onLoadMore?: () => void;
  /** OCR cloud personal history; the body is read on demand by the OCR workspace. */
  imageParseHistory?: PlaygroundSidebarHistory;
}

/**
 * Items in the model-experiences group. The language model is always present; speech synthesis / realtime audio-video / document parse are added or removed from the models visible to the current user.
 * @param hasTts Whether there is a speech-synthesis model
 * @param hasRealtime Whether there is a realtime audio-video model
 * @param hasImageParse Whether there is a document-parse model
 * @returns Experience entries that can be shown
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
    fieldExtract: string;
  },
): SidebarItem[] {
  if (hasImageParse) {
    return [
      {
        key: 'image-parse',
        label: labels.imageParse,
        icon: <ScanText className="h-4 w-4" aria-hidden="true" />,
      },
      {
        key: 'field-extract',
        label: labels.fieldExtract,
        icon: <ListChecks className="h-4 w-4" aria-hidden="true" />,
      },
    ];
  }
  return [];
}

/**
 * Left sidebar.
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
      {/* Top: back + collapse */}
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
              fieldExtract: t('fieldExtract'),
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

/* —— Inline icons (keep the same thin-line style as the portal, and avoid a new dependency) —— */
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
