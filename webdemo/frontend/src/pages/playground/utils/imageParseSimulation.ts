/** 进度组件的状态契约；当前 OCR 仅返回最终结果，不在前端模拟进度。 */

/** 解析阶段。顺序即执行顺序，界面按这个顺序推进扫描与版面框。 */
export type ImageParseStage = 'layout' | 'structure' | 'render';

/** 服务端进度快照；尚无进度事件时使用 null，不合成百分比。 */
export interface ImageParseProgressSnapshot {
  stage: ImageParseStage;
  /** 总进度 0–100 */
  percent: number;
  /** 已检出的版面块数量，驱动原图上的框逐个出现 */
  detectedBlocks: number;
  /** 已完成结构还原的版面块数量，驱动框的高亮向下推进 */
  scannedBlocks: number;
  /** 当前已流出的 Markdown 片段 */
  markdown: string;
}
