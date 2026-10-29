import type { ComponentProps } from 'react';

import type { useImageParse } from '../../hooks/useImageParse';
import { useImageParseFieldDraft } from '../../hooks/useImageParseFieldDraft';
import { ImageParseKieSetupPane } from './ImageParseKieSetupPane';
import { ImageParseReadyPane } from './ImageParseReadyPane';
import { ImageParseResultPane } from './ImageParseResultPane';

interface ImageParseTaskPaneProps {
  parse: ReturnType<typeof useImageParse>;
  unsupported: boolean;
  awaitingStart: boolean;
  showKieSetup: boolean;
  uploading: boolean;
  hasKieResult: boolean;
  fieldDraftKey: string;
  onSetupClose: () => void;
  onDocumentMode: () => void;
  onReplace: (file: File) => void;
  resultProps: Omit<ComponentProps<typeof ImageParseResultPane>, 'parse'>;
}

/**
 * 按任务阶段显示待执行、字段配置或识别结果，同一时刻仅提供一个开始入口。
 * @param props 当前任务、操作状态及结果面板参数
 * @returns 工作台右侧任务内容
 */
export function ImageParseTaskPane({
  parse,
  unsupported,
  awaitingStart,
  showKieSetup,
  uploading,
  hasKieResult,
  fieldDraftKey,
  onSetupClose,
  onDocumentMode,
  onReplace,
  resultProps,
}: ImageParseTaskPaneProps) {
  const fieldDraft = useImageParseFieldDraft(parse.fields, fieldDraftKey);
  if (unsupported || (awaitingStart && !showKieSetup)) {
    return (
      <ImageParseReadyPane
        unsupported={unsupported}
        canStart={parse.canParse && !uploading}
        blockedReason={parse.blockedReason}
        onStart={() => void parse.parse()}
        onDocumentMode={onDocumentMode}
        onReplace={onReplace}
      />
    );
  }
  if (showKieSetup) {
    return (
      <ImageParseKieSetupPane
        key={fieldDraftKey}
        fields={fieldDraft.fields}
        onChange={fieldDraft.setFields}
        onStart={(fields) => {
          void parse.parse({ fields });
          fieldDraft.reset();
          onSetupClose();
        }}
        onBack={
          hasKieResult
            ? () => {
                fieldDraft.reset();
                onSetupClose();
              }
            : undefined
        }
        disabled={parse.loading || uploading}
        canStart={parse.canParse && !uploading}
        blockedReason={parse.blockedReason}
      />
    );
  }
  return <ImageParseResultPane key={parse.documentKey} parse={parse} {...resultProps} />;
}
