/** Image-parse workspace: after upload, run full-text recognition automatically. Field extraction is configured first. The original and the result sit side by side. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@map/ui';
import { useAppStore } from '@map/store';
import type { usePlaygroundModel } from '../../hooks/usePlaygroundModel';
import { useImageParse } from '../../hooks/useImageParse';
import { useImageParseResultState } from '../../hooks/useImageParseResultState';
import { useImageParseScrollSync } from '../../hooks/useImageParseScrollSync';
import { useImageParseReadingPosition } from '../../hooks/useImageParseReadingPosition';
import { useImageParseWorkspaceSelection } from '../../hooks/useImageParseWorkspaceSelection';
import { useImageParseHistory } from '../../hooks/useImageParseHistory';
import { useImageParseCurrentRestore } from '../../hooks/useImageParseCurrentRestore';
import { useImageParseSidebarHistory } from '../../hooks/useImageParseSidebarHistory';
import { useImageParseExperienceTour } from '../../hooks/useImageParseExperienceTour';
import { useImageParseExamples } from '../../hooks/useImageParseExamples';
import { useImageParseEntryNavigation } from '../../hooks/useImageParseEntryNavigation';
import { useImageParseAppend } from '../../hooks/useImageParseAppend';
import { useImageParseExampleReparse } from '../../hooks/useImageParseExampleReparse';
import { useDocumentUpload } from '../../hooks/useDocumentUpload';
import { useImageParseWorkspaceIntake } from '../../hooks/useImageParseWorkspaceIntake';
import { useImageParseRegionCopy } from '../../hooks/useImageParseRegionCopy';
import { useSplitPane } from '../../hooks/useSplitPane';
import { useImageParseSetupScroll } from '../../hooks/useImageParseSetupScroll';
import { restoreImageParseBlocksToOriginal } from '../../utils/imageParseRotation';
import { writeCurrentImageParseId } from '../../utils/imageParseCurrent';
import { imageParseUploadRules } from '../../utils/documentUpload';
import { type ImageParseExampleType } from '../../utils/imageParseExamples';
import {
  imageParseKieExampleFile,
  type ImageParseKieExample,
} from '../../utils/imageParseKieExamples';
import { imageParseTaskView } from '../../utils/imageParseTaskView';
import { ImageLightbox } from '../ImageLightbox';
import { ImageParseToolbar } from './ImageParseToolbar';
import { ImageParseStatusStrip } from './ImageParseStatusStrip';
import { ImageParseDocumentWorkspace } from './ImageParseDocumentWorkspace';
import { ImageParseWorkspace } from './ImageParseWorkspace';
import type { PlaygroundSidebarHistory } from '../PlaygroundHistoryList';

type PlaygroundModel = ReturnType<typeof usePlaygroundModel>;

interface ImageParseExperienceProps {
  model: PlaygroundModel;
  task?: 'standard' | 'kie';
  /** Entering from the sidebar on purpose starts a new workspace; a direct entry or a refresh can still restore the current document. */
  startFresh?: boolean;
  showMenuButton?: boolean;
  onOpenSidebar?: () => void;
  onHistoryChange?: (history: PlaygroundSidebarHistory | undefined) => void;
}

/**
 * Image-parse experience page.
 * @param model Model and key orchestration
 * @param startFresh On a purposeful entry, skip automatic restore of the current history
 * @param showMenuButton On mobile, show the sidebar hamburger
 * @param onOpenSidebar Open the experience-center sidebar
 */
export function ImageParseExperience({
  model,
  task = 'standard',
  startFresh = false,
  showMenuButton,
  onOpenSidebar,
  onHistoryChange,
}: ImageParseExperienceProps) {
  const { t } = useTranslation('playground');
  const { toast } = useToast();
  const parse = useImageParse(model, {
    autoParse: false,
    autoParseOnUpload: true,
    initialMode: task,
  });
  const parseMode = parse.mode;
  const setParseMode = parse.setMode;
  useEffect(() => {
    if (task === 'kie' && parseMode !== 'kie') {
      setParseMode('kie');
    }
  }, [parseMode, setParseMode, task]);
  const append = useImageParseAppend(parse);
  const uploadRules = useMemo(() => imageParseUploadRules(parse.mode), [parse.mode]);
  const navigation = useImageParseEntryNavigation({
    userId: model.userId,
    projectId: model.defaultProjectId,
    task,
    startFresh,
  });
  const { scope } = navigation;
  const examples = useImageParseExamples(
    (snapshot) => {
      append.cancelAppend();
      if (!parse.restore(snapshot, { previewOnly: true })) return false;
      resetHistoryView();
      return true;
    },
    scope,
    parse.attachment?.id,
  );
  const history = useImageParseHistory({
    userId: model.userId,
    projectId: model.defaultProjectId,
    task,
    snapshot: parse.snapshot,
  });
  const {
    draft,
    ranges,
    linkedRanges,
    preview,
    previewRanges,
    previewLinkedRanges,
    previewCrops,
    quality,
    download,
  } = useImageParseResultState(parse, examples.pageKey);
  const split = useSplitPane();
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [showBlocks, setShowBlocks] = useState(true);
  const [linked, setLinked] = useState(true);
  const [kieSetupOpen, setKieSetupOpen] = useState(false);
  const [kieExamplePending, setKieExamplePending] = useState(false);
  const kieExampleController = useRef<AbortController | null>(null);
  const experienceRef = useRef<HTMLDivElement>(null);
  const markdownPaneRef = useRef<HTMLDivElement>(null);
  const hideHeaderFooter = useAppStore((s) => s.playground.imageParseHideHeaderFooter);
  const sync = useImageParseScrollSync(linked, parse.documentKey, parse.layout);
  const readingPosition = useImageParseReadingPosition({
    resultKey: parse.resultKey,
    preserveKey: hideHeaderFooter,
    scrollTo: sync.scrollResultTo,
  });
  const { viewportRef: readingViewportRef } = readingPosition;
  const { resultRef: syncResultRef } = sync;
  const resultScrollRef = useCallback(
    (node: HTMLDivElement | null) => {
      syncResultRef(node);
      readingViewportRef(node);
    },
    [readingViewportRef, syncResultRef],
  );
  const selection = useImageParseWorkspaceSelection(parse, showBlocks, linked);
  const currentPdfResult = parse.pdf?.current?.result;
  const originBlocks = currentPdfResult
    ? restoreImageParseBlocksToOriginal(parse.layout, currentPdfResult.rotation)
    : parse.layout;
  const [resultTab, setResultTab] = useState('preview');
  const copyRegion = useImageParseRegionCopy({
    markdown: draft.value,
    ranges,
    toast,
    translate: t,
  });
  const resetHistoryView = () => {
    setPreviewSrc(null);
    setKieSetupOpen(false);
    selection.reset();
    setResultTab('preview');
  };
  const cancelAutoRestore = useImageParseCurrentRestore({
    scope,
    startFresh: navigation.startFresh,
    parse,
    history,
    onRestore: resetHistoryView,
    acceptSnapshot: (snapshot) => (snapshot.mode === 'kie') === (task === 'kie'),
  });
  const upload = useDocumentUpload(
    (attachment) => {
      parse.setAttachment(attachment);
    },
    `${model.userId ?? ''}:${model.defaultProjectId ?? ''}`,
    () => {
      append.cancelAppend();
      cancelPendingRestore();
      examples.cancel();
      writeCurrentImageParseId(scope, null);
      parse.setAttachment(undefined);
      setPreviewSrc(null);
    },
    false,
    uploadRules,
  );
  useEffect(() => () => kieExampleController.current?.abort(), []);
  function handleNewDocument() {
    append.cancelAppend();
    cancelPendingRestore();
    examples.cancel();
    upload.cancel();
    writeCurrentImageParseId(scope, null);
    parse.setAttachment(undefined);
    resetHistoryView();
  }
  const cancelSidebarSelection = useImageParseSidebarHistory({
    scope,
    attachmentId: parse.attachment?.id,
    history,
    onChange: onHistoryChange,
    onSelectIntent: cancelAutoRestore,
    onRestore: (entry) => {
      if ((entry.snapshot.mode === 'kie') !== (task === 'kie')) {
        navigation.openEntry(entry);
        return false;
      }
      append.cancelAppend();
      examples.cancel();
      upload.cancel();
      if (!parse.restore(entry.snapshot)) {
        toast({ title: t('imageParseHistoryInvalid'), variant: 'error' });
        return false;
      }
      resetHistoryView();
      return true;
    },
    onNew: handleNewDocument,
    onExample: loadExample,
  });
  const uploading = upload.pending || examples.pending || kieExamplePending;
  const exampleReparse = useImageParseExampleReparse(parse.attachment, model, upload.upload, {
    selectionRevision: examples.selectionRevision,
    autoRun: !uploading && !parse.loading,
  });
  const { pipelineMode, hasKieResult, isPdf, showKieSetup, awaitingStart, showParseAction } =
    imageParseTaskView(parse, kieSetupOpen, uploading);
  const setupView = awaitingStart || showKieSetup || (pipelineMode && isPdf);
  const pageDrop = useImageParseWorkspaceIntake(
    (file) => void upload.upload(file),
    !parse.attachment && !uploading,
    uploadRules,
  );

  useImageParseSetupScroll(
    Boolean(parse.attachment && showKieSetup),
    experienceRef,
    markdownPaneRef,
  );

  function addFile(file: File) {
    append.cancelAppend();
    void upload.upload(file);
  }
  function cancelPendingRestore() {
    cancelAutoRestore();
    cancelSidebarSelection();
  }
  function loadExample(type: ImageParseExampleType) {
    append.cancelAppend();
    cancelPendingRestore();
    examples.cancel();
    upload.cancel();
    resetHistoryView();
    writeCurrentImageParseId(scope, null);
    examples.load(type);
  }

  async function loadKieExample(example: ImageParseKieExample) {
    if (kieExamplePending || upload.pending || examples.pending) return;
    kieExampleController.current?.abort();
    const controller = new AbortController();
    kieExampleController.current = controller;
    setKieExamplePending(true);
    append.cancelAppend();
    cancelPendingRestore();
    examples.cancel();
    upload.cancel();
    resetHistoryView();
    writeCurrentImageParseId(scope, null);
    try {
      const file = await imageParseKieExampleFile(example, controller.signal);
      const attachment = await upload.upload(file);
      if (attachment && !controller.signal.aborted) {
        parse.setFields(example.fields.map((field) => t(field)));
      }
    } catch {
      if (!controller.signal.aborted) {
        toast({ title: t('imageParseExampleLoadFailed'), variant: 'error' });
      }
    } finally {
      if (kieExampleController.current === controller) {
        kieExampleController.current = null;
        setKieExamplePending(false);
      }
    }
  }

  useImageParseExperienceTour({
    task,
    userId: model.userId,
    projectId: model.defaultProjectId,
    ready: !history.loading && !uploading && !parse.loading,
    hasDocument: Boolean(parse.attachment),
    standardResultReady: Boolean(
      !parse.loading &&
      (parse.finished || parse.pdf?.completed) &&
      (preview.markdown || preview.blocks.length || parse.pdf?.pages),
    ),
    hasKieResult: Boolean(!parse.loading && (hasKieResult || parse.pdf?.completed)),
    failed: Boolean(upload.error || parse.error),
  });

  const showUploadStatus = !parse.attachment && (uploading || Boolean(upload.error));
  const canReparseNow = exampleReparse.canReparseExample && !uploading && !parse.loading;

  return (
    <div
      ref={experienceRef}
      className="relative flex h-full min-h-0 min-w-0 w-full flex-col overflow-y-auto lg:overflow-hidden"
      {...pageDrop.containerProps}
    >
      <ImageParseToolbar
        fileName={parse.attachment?.name}
        parse={parse}
        uploading={uploading}
        onNewDocument={handleNewDocument}
        onAppendPages={pipelineMode ? undefined : (files) => void append.appendFiles(files)}
        appending={append.appending}
        showMenuButton={showMenuButton}
        onOpenSidebar={onOpenSidebar}
        showParseAction={showParseAction}
        onReparseExample={canReparseNow ? () => void exampleReparse.reparseExample() : undefined}
      />
      <ImageParseStatusStrip
        model={model}
        parse={parse}
        upload={upload}
        pipelineMode={pipelineMode}
        showUploadStatus={showUploadStatus}
      />
      {!showUploadStatus &&
        (parse.attachment ? (
          <ImageParseDocumentWorkspace
            parse={parse}
            split={split}
            selection={selection}
            resultState={{
              draft,
              ranges,
              linkedRanges,
              preview,
              previewRanges,
              previewLinkedRanges,
              previewCrops,
              quality,
              download,
            }}
            examples={examples}
            originBlocks={originBlocks}
            markdownPaneRef={markdownPaneRef}
            sync={sync}
            resultScrollRef={resultScrollRef}
            copyRegion={copyRegion}
            uploading={uploading}
            showKieSetup={showKieSetup}
            awaitingStart={awaitingStart}
            hasKieResult={hasKieResult}
            pipelineMode={pipelineMode}
            isPdf={isPdf}
            setupView={setupView}
            showBlocks={showBlocks}
            linked={linked}
            onPick={addFile}
            onClear={handleNewDocument}
            onPreview={setPreviewSrc}
            onSetupClose={() => setKieSetupOpen(false)}
            onDocumentMode={navigation.openDocument}
            onEditFields={() => setKieSetupOpen(true)}
            onToggleBlocks={() => setShowBlocks((value) => !value)}
            onShowBlocks={() => setShowBlocks(true)}
            onToggleLinked={() => setLinked((value) => !value)}
            resultTab={resultTab}
            onResultTabChange={(tab) => {
              setResultTab(tab);
              if (tab === 'review') setShowBlocks(true);
            }}
            fieldDraftKey={`${scope}:${parse.attachment.id}`}
          />
        ) : (
          <ImageParseWorkspace
            onPick={(file) => void addFile(file)}
            onExample={loadExample}
            onKieExample={loadKieExample}
            disabled={parse.loading || uploading}
            onNewDocument={handleNewDocument}
            uploadRules={uploadRules}
          />
        ))}
      {pageDrop.dragging ? (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-background/70 text-sm font-medium text-primary backdrop-blur-[2px]">
          {t('imageParseDropReplace')}
        </div>
      ) : null}
      <ImageLightbox
        src={parse.attachment ? previewSrc : null}
        onClose={() => setPreviewSrc(null)}
      />
    </div>
  );
}
