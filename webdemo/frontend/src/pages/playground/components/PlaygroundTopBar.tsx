/**
 * Experience-center top bar.
 *
 * Purpose: model selector on the left; parameter settings / clear conversation (real features) on the right + "API access" (opens the access drawer).
 */

import { Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@map/ui';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import type { MapModel } from '@/api/map';
import { getPortalRouteTitle } from '@/router/routeCopy';
import { ModelSelector } from './ModelSelector';
import { experienceDocsPath } from '../utils/experienceRoute';

interface PlaygroundTopBarProps {
  models: MapModel[];
  modelsLoading: boolean;
  modelId: string;
  onSelectModel: (id: string) => void;
  onOpenSettings: () => void;
  onClear: () => void;
  canClear: boolean;
  /** Mobile: show the hamburger to summon the sidebar drawer */
  showMenuButton?: boolean;
  onOpenSidebar?: () => void;
}

/**
 * Top bar.
 */
export function PlaygroundTopBar({
  models,
  modelsLoading,
  modelId,
  onSelectModel,
  onOpenSettings,
  onClear,
  canClear,
  showMenuButton,
  onOpenSidebar,
}: PlaygroundTopBarProps) {
  const { t } = useTranslation('playground');
  const locale = useAppStore((state) => state.locale);
  const docsTitle = getPortalRouteTitle('/docs', locale, 'API 文档');

  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b border-border/25 bg-card px-4">
      <div className="flex min-w-0 items-center gap-1">
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
        <ModelSelector
          models={models}
          loading={modelsLoading}
          value={modelId}
          onChange={onSelectModel}
        />
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label={t('parameterSettings')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
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
                <line x1="4" y1="21" x2="4" y2="14" />
                <line x1="4" y1="10" x2="4" y2="3" />
                <line x1="12" y1="21" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12" y2="3" />
                <line x1="20" y1="21" x2="20" y2="16" />
                <line x1="20" y1="12" x2="20" y2="3" />
                <line x1="1" y1="14" x2="7" y2="14" />
                <line x1="9" y1="8" x2="15" y2="8" />
                <line x1="17" y1="16" x2="23" y2="16" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('parameterSettings')}</TooltipContent>
        </Tooltip>

        {/* Real feature: clear context (start a fresh conversation; the old conversation stays in "recent conversations") */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClear}
              disabled={!canClear}
              aria-label={t('clearContext')}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 1024 1024"
                fill="currentColor"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M202.24 900.468364a32.256 32.256 0 0 1-24.529455-11.310546 32.628364 32.628364 0 0 1-7.028363-26.018909l56.738909-334.289454h-14.103273a42.682182 42.682182 0 0 1-42.635636-42.682182V336.849455c0-23.552 19.083636-42.682182 42.635636-42.682182H384V187.578182c0-35.374545 28.672-64 64-64h129.256727c35.374545 0 64.046545 28.625455 64.046546 64V294.167273h169.378909c23.552 0 42.635636 19.083636 42.635636 42.682182v149.317818c0 23.598545-19.083636 42.682182-42.635636 42.682182h-14.103273l56.785455 334.289454a32.628364 32.628364 0 0 1-7.912728 26.065455 32.256 32.256 0 0 1-24.529454 11.264z m529.501091-371.618909H292.258909l-51.851636 307.665454 130.56-0.046545v-135.912728a32.023273 32.023273 0 0 1 64 0v135.912728h146.990545v-135.912728a32.023273 32.023273 0 0 1 64 0v135.912728h137.634909l-51.851636-307.618909zM576 187.578182h-128v128a42.682182 42.682182 0 0 1-42.682182 42.635636H234.682182v106.682182h554.635636V358.167273h-170.635636a42.682182 42.682182 0 0 1-42.682182-42.635637v-128z" />
              </svg>
            </button>
          </TooltipTrigger>
          <TooltipContent>{t('clearContext')}</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={experienceDocsPath('language')}
              target="_blank"
              rel="noreferrer"
              aria-label={docsTitle}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center gap-1.5 rounded-md text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground lg:w-auto lg:px-3"
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
