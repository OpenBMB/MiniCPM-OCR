import type { CSSProperties, RefObject } from 'react';

import { cn } from '@map/ui';

import type { useImageParse } from '../../hooks/useImageParse';
import type { useImageParseExamples } from '../../hooks/useImageParseExamples';
import type { useImageParseRegionCopy } from '../../hooks/useImageParseRegionCopy';
import type { useImageParseResultState } from '../../hooks/useImageParseResultState';
import type { useImageParseScrollSync } from '../../hooks/useImageParseScrollSync';
import type { useImageParseWorkspaceSelection } from '../../hooks/useImageParseWorkspaceSelection';
import type { useSplitPane } from '../../hooks/useSplitPane';
import type { ImageParseLayoutBlock } from '../../utils/imageParseSample';
import { paneClass } from '../../utils/imageParseWorkspaceStyles';
import { ImageParseDropzone } from './ImageParseDropzone';
import { PaneDivider } from './ImageParsePanes';
import { ImageParseTaskPane } from './ImageParseTaskPane';

/** 已上传文档后的双栏工作区。 */
interface ImageParseDocumentWorkspaceProps {
  parse: ReturnType<typeof useImageParse>;
  split: ReturnType<typeof useSplitPane>;
  selection: ReturnType<typeof useImageParseWorkspaceSelection>;
  resultState: ReturnType<typeof useImageParseResultState>;
  examples: ReturnType<typeof useImageParseExamples>;
  originBlocks: readonly ImageParseLayoutBlock[];
  markdownPaneRef: RefObject<HTMLDivElement | null>;
  sync: ReturnType<typeof useImageParseScrollSync>;
  resultScrollRef: (node: HTMLDivElement | null) => void;
  copyRegion: ReturnType<typeof useImageParseRegionCopy>;
  uploading: boolean;
  showKieSetup: boolean;
  awaitingStart: boolean;
  hasKieResult: boolean;
  pipelineMode: boolean;
  isPdf: boolean;
  setupView: boolean;
  showBlocks: boolean;
  linked: boolean;
  onPick: (file: File) => void;
  onClear: () => void;
  onPreview: (src: string) => void;
  onSetupClose: () => void;
  onDocumentMode: () => void;
  onEditFields: () => void;
  onToggleBlocks: () => void;
  onShowBlocks: () => void;
  onToggleLinked: () => void;
  resultTab: string;
  onResultTabChange: (tab: string) => void;
  fieldDraftKey: string;
}

/**
 * 渲染原件与任务结果的双栏布局，不承担上传或识别状态编排。
 * @param props 当前解析状态、分栏与结果交互回调
 * @returns 文档工作区
 */
export function ImageParseDocumentWorkspace({
  parse,
  split,
  selection,
  resultState,
  examples,
  originBlocks,
  markdownPaneRef,
  sync,
  resultScrollRef,
  copyRegion,
  uploading,
  showKieSetup,
  awaitingStart,
  hasKieResult,
  pipelineMode,
  isPdf,
  setupView,
  showBlocks,
  linked,
  onPick,
  onClear,
  onPreview,
  onSetupClose,
  onDocumentMode,
  onEditFields,
  onToggleBlocks,
  onShowBlocks,
  onToggleLinked,
  resultTab,
  onResultTabChange,
  fieldDraftKey,
}: ImageParseDocumentWorkspaceProps) {
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
  } = resultState;
  return (
    <div
      {...split.containerProps}
      style={{ '--map-split': `${split.ratio}%` } as CSSProperties}
      className={cn(
        'flex min-h-0 min-w-0 w-full flex-none animate-[map-fade-in_0.25s_ease] flex-col bg-background lg:flex-1',
        'motion-reduce:animate-none lg:flex-row',
        split.dragging && 'cursor-col-resize select-none',
      )}
    >
      <div
        data-pane="origin"
        data-state="split"
        className={paneClass('origin', split.dragging, setupView)}
      >
        <ImageParseDropzone
          attachment={parse.attachment}
          disabled={uploading}
          onPick={onPick}
          onClear={onClear}
          onPreview={onPreview}
          page={parse.pdf?.page}
          onPageChange={parse.pdf?.setPage}
          imagePages={examples.images?.pages}
          imagePage={examples.images?.page}
          onImagePageChange={examples.images?.setPage}
          imageAttachments={examples.images?.attachments}
          blocks={originBlocks}
          rotation={parse.rotation}
          pageBlocks={selection.pageBlocks}
          pageServerAngles={selection.pageServerAngles}
          {...sync.originProps}
          progress={parse.progress}
          parsing={parse.loading}
          showBlocks={showBlocks}
          onToggleBlocks={onToggleBlocks}
          selectedBlockId={selection.selectedId}
          hoveredBlockId={selection.hoveredId}
          linkedHighlight={linked}
          onHoverBlock={selection.hover}
          focusRequest={selection.originFocus}
          onSelectBlock={(id, page) => {
            selection.selectOrigin(id, page);
            onResultTabChange('preview');
          }}
        />
      </div>
      <PaneDivider split={split} />
      <div
        ref={markdownPaneRef}
        data-pane="markdown"
        data-state="split"
        className={paneClass('markdown', split.dragging, setupView)}
      >
        <ImageParseTaskPane
          parse={parse}
          unsupported={pipelineMode && isPdf}
          awaitingStart={awaitingStart}
          showKieSetup={showKieSetup}
          uploading={uploading}
          hasKieResult={hasKieResult}
          fieldDraftKey={fieldDraftKey}
          onSetupClose={onSetupClose}
          onDocumentMode={onDocumentMode}
          onReplace={onPick}
          resultProps={{
            quality,
            ranges,
            draft,
            previewMarkdown: preview.markdown,
            previewLayout: preview.blocks,
            previewRanges,
            previewLinkedRanges,
            previewCrops,
            previewOnly: false,
            onCopyRegion: (id) => void copyRegion(id),
            downloading: download.downloading,
            onDownload: (format) => void download.download(format),
            onEditFields,
            resultPaneRef: sync.resultPaneRef,
            previewScrollRef: resultScrollRef,
            onPreviewFocus: sync.scrollResultTo,
            onPreviewScroll: sync.onResultScroll,
            selectedBlockId: selection.selectedId,
            hoveredBlockId: selection.hoveredId,
            onHoverBlock: selection.hover,
            selectedRange: selection.selectedId ? ranges.get(selection.selectedId) : undefined,
            linkedRanges,
            focusRequest: selection.resultFocus,
            linked,
            showBlocks,
            onToggleBlocks,
            exampleTableMerge: examples.images?.tableMerge,
            onToggleLinked,
            tab: resultTab,
            onTabChange: onResultTabChange,
            onSelectBlock: (id, page) => {
              selection.selectResult(id, page);
              onShowBlocks();
            },
          }}
        />
      </div>
    </div>
  );
}
