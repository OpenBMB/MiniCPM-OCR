/** Runtime state of the OCR history autosave queue. */
export interface ImageParseHistoryQueue {
  tail: Promise<void>;
  active?: { id: string; attachmentId: string };
  deleted: Set<string>;
}

/** Create a save queue isolated by account scope; after an account switch, discard the old queue directly. */
export function createImageParseHistoryQueue(): ImageParseHistoryQueue {
  return { tail: Promise.resolve(), deleted: new Set<string>() };
}
