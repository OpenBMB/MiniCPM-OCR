import { useState } from 'react';

/**
 * Isolate the field-configuration draft from the submitted fields, and keep unsubmitted configuration when the same file switches tasks.
 * @param applied submitted fields that correspond to the current result
 * @param documentKey file and account-scope id
 * @returns configuration fields, and the entries that update and discard the draft
 */
export function useImageParseFieldDraft(applied: readonly string[], documentKey: string) {
  const [draft, setDraft] = useState<{ key: string; fields: string[] }>();
  return {
    fields: draft?.key === documentKey ? draft.fields : applied,
    setFields: (fields: string[]) => setDraft({ key: documentKey, fields: [...fields] }),
    reset: () => setDraft(undefined),
  };
}
