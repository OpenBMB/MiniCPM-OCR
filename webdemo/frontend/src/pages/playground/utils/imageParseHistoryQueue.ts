/** OCR 历史自动保存队列的运行时状态。 */
export interface ImageParseHistoryQueue {
  tail: Promise<void>;
  active?: { id: string; attachmentId: string };
  deleted: Set<string>;
}

/** 创建隔离账号范围的保存队列；切换账号后直接丢弃旧队列。 */
export function createImageParseHistoryQueue(): ImageParseHistoryQueue {
  return { tail: Promise.resolve(), deleted: new Set<string>() };
}
