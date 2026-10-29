import type { ImageParseLayoutBlock } from '../imageParseSample';
/**
 * 图像解析单元测试固定数据。
 *
 * 用途：仅给单元测试提供稳定版面块与 Markdown，Playground 运行时不得引用。
 *
 * 固定数据不经过模型，也不代表线上识别结果。
 *
 */

/** 样例图原始像素尺寸，版面框按此归一化。 */
export const IMAGE_PARSE_SAMPLE_SIZE = { width: 2640, height: 3720 } as const;

/**
 * 样例图的 16 个版面块，按阅读顺序排列——检出动画依赖这个顺序自上而下推进。
 */
export const IMAGE_PARSE_SAMPLE_BLOCKS: readonly ImageParseLayoutBlock[] = [
  {
    kind: 'header',
    x: 0.0432,
    y: 0.029,
    w: 0.9148,
    h: 0.0734,
    text: 'MAP 图像解析样例\nSAMPLE · 会议纪要 / 表格 / 公式',
    markdown: '# MAP 图像解析样例',
    confidence: 0.994,
  },
  {
    kind: 'heading',
    x: 0.0739,
    y: 0.1339,
    w: 0.1477,
    h: 0.0161,
    text: '一、会议纪要',
    markdown: '## 一、会议纪要',
    confidence: 0.991,
  },
  {
    kind: 'text',
    x: 0.0727,
    y: 0.1661,
    w: 0.2523,
    h: 0.0145,
    text: '主题：Q3 模型体验中心评审',
    markdown: '- **主题：** Q3 模型体验中心评审',
    confidence: 0.986,
  },
  {
    kind: 'text',
    x: 0.0739,
    y: 0.1919,
    w: 0.2727,
    h: 0.0129,
    text: '时间：2026-09-17 14:00–15:30',
    markdown: '- **时间：** 2026-09-17 14:00–15:30',
    confidence: 0.978,
  },
  {
    kind: 'text',
    x: 0.0727,
    y: 0.2169,
    w: 0.2125,
    h: 0.0145,
    text: '地点：北京 · 线上同步',
    markdown: '- **地点：** 北京 · 线上同步',
    confidence: 0.983,
  },
  {
    kind: 'text',
    x: 0.0727,
    y: 0.2427,
    w: 0.4568,
    h: 0.0145,
    text: '结论：图像解析应对齐文档工作台，而不是聊天页。',
    markdown: '- **结论：** 图像解析应对齐文档工作台，而不是聊天页。',
    confidence: 0.989,
  },
  {
    kind: 'heading',
    x: 0.0739,
    y: 0.2798,
    w: 0.1477,
    h: 0.0169,
    text: '二、费用明细',
    markdown: '## 二、费用明细',
    confidence: 0.992,
  },
  {
    kind: 'table',
    x: 0.0727,
    y: 0.3113,
    w: 0.8557,
    h: 0.1363,
    text: [
      '项目\t数量\t单价\t金额',
      'GPU 评测机时\t12\t¥80\t¥960',
      '对象存储流量\t1\t¥36\t¥36',
      '合计\t\t\t¥996',
    ].join('\n'),
    markdown: [
      '| 项目 | 数量 | 单价 | 金额 |',
      '| --- | --- | --- | --- |',
      '| GPU 评测机时 | 12 | ¥80 | ¥960 |',
      '| 对象存储流量 | 1 | ¥36 | ¥36 |',
      '| 合计 |  |  | ¥996 |',
    ].join('\n'),
    confidence: 0.962,
  },
  {
    kind: 'heading',
    x: 0.075,
    y: 0.4847,
    w: 0.1466,
    h: 0.0169,
    text: '三、公式摘录',
    markdown: '## 三、公式摘录',
    confidence: 0.99,
  },
  {
    kind: 'text',
    x: 0.0739,
    y: 0.5169,
    w: 0.1068,
    h: 0.0145,
    text: '注意力权重：',
    markdown: '注意力权重：',
    confidence: 0.981,
  },
  {
    kind: 'formula',
    x: 0.0727,
    y: 0.5653,
    w: 0.8557,
    h: 0.0145,
    text: 'Attention(Q, K, V) = softmax(QKᵀ / √dₖ) V',
    markdown: [
      '$$',
      '\\mathrm{Attention}(Q, K, V) = \\mathrm{softmax}\\left(\\frac{QK^{T}}{\\sqrt{d_{k}}}\\right) V',
      '$$',
    ].join('\n'),
    confidence: 0.912,
  },
  {
    kind: 'heading',
    x: 0.0739,
    y: 0.6298,
    w: 0.0977,
    h: 0.0169,
    text: '四、待办',
    markdown: '## 四、待办',
    confidence: 0.993,
  },
  {
    kind: 'list',
    x: 0.075,
    y: 0.6605,
    w: 0.3943,
    h: 0.0145,
    text: '☐ 对照页顶栏与语言模型页保持同一套白底',
    markdown: '- [ ] 对照页顶栏与语言模型页保持同一套白底',
    confidence: 0.974,
  },
  {
    kind: 'list',
    x: 0.075,
    y: 0.6879,
    w: 0.2102,
    h: 0.0137,
    text: '☐ 上传后自动开始解析',
    markdown: '- [ ] 上传后自动开始解析',
    confidence: 0.977,
  },
  {
    kind: 'list',
    x: 0.075,
    y: 0.7153,
    w: 0.292,
    h: 0.0145,
    text: '☑ 提供默认样例图便于验收分栏',
    markdown: '- [x] 提供默认样例图便于验收分栏',
    confidence: 0.968,
  },
  {
    kind: 'note',
    x: 0.0739,
    y: 0.7621,
    w: 0.4091,
    h: 0.0121,
    text: '备注：无法辨认的文字请标记为 〔?〕，不要猜测填空。',
    markdown: '备注：无法辨认的文字请标记为 〔?〕，不要猜测填空。',
    confidence: 0.953,
  },
];

/**
 * 把块的 Markdown 片段拼成整篇结果。
 *
 * 连续的列表项之间只留一个换行，其余块之间留空行：判据取 Markdown 自身的 `- ` 前缀，
 * 而不是块的 kind——会议纪要四条在版面上是 text 块，在文档里却是同一个列表。
 * @param blocks 按阅读顺序排列的版面块
 */
function joinBlockMarkdown(blocks: readonly ImageParseLayoutBlock[]): string {
  const body = blocks
    .map((block, index) => {
      if (index === 0) return block.markdown;
      const inListRun =
        block.markdown.startsWith('- ') && blocks[index - 1].markdown.startsWith('- ');
      return `${inListRun ? '\n' : '\n\n'}${block.markdown}`;
    })
    .join('');
  return `${body}\n`;
}

/** 与样例图内容对齐的 Markdown，用来预览结果栏而不是空白空态。 */
export const IMAGE_PARSE_SAMPLE_MARKDOWN = joinBlockMarkdown(IMAGE_PARSE_SAMPLE_BLOCKS);
