import { ListChecks, ScanText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Tabs, TabsList, TabsTrigger, cn } from '@map/ui';

import { isImageParsePipelineImageMode, type ImageParseMode } from '@/api/map/imageParseSdk';
import type { ImageParsePipelineCapabilities } from '@/api/map/imageParsePipeline';

interface ImageParseTaskBarProps {
  mode: ImageParseMode;
  capabilities: ImageParsePipelineCapabilities;
  onModeChange: (mode: ImageParseMode) => void;
  disabled?: boolean;
  isPdf?: boolean;
  hasDocument?: boolean;
}

const TASKS = [
  {
    value: 'standard',
    label: 'imageParseTaskDocument',
    hint: 'imageParseTaskDocumentHint',
    icon: ScanText,
  },
  {
    value: 'kie',
    label: 'imageParseTaskKie',
    hint: 'imageParseTaskKieHint',
    icon: ListChecks,
  },
] as const;

/**
 * The workspace shows only document recognition and field extraction supported by the algorithm service.
 */
export function ImageParseTaskBar({
  mode,
  capabilities,
  onModeChange,
  disabled = false,
  isPdf = false,
  hasDocument = true,
}: ImageParseTaskBarProps) {
  const { t } = useTranslation('playground');
  if (!capabilities.enabled && !isImageParsePipelineImageMode(mode)) return null;
  const active = mode === 'kie' ? TASKS[1] : TASKS[0];
  const pipelineOnPdf = isPdf && mode === 'seal';
  const hint = pipelineOnPdf ? t('imageParsePipelinePdfUnsupported') : t(active.hint);
  return (
    <div
      data-image-parse-task-bar=""
      className="flex shrink-0 flex-col border-b border-border/60 bg-card px-4 sm:px-6"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Tabs
          value={active.value}
          onValueChange={(next) => onModeChange(next as ImageParseMode)}
          className="w-full shrink-0 sm:w-auto"
        >
          <TabsList
            aria-label={t('imageParseTask')}
            className="h-12 w-full justify-start gap-5 rounded-none bg-transparent p-0 sm:w-auto [&>[data-map-tabs-indicator]]:hidden"
          >
            {TASKS.map((task) => {
              const available =
                task.value === 'standard' || (task.value === 'kie' && capabilities.kie);
              if (!available) return null;
              const Icon = task.icon;
              return (
                <TabsTrigger
                  key={task.value}
                  value={task.value}
                  aria-label={t(task.label)}
                  disabled={disabled}
                  className="group h-12 flex-1 gap-2 rounded-none border-b-2 border-transparent px-0 text-[13px] font-medium text-muted-foreground data-[state=active]:border-primary data-[state=active]:text-primary sm:flex-none"
                >
                  <Icon
                    className="size-3.5 text-muted-foreground transition-colors group-data-[state=active]:text-primary"
                    aria-hidden="true"
                  />
                  {t(task.label)}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </Tabs>
        {!hasDocument || pipelineOnPdf ? (
          <p
            aria-live="polite"
            className={cn(
              'flex min-w-0 flex-1 items-center gap-2 text-xs leading-5 text-muted-foreground',
              pipelineOnPdf && 'text-destructive',
            )}
          >
            <span>{hint}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
