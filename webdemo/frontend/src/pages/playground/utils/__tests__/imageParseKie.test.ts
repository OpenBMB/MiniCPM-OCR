import { describe, expect, it } from 'vitest';

import {
  MAX_IMAGE_PARSE_KIE_FIELDS,
  imageParseKieFieldsError,
  imageParseKieRows,
  imageParseKieValues,
  normalizeImageParseKieFields,
  splitImageParseKieFields,
} from '../imageParseKie';

describe('图像解析信息抽取字段', () => {
  it('拆分中文、英文分隔符和多行文本，不拆分字段内空格', () => {
    expect(
      splitImageParseKieFields(' 姓名，电话、邮箱;地址；公司\n签署日期\tContract number '),
    ).toEqual(['姓名', '电话', '邮箱', '地址', '公司', '签署日期', 'Contract number']);
    expect(splitImageParseKieFields(' ,，\n')).toEqual([]);
  });

  it('去除首尾空白并保留字段顺序', () => {
    expect(normalizeImageParseKieFields([' 店名 ', '金额', '  '])).toEqual(['店名', '金额']);
  });

  it.each([
    [[], 'imageParseKieFieldsRequired'],
    [[''], 'imageParseKieFieldsEmpty'],
    [['  '], 'imageParseKieFieldsEmpty'],
    [['店名', '店名'], 'imageParseKieFieldsDuplicate'],
    [['店"名'], 'imageParseKieFieldsInvalid'],
    [["店'名"], 'imageParseKieFieldsInvalid'],
    [['店\n名'], 'imageParseKieFieldsInvalid'],
  ])('拒绝非法字段 %j', (fields, error) => {
    expect(imageParseKieFieldsError(fields)).toBe(error);
  });

  it('最多允许 20 个字段', () => {
    const fields = Array.from({ length: MAX_IMAGE_PARSE_KIE_FIELDS }, (_, index) => `f${index}`);
    expect(imageParseKieFieldsError(fields)).toBeUndefined();
    expect(imageParseKieFieldsError([...fields, 'overflow'])).toBe('imageParseKieFieldsTooMany');
  });
});

describe('图像解析信息抽取结果', () => {
  it('正文和统计使用相同字段顺序与缺失判定，不统计未请求的字段', () => {
    const values = imageParseKieValues(
      '{"店名":"面壁智能","金额":"###","日期":null,"数量":2,"备注":" ","额外":"忽略"}',
    );
    const rows = imageParseKieRows(values, ['店名', '金额', '日期', '数量', '备注', '地址']);
    expect(rows.map(({ field }) => field)).toEqual([
      '店名',
      '金额',
      '日期',
      '数量',
      '备注',
      '地址',
    ]);
    expect(rows.filter(({ missing }) => !missing).map(({ field }) => field)).toEqual([
      '店名',
      '数量',
    ]);
    expect(imageParseKieRows(null, ['店名'])).toEqual([]);
    expect(imageParseKieRows({ 店名: '面壁智能' }, [])).toEqual([
      { field: '店名', value: '面壁智能', missing: false },
    ]);
  });

  it('展开 JSON 对象与代码围栏', () => {
    expect(
      imageParseKieValues('```json\n{"店名":"面壁智能","金额":"###","数量":2,"有效":true}\n```'),
    ).toEqual({
      店名: '面壁智能',
      金额: '###',
      数量: '2',
      有效: 'true',
    });
  });

  it('空对象和全部空值仍是有效字段结果', () => {
    expect(imageParseKieValues('{}')).toEqual({});
    expect(imageParseKieValues('{"金额":null}')).toEqual({});
  });

  it('非 JSON、数组或嵌套值保持原 Markdown 展示', () => {
    expect(imageParseKieValues('模型返回了普通文本')).toBeNull();
    expect(imageParseKieValues('{"broken":')).toBeNull();
    expect(imageParseKieValues('["店名"]')).toBeNull();
    expect(imageParseKieValues('{"嵌套":{"值":"x"}}')).toBeNull();
  });
});
