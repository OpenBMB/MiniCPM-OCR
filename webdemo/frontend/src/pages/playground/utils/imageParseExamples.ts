const assets = import.meta.glob<string>('../assets/ocr-examples/*', {
  eager: true,
  query: '?url',
  import: 'default',
});

function asset(name: string): string {
  return assets[`../assets/ocr-examples/${name}`] ?? '';
}

interface ImageParseExampleDefinition {
  type: ImageParseExampleType;
  label: string;
  filename: string;
  assetName: string;
  thumbnailName: string;
  pages: readonly number[];
  format: 'PNG' | 'PDF';
  pageCount?: number;
  sizeBytes?: number;
}

/**
 * 当前案例只用于展示用户提供的原件，正文和版面结果暂不预识别。
 * 保留固定类型标识，后续补充预采集结果时无需改动工作台入口。
 */
const definitions: readonly ImageParseExampleDefinition[] = [
  {
    type: 'physics',
    label: 'imageParseCasePhysics',
    filename: '手写物理笔记.png',
    assetName: 'physics.png',
    thumbnailName: 'physics-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'student-sports',
    label: 'imageParseCaseStudentSports',
    filename: '大学生乒乓球锦标赛通知.png',
    assetName: 'student-sports.png',
    thumbnailName: 'student-sports-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'egdi',
    label: 'imageParseCaseEgdi',
    filename: 'EGDI 分布图.png',
    assetName: 'egdi.png',
    thumbnailName: 'egdi-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'mechanics',
    label: 'imageParseCaseMechanics',
    filename: '相互作用力笔记.png',
    assetName: 'mechanics-formula.png',
    thumbnailName: 'mechanics-formula-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'electric-field',
    label: 'imageParseCaseElectricField',
    filename: '电场公式笔记.png',
    assetName: 'electric-field.png',
    thumbnailName: 'electric-field-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'ft-newspaper',
    label: 'imageParseCaseFtNewspaper',
    filename: '英文财经报纸.png',
    assetName: 'ft-newspaper.png',
    thumbnailName: 'ft-newspaper-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'civil-trial',
    label: 'imageParseCaseCivilTrial',
    filename: '民事审判排期通知.png',
    assetName: 'civil-trial.png',
    thumbnailName: 'civil-trial-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'dombey-son',
    label: 'imageParseCaseDombeySon',
    filename: 'Dombey and Son 书页.png',
    assetName: 'dombey-son.png',
    thumbnailName: 'dombey-son-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'financial-table',
    label: 'imageParseCaseFinancialTable',
    filename: '财务报表.png',
    assetName: 'financial-table.png',
    thumbnailName: 'financial-table-thumb.webp',
    pages: [1],
    format: 'PNG',
  },
  {
    type: 'newspaper',
    label: 'imageParseCaseNewspaper',
    filename: '人民日报评论版.pdf',
    assetName: 'newspaper.pdf',
    thumbnailName: 'newspaper-thumb.webp',
    pages: [1],
    pageCount: 1,
    format: 'PDF',
    sizeBytes: 1_159_856,
  },
  {
    type: 'leave-calendar',
    label: 'imageParseCaseLeaveCalendar',
    filename: '请假审批表.pdf',
    assetName: 'leave-calendar.pdf',
    thumbnailName: 'leave-calendar-thumb.webp',
    pages: [1],
    pageCount: 1,
    format: 'PDF',
    sizeBytes: 323_903,
  },
];

export type ImageParseExampleType =
  | 'physics'
  | 'student-sports'
  | 'egdi'
  | 'mechanics'
  | 'electric-field'
  | 'ft-newspaper'
  | 'civil-trial'
  | 'dombey-son'
  | 'financial-table'
  | 'newspaper'
  | 'leave-calendar'
  // 历史测试与旧链接仍可识别为共享案例，但不再展示为入口。
  | 'property'
  | 'geometry'
  | 'linear-algebra'
  | 'invoices'
  | 'ziping'
  | 'agreement'
  | 'annual-report'
  | 'industry-report';

const retiredSharedExampleIds = new Set([
  'example:document',
  'example:property',
  'example:geometry',
  'example:linear-algebra',
  'example:invoices',
  'example:ziping',
  'example:agreement',
  'example:annual-report',
  'example:industry-report',
]);

/** 原件走静态资源；正文、坐标与摆正信息暂不读取。 */
export const IMAGE_PARSE_SHARED_EXAMPLES = definitions.map((example) => ({
  ...example,
  captureVersion: 'preview-20261027',
  id: `example:${example.type}`,
  url: asset(example.assetName),
  thumbnail: asset(example.thumbnailName) || asset(example.assetName),
}));

/** 首屏展示全部新案例；图片和 PDF 共用同一网格。 */
export const IMAGE_PARSE_WORKSPACE_EXAMPLES = IMAGE_PARSE_SHARED_EXAMPLES;

/**
 * 判断地址是否为版本固定的共享 PDF 原件。
 * @param source PDF 预览地址
 * @returns 是否可复用共享原件与页面帧
 */
export function isImageParseSharedPdfUrl(source: string): boolean {
  return IMAGE_PARSE_SHARED_EXAMPLES.some(
    (example) => example.format === 'PDF' && example.url === source,
  );
}

/** 按固定案例 ID 判断共享原件，避免案例被保存为个人云端历史。 */
export function isImageParseSharedExample(id: string): boolean {
  return (
    retiredSharedExampleIds.has(id) ||
    IMAGE_PARSE_SHARED_EXAMPLES.some((example) => example.id === id)
  );
}

/**
 * 按内置案例文件名兼容未保存来源的旧记录。
 * @param name 保存的原始文件名
 * @returns 是否归入案例分组
 */
export function isImageParseExampleFilename(name: string): boolean {
  return IMAGE_PARSE_SHARED_EXAMPLES.some((example) => example.filename === name);
}
