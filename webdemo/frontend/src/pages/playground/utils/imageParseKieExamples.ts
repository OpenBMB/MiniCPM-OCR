import restaurantReceiptImage from '../assets/ocr-examples/kie-restaurant-receipt.png';
import taxiReceiptImage from '../assets/ocr-examples/kie-taxi-receipt.png';

/** Built-in example type for key information extraction. */
export type ImageParseKieExampleType = 'taxi-receipt' | 'restaurant-receipt';

/** Built-in examples for key information extraction; fields use translation keys and, once selected, generate request fields in the current language. */
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

/** Two real receipt originals, which can be workspace entries the same way document-parsing examples can. */
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
 * Turn a built-in example's static asset back into an uploadable file.
 * @param example current example
 * @param signal cancellation signal
 * @returns image PNG file
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
