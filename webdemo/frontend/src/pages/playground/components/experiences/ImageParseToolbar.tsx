/**
 * 图像解析工作台顶栏。
 *
 * 用途：左侧显示文件名，右侧保留识别与结果操作；识别设置仅在已有文档时显示。
 * 空态保留汉堡键与文档入口，避免再叠一层体验中心标题栏。
 */

import { useRef } from 'react';
import {
  BookOpen,
  FilePlus2,
  LoaderCircle,
  Menu,
  RefreshCw,
  ScanText,
  Square,
  SquarePen,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@map/store';
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@map/ui';
import { getPortalRouteTitle } from '@/router/routeCopy';
import type { useImageParse } from '../../hooks/useImageParse';
import { DOCUMENT_ACCEPT } from '../../utils/documentUpload';
import { imageParseKieFieldsError } from '../../utils/imageParseKie';
import { WORKSPACE_CONTROL, WORKSPACE_ICON_CONTROL } from '../../utils/imageParseWorkspaceStyles';
import { experienceDocsPath, type ExperienceKey } from '../../utils/experienceRoute';

type ImageParseState = ReturnType<typeof useImageParse>;

interface ImageParseToolbarProps {
  fileName?: string;
  parse: ImageParseState;
  uploading: boolean;
  onNewDocument: () => void;
  showMenuButton?: boolean;
  onOpenSidebar?: () => void;
  /** 把本次选择的 PDF/图片接到当前识别后面；字段提取任务不提供追加入口。 */
  onAppendPages?: (files: FileList) => void;
  /** 正在合成追加页时禁用入口并展示进度文案。 */
  appending?: boolean;
  /** 字段配置阶段由设置面板提供主操作时隐藏顶栏识别按钮。 */
  showParseAction?: boolean;
  /** 共享示例没有可直接重跑的来源；由外层先转成个人上传任务。 */
  onReparseExample?: () => void;
}

/**
 * 对照工作台顶栏。有图后显示文件名与识别操作。
 */
export function ImageParseToolbar({
  fileName,
  parse,
  uploading,
  onNewDocument,
  showMenuButton,
  onOpenSidebar,
  onAppendPages,
  appending = false,
  showParseAction = true,
  onReparseExample,
}: ImageParseToolbarProps) {
  const { t } = useTranslation('playground');
  const appendInput = useRef<HTMLInputElement>(null);
  const { markdown, loading, error, attachment } = parse;
  const hasImage = Boolean(attachment);
  const hasResult = Boolean(parse.finished || markdown || error || parse.pdf?.completed);
  const appendDisabled = appending || uploading || loading;
  const kieFieldError = parse.mode === 'kie' ? imageParseKieFieldsError(parse.fields) : undefined;
  let parseButtonTitle: string | undefined;
  if (!parse.canParse) {
    parseButtonTitle = parse.blockedReason ? t(parse.blockedReason) : undefined;
  } else if (kieFieldError) {
    parseButtonTitle = t(kieFieldError);
  }

  let parseAction: React.ReactNode = null;
  if (hasImage && loading) {
    parseAction = (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={cn(WORKSPACE_CONTROL, 'shrink-0 gap-1.5 text-muted-foreground')}
        onClick={parse.stop}
      >
        <Square className="h-3.5 w-3.5" aria-hidden="true" />
        {t('imageParseStop')}
      </Button>
    );
  } else if (hasImage) {
    parseAction = (
      <Button
        type="button"
        size="sm"
        variant={hasResult ? 'ghost' : 'default'}
        className={cn(WORKSPACE_CONTROL, 'shrink-0 gap-1.5')}
        disabled={
          (!parse.canParse && !onReparseExample) || uploading || appending || Boolean(kieFieldError)
        }
        title={parseButtonTitle}
        onClick={() => {
          if (onReparseExample) onReparseExample();
          else void parse.parse();
        }}
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        {parse.mode === 'kie'
          ? t(hasResult ? 'imageParseReparseKie' : 'imageParseStartKie')
          : t(hasResult ? 'imageParseReparse' : 'imageParseStart')}
      </Button>
    );
  }

  return (
    <header className="flex min-h-14 shrink-0 flex-wrap items-center gap-2 bg-card px-3 py-2 sm:flex-nowrap sm:px-6">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {showMenuButton ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onOpenSidebar}
            aria-label={t('openMenu')}
            className={cn(WORKSPACE_ICON_CONTROL, 'text-muted-foreground')}
          >
            <Menu className="h-[18px] w-[18px]" aria-hidden="true" />
          </Button>
        ) : null}
        {hasImage ? (
          <>
            <span className="hidden size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary sm:flex">
              <ScanText className="size-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground" title={fileName}>
                {fileName}
              </p>
            </div>
          </>
        ) : (
          <h1 className="truncate text-sm font-semibold">
            {t(parse.mode === 'kie' ? 'imageParseKieWorkspaceTitle' : 'imageParseUploadTitle')}
          </h1>
        )}
      </div>
      {hasImage ? (
        <div className="order-3 flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:order-none sm:w-auto">
          {onAppendPages ? (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={cn(WORKSPACE_CONTROL, 'shrink-0 gap-1.5 px-3')}
                disabled={appendDisabled}
                aria-busy={appending || undefined}
                onClick={() => appendInput.current?.click()}
              >
                {appending ? (
                  <LoaderCircle
                    className="size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : (
                  <FilePlus2 className="size-4" aria-hidden="true" />
                )}
                {t(appending ? 'imageParseAddingPages' : 'imageParseAddPages')}
              </Button>
              <input
                ref={appendInput}
                type="file"
                multiple
                accept={DOCUMENT_ACCEPT}
                aria-label={t('imageParseAddPages')}
                className="hidden"
                disabled={appendDisabled}
                onChange={(event) => {
                  const files = event.target.files;
                  if (files?.length) onAppendPages(files);
                  event.target.value = '';
                }}
              />
            </>
          ) : null}
          <Button
            data-tour="image-parse-upload"
            type="button"
            size="sm"
            variant="ghost"
            className={cn(WORKSPACE_CONTROL, 'shrink-0 gap-1.5 px-3')}
            disabled={appending || uploading}
            onClick={onNewDocument}
          >
            <SquarePen className="size-4" aria-hidden="true" />
            {t('imageParseNewDocument')}
          </Button>
          {showParseAction ? parseAction : null}
        </div>
      ) : null}
      <div
        className={cn(
          'flex shrink-0 items-center gap-0.5',
          hasImage && 'border-l border-border pl-2',
        )}
      >
        <DocsLink experience={parse.mode === 'kie' ? 'field-extract' : 'image-parse'} />
      </div>
    </header>
  );
}

/** 顶栏文档入口。文档解析页打开本仓库的部署指南。 */
function DocsLink({ experience }: { experience: Exclude<ExperienceKey, 'language'> }) {
  const locale = useAppStore((state) => state.locale);
  const docsTitle = getPortalRouteTitle('/docs', locale, 'API 文档');
  const href =
    experience === 'image-parse'
      ? `https://github.com/OpenBMB/MiniCPM-OCR/blob/main/docs/${
          String(locale).toLowerCase().startsWith('en') ? 'webdemo_deploy.md' : 'webdemo_deploy_zh.md'
        }`
      : experienceDocsPath(experience);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          aria-label={docsTitle}
          className={cn(
            WORKSPACE_CONTROL,
            'inline-flex w-8 items-center justify-center px-0 text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:w-auto xl:gap-1.5 xl:px-2.5 [@media(pointer:coarse)]:min-w-11',
          )}
        >
          <BookOpen className="size-4" aria-hidden="true" />
          <span className="hidden text-xs font-medium xl:inline">{docsTitle}</span>
        </a>
      </TooltipTrigger>
      <TooltipContent>{docsTitle}</TooltipContent>
    </Tooltip>
  );
}
