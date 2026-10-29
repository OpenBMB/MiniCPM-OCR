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
 * The current example is only for showing the original the user provided; body text and layout results are not pre-recognized for now.
 * Keep the fixed type id, so filling in precollected results later does not require changing the workspace entry.
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
  // Historical tests and old links can still be recognized as shared examples, but are no longer shown as an entry.
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

/** The original comes from a static asset; body text, coordinates, and rotation-adaptation info are not read for now. */
export const IMAGE_PARSE_SHARED_EXAMPLES = definitions.map((example) => ({
  ...example,
  captureVersion: 'preview-20261027',
  id: `example:${example.type}`,
  url: asset(example.assetName),
  thumbnail: asset(example.thumbnailName) || asset(example.assetName),
}));

/** The first screen shows every new example; images and PDFs share the same grid. */
export const IMAGE_PARSE_WORKSPACE_EXAMPLES = IMAGE_PARSE_SHARED_EXAMPLES;

/**
 * Whether an address is a version-pinned shared PDF original.
 * @param source PDF preview URL
 * @returns whether the shared original and page frames can be reused
 */
export function isImageParseSharedPdfUrl(source: string): boolean {
  return IMAGE_PARSE_SHARED_EXAMPLES.some(
    (example) => example.format === 'PDF' && example.url === source,
  );
}

/** Decide a shared original by the fixed example ID, so an example is not saved as personal cloud history. */
export function isImageParseSharedExample(id: string): boolean {
  return (
    retiredSharedExampleIds.has(id) ||
    IMAGE_PARSE_SHARED_EXAMPLES.some((example) => example.id === id)
  );
}

/**
 * Compatibility for old records that did not save a source, by the built-in example file name.
 * @param name saved original file name
 * @returns whether it belongs in the example group
 */
export function isImageParseExampleFilename(name: string): boolean {
  return IMAGE_PARSE_SHARED_EXAMPLES.some((example) => example.filename === name);
}
