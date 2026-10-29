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
 * By task phase, show pending, field configuration, or the recognition result, and offer only one start entry at a time.
 * @param props Current task, action state, and result-panel parameters
 * @returns Task content on the right of the workspace
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
