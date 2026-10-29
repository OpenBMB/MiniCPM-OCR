import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  IMAGE_PARSE_SHARED_EXAMPLES,
  IMAGE_PARSE_WORKSPACE_EXAMPLES,
  isImageParseSharedExample,
} from '../imageParseExamples';

const assetDirectory = resolve(
  process.cwd(),
  'apps/portal/src/pages/playground/assets/ocr-examples',
);

const imageAssets = {
  physics: ['手写物理笔记.png', 'physics.png'],
  'student-sports': ['大学生乒乓球锦标赛通知.png', 'student-sports.png'],
  egdi: ['EGDI 分布图.png', 'egdi.png'],
  mechanics: ['相互作用力笔记.png', 'mechanics-formula.png'],
  'electric-field': ['电场公式笔记.png', 'electric-field.png'],
  'ft-newspaper': ['英文财经报纸.png', 'ft-newspaper.png'],
  'civil-trial': ['民事审判排期通知.png', 'civil-trial.png'],
  'dombey-son': ['Dombey and Son 书页.png', 'dombey-son.png'],
  'financial-table': ['财务报表.png', 'financial-table.png'],
} as const;

const pdfAssets = {
  newspaper: [
    '人民日报评论版.pdf',
    'newspaper.pdf',
    1_159_856,
    'ca782ec0776aaf3a0f5cfda9cd20de03bd594372e8b499f64bfdfbb67af00de6',
  ],
  'leave-calendar': [
    '请假审批表.pdf',
    'leave-calendar.pdf',
    323_903,
    'c3c9a9da6e69432d9c7972bcb53c0a7c8e7e763c7b2d068b16de8e7381f27e37',
  ],
} as const;

describe('共享案例原件与静态资产完整性', () => {
  it('展示用户提供的九张图片和两份 PDF 原件', () => {
    expect(IMAGE_PARSE_SHARED_EXAMPLES).toHaveLength(11);
    expect(IMAGE_PARSE_WORKSPACE_EXAMPLES).toHaveLength(11);
    expect(IMAGE_PARSE_SHARED_EXAMPLES.filter((example) => example.format === 'PNG')).toHaveLength(
      9,
    );
    expect(IMAGE_PARSE_SHARED_EXAMPLES.filter((example) => example.format === 'PDF')).toHaveLength(
      2,
    );
  });

  it('图片案例文件名与静态文件一致', () => {
    for (const [type, [filename, asset]] of Object.entries(imageAssets)) {
      const example = IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.type === type);
      expect(example).toMatchObject({
        filename,
        format: 'PNG',
        pages: [1],
      });
      expect(readFileSync(resolve(assetDirectory, asset)).byteLength).toBeGreaterThan(0);
    }
  });

  it('PDF 案例保留单页原件大小和哈希', () => {
    for (const [type, [filename, asset, size, hash]] of Object.entries(pdfAssets)) {
      const example = IMAGE_PARSE_SHARED_EXAMPLES.find((item) => item.type === type);
      const pdf = readFileSync(resolve(assetDirectory, asset));
      expect(example).toMatchObject({
        filename,
        format: 'PDF',
        pages: [1],
        pageCount: 1,
        sizeBytes: size,
      });
      expect(pdf.byteLength).toBe(size);
      expect(createHash('sha256').update(pdf).digest('hex')).toBe(hash);
    }
  });

  it('所有案例明确标记为暂不预识别版本', () => {
    for (const example of IMAGE_PARSE_SHARED_EXAMPLES) {
      expect(example.captureVersion).toBe('preview-20261027');
    }
  });

  it('旧案例 ID 仍归入共享案例，但不再展示为新入口', () => {
    expect(IMAGE_PARSE_WORKSPACE_EXAMPLES.some((example) => example.id === 'example:property')).toBe(
      false,
    );
    expect(isImageParseSharedExample('example:property')).toBe(true);
    expect(isImageParseSharedExample('personal-document')).toBe(false);
  });
});
