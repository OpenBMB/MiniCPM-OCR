import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_ACCEPT,
  DOCUMENT_MAX_BYTES,
  documentFileError,
  PIPELINE_IMAGE_TYPES,
  imageParseUploadRules,
  isDocumentImageDataURL,
  isDocumentImageMime,
  isPipelineImageDataURL,
  normalizeDocumentFile,
} from '../documentUpload';

const supportedImageTypes = [
  'image/png',
  'image/jpeg',
  'image/bmp',
  'image/webp',
  'image/gif',
  'image/tiff',
  'image/avif',
  'image/heic',
] as const;

describe('documentUpload', () => {
  it('opens every image format supported by the OCR contract', () => {
    expect(DOCUMENT_ACCEPT).toBe(
      'application/pdf,.pdf,image/png,image/jpeg,image/jpg,image/gif,image/bmp,image/webp',
    );
  });

  it.each(supportedImageTypes)('accepts %s', (type) => {
    expect(
      documentFileError(new File(['image'], `page.${type.split('/')[1]}`, { type })),
    ).toBeUndefined();
  });

  it('accepts animated GIF and other browser image types', () => {
    expect(
      documentFileError(new File(['gif'], 'animated.gif', { type: 'image/gif' })),
    ).toBeUndefined();
    expect(isDocumentImageMime('image/webp')).toBe(true);
    expect(isDocumentImageDataURL('data:image/gif;base64,AAA')).toBe(true);
    expect(isDocumentImageDataURL('data:image/webp;base64,AAA')).toBe(true);
  });

  it('enforces the 64 MiB OCR upload limit', () => {
    const atLimit = new File(['image'], 'at-limit.png', { type: 'image/png' });
    Object.defineProperty(atLimit, 'size', { value: DOCUMENT_MAX_BYTES });
    expect(DOCUMENT_MAX_BYTES).toBe(64 * 1024 * 1024);
    expect(documentFileError(atLimit)).toBeUndefined();

    const overLimit = new File(['image'], 'over-limit.png', { type: 'image/png' });
    Object.defineProperty(overLimit, 'size', { value: DOCUMENT_MAX_BYTES + 1 });
    expect(documentFileError(overLimit)).toBe('documentFileTooLarge');
  });

  it('resolves image MIME from the extension when the browser omits it', () => {
    const gif = new File(['gif'], 'animated.gif', { type: '' });
    expect(documentFileError(gif)).toBeUndefined();
    expect(normalizeDocumentFile(gif).type).toBe('image/gif');
  });

  it('still rejects SVG because it is not a raster OCR input', () => {
    expect(documentFileError(new File(['image'], 'page.svg', { type: 'image/svg+xml' }))).toBe(
      'imageParseOnlyImage',
    );
    expect(isDocumentImageMime('image/svg+xml')).toBe(false);
    expect(isDocumentImageDataURL('data:image/svg+xml;base64,AAA')).toBe(false);
  });

  it('算法流水线拒绝 TIFF，印章只接收图片，抽取支持图片与 PDF', () => {
    const standard = imageParseUploadRules('standard-pipeline');
    expect(standard?.accept).toContain('application/pdf');
    expect(
      documentFileError(new File(['tiff'], 'scan.tiff', { type: 'image/tiff' }), standard),
    ).toBe('imageParsePipelineImageType');
    expect(
      documentFileError(new File(['pdf'], 'scan.pdf', { type: 'application/pdf' }), standard),
    ).toBeUndefined();
    expect(
      documentFileError(new File(['jpg'], 'scan.jpg', { type: 'image/jpg' }), standard),
    ).toBeUndefined();

    const seal = imageParseUploadRules('seal');
    expect(
      documentFileError(new File(['pdf'], 'scan.pdf', { type: 'application/pdf' }), seal),
    ).toBe('imageParsePipelineImageOnly');
    expect(seal?.singleImage).toBe(true);
    const kie = imageParseUploadRules('kie');
    expect(kie?.accept).toContain('application/pdf');
    expect(documentFileError(
      new File(['pdf'], 'contract.pdf', { type: 'application/pdf' }), kie,
    )).toBeUndefined();
    expect(kie?.singleImage).toBe(true);
  });

  it('算法流水线只接受文档列出的图片 data URI', () => {
    expect(isPipelineImageDataURL('data:image/png;base64,AAA')).toBe(true);
    expect(isPipelineImageDataURL('data:image/webp;base64,AAA')).toBe(true);
    expect(isPipelineImageDataURL('data:image/tiff;base64,AAA')).toBe(false);
    expect(imageParseUploadRules('scored')).toMatchObject({
      accept: ['application/pdf', ...PIPELINE_IMAGE_TYPES],
      imagesOnly: false,
      singleImage: false,
      hintKey: 'imageParseUploadHintPipeline',
    });
  });
});
