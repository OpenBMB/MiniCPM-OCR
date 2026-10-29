import restaurantReceiptImage from '../assets/ocr-examples/kie-restaurant-receipt.png';
import taxiReceiptImage from '../assets/ocr-examples/kie-taxi-receipt.png';

/** 关键信息抽取内置案例类型。 */
export type ImageParseKieExampleType = 'taxi-receipt' | 'restaurant-receipt';

/** 关键信息抽取内置案例；字段使用翻译键，选择后按当前语言生成请求字段。 */
export interface ImageParseKieExample {
  id: string;
  type: ImageParseKieExampleType;
  label: string;
  filename: string;
  thumbnail: string;
  format: 'PNG';
  pages: readonly number[];
  fields: readonly string[];
}

/** 两张真实票据原件，与文档解析案例一样可作为工作台入口。 */
export const IMAGE_PARSE_KIE_EXAMPLES: readonly ImageParseKieExample[] = [
  {
    id: 'example:kie-taxi-receipt',
    type: 'taxi-receipt',
    label: 'imageParseKieSampleTaxiTitle',
    filename: '出租车发票.png',
    thumbnail: taxiReceiptImage,
    format: 'PNG',
    pages: [1],
    fields: [
      'imageParseKieFieldInvoiceCode',
      'imageParseKieFieldInvoiceNumber',
      'imageParseKieFieldDate',
      'imageParseKieFieldAmount',
    ],
  },
  {
    id: 'example:kie-restaurant-receipt',
    type: 'restaurant-receipt',
    label: 'imageParseKieSampleRestaurantTitle',
    filename: '餐厅小票.png',
    thumbnail: restaurantReceiptImage,
    format: 'PNG',
    pages: [1],
    fields: [
      'imageParseKieFieldMerchant',
      'imageParseKieFieldDate',
      'imageParseKieFieldItems',
      'imageParseKieFieldTotal',
    ],
  },
];

/**
 * 把内置案例静态资源还原为可上传文件。
 * @param example 当前案例
 * @param signal 取消信号
 * @returns 图片 PNG 文件
 */
export async function imageParseKieExampleFile(
  example: ImageParseKieExample,
  signal: AbortSignal,
): Promise<File> {
  signal.throwIfAborted();
  const response = await fetch(example.thumbnail, { signal });
  if (!response.ok) throw new Error('imageParseExampleLoadFailed');
  const blob = await response.blob();
  signal.throwIfAborted();
  return new File([blob], example.filename, { type: 'image/png' });
}
