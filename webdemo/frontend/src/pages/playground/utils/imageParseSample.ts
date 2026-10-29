/** 图像解析版面块类型与旧样例 ID；运行时识别结果只能来自服务端。 */

/**
 * 旧内置样例附件 ID。仅用于拒绝历史缓存把本地演示结果保存成个人记录，
 * 不再提供任何本地演示附件或识别结果。
 */
export const IMAGE_PARSE_SAMPLE_ATTACHMENT_ID = 'image-parse-sample';

/** 版面块语义类型，决定框线颜色与类型角标。 */
export type ImageParseBlockKind =
  | 'header'
  | 'footer'
  | 'heading'
  | 'text'
  | 'table'
  | 'formula'
  | 'list'
  | 'note'
  | 'image'
  | 'chart'
  | 'seal';

/** 服务端旋转摆正信息；坐标始终基于摆正后的图片。 */
export interface ImageParseRotationInfo {
  enabled: boolean;
  applied: boolean;
  /** 服务端实际逆时针旋转角度；浏览器显示使用反向角度。 */
  totalAngle: number;
  /** 摆正没跑出预测（未启用 / gated）时为 null。 */
  predictedAngle: number | null;
  predictedScore: number | null;
  confirmed: boolean | null;
  orientationAngle: number;
  deskewAngle: number;
  skippedReason: string | null;
}

/** 版面块内的一个归一化区域；合并块会包含多个区域。 */
export interface ImageParseLayoutRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 一个版面块：归一化坐标（0–1）+ 语义类型 + 识别内容。 */
export interface ImageParseLayoutBlock {
  /** 服务返回的稳定标识，可选；没有标识时以坐标和阅读顺序组合标识。 */
  id?: string;
  /** 服务阅读序号从 0 开始；旧结果缺省时取数组位置。 */
  order?: number;
  label?: string;
  status?: string;
  /** 在整篇 Markdown 中的 UTF-16 起止偏移，用于消除重复文字的歧义。 */
  markdownStart?: number;
  markdownEnd?: number;
  kind: ImageParseBlockKind;
  /** 左上角 x，占图宽比例 */
  x: number;
  /** 左上角 y，占图高比例 */
  y: number;
  /** 宽度占比 */
  w: number;
  /** 高度占比 */
  h: number;
  /** 服务端返回的全部区域；缺省时使用主 bbox 渲染。 */
  regions?: readonly ImageParseLayoutRegion[];
  /**
   * 该块在图上识别到的原始文字：保留图上的换行，表格按行分行、按列用制表符分隔。
   * 与 markdown 的区别是这里没有结构——标题不带 `#`，列表不带 `-`，复选框是字符本身。
   */
  text: string;
  /** 该块结构化后的 Markdown 片段，按阅读顺序拼起来即「原文」页内容。 */
  markdown: string;
  /** 服务返回的 0–1 置信度，缺失时为 null；前端不估算。 */
  confidence: number | null;
  /** 跨页表格合并标记；true 时 score 只代表合并前半表。 */
  ttsInvalid?: boolean;
  /** 跨页表格合并：本块是上一页表格的续表，内容已并入上一页，本页清空。 */
  mergedIntoPreviousPage?: boolean;
}
