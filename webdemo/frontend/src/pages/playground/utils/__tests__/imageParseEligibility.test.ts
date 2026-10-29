import { describe, expect, it } from 'vitest';
import {
  imageParseBlockedReason,
  imageParseCredentialBlocked,
} from '../imageParseEligibility';

const image = {
  id: 'image',
  kind: 'image' as const,
  name: 'page.png',
  mime: 'image/png',
  size: 3,
  dataUrl: 'data:image/png;base64,AA==',
};
const model = { id: 'minicpm-ocr-aio' };

describe('文档解析执行条件', () => {
  it.each([
    'image/png',
    'image/jpeg',
    'image/bmp',
    'image/webp',
    'image/gif',
  ] as const)('允许上游 OCR 支持的 %s 图片执行解析', (mime) => {
    expect(
      imageParseBlockedReason(
        {
          ...image,
          name: `page.${mime.split('/')[1]}`,
          mime,
          dataUrl: `data:${mime};base64,AA==`,
        },
        { imageParseModel: model },
      ),
    ).toBeUndefined();
  });

  it.each(['image/tiff', 'image/avif'] as const)(
    '拒绝上游 OCR 不支持的 %s 图片执行解析',
    (mime) => {
      expect(
        imageParseBlockedReason(
          {
            ...image,
            name: `page.${mime.split('/')[1]}`,
            mime,
            dataUrl: `data:${mime};base64,AA==`,
          },
          { imageParseModel: model },
        ),
      ).toBe('imageParsePipelineImageType');
    },
  );

  it('真实解析需要当前用户可见的文档解析模型', () => {
    expect(imageParseBlockedReason(image, { imageParseModel: undefined })).toBe(
      'imageParseNoModel',
    );
    expect(imageParseBlockedReason(image, { imageParseModel: model })).toBeUndefined();
  });

  it('共享示例读取数据库预采集结果，不要求模型权限', () => {
    const example = { ...image, id: 'example:physics', dataUrl: '/static/physics.png' };
    expect(imageParseBlockedReason(example, { imageParseModel: undefined })).toBeUndefined();
  });

  it('印章只支持单图，信息抽取支持原始 PDF', () => {
    const pdf = {
      id: 'pdf',
      kind: 'file' as const,
      name: 'scan.pdf',
      mime: 'application/pdf',
      size: 12,
      dataUrl: 'data:application/pdf;base64,AA==',
    };
    expect(imageParseBlockedReason(pdf, { imageParseModel: model }, 'seal')).toBe(
      'imageParsePipelinePdfUnsupported',
    );
    expect(imageParseBlockedReason(pdf, { imageParseModel: model }, 'kie')).toBeUndefined();
    expect(imageParseBlockedReason(pdf, { imageParseModel: model }, 'scored')).toBeUndefined();
  });

  it('算法档位允许旧历史先补传为 OBS 文件引用，并校验图片格式', () => {
    expect(
      imageParseBlockedReason(image, { imageParseModel: model }, 'standard-pipeline'),
    ).toBeUndefined();
    expect(
      imageParseBlockedReason(
        { ...image, dataUrl: 'https://files.example/signed.png' },
        { imageParseModel: model },
        'standard-pipeline',
      ),
    ).toBe('imageParseFileReferenceRequired');
    expect(
      imageParseBlockedReason(
        { ...image, fileId: 'file_page' },
        { imageParseModel: model },
        'seal',
      ),
    ).toBeUndefined();
    expect(
      imageParseBlockedReason(
        { ...image, mime: 'image/tiff', dataUrl: 'data:image/tiff;base64,AA==', fileId: 'file_page' },
        { imageParseModel: model },
        'kie',
      ),
    ).toBe('imageParsePipelineImageType');
  });

  it('默认文档档位有 OBS 文件引用时不依赖本地 data URI', () => {
    expect(
      imageParseBlockedReason(
        { ...image, fileId: 'file_page', dataUrl: 'https://files.example/signed.png' },
        { imageParseModel: model },
        'scored',
      ),
    ).toBeUndefined();
  });
});

describe('文档解析凭据条件', () => {
  it('区分密钥读取、无可用密钥与自有密钥读取中', () => {
    expect(
      imageParseCredentialBlocked({
        keysLoading: true,
        secretReady: false,
        trialAvailable: false,
        hasKeys: false,
      }),
    ).toBe('sendKeyLoading');
    expect(
      imageParseCredentialBlocked({
        keysLoading: false,
        secretReady: false,
        trialAvailable: false,
        hasKeys: false,
      }),
    ).toBe('sendNoApiKey');
    expect(
      imageParseCredentialBlocked({
        keysLoading: false,
        keyId: 'key-1',
        secretReady: false,
        trialAvailable: false,
        hasKeys: true,
      }),
    ).toBe('sendKeyReading');
    expect(
      imageParseCredentialBlocked({
        keysLoading: false,
        keyId: 'key-1',
        secretReady: true,
        trialAvailable: false,
        hasKeys: true,
      }),
    ).toBeUndefined();
  });
});
