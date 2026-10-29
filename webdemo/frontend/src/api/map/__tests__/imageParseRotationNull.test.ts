import { describe, expect, it } from 'vitest';

import { sanitizeImageParseRotation } from '../imageParseSdk';

const base = {
  enabled: true,
  applied: false,
  totalAngle: 0,
  orientationAngle: 0,
  deskewAngle: 0,
  confirmed: null,
  skippedReason: 'gated',
};

describe('sanitizeImageParseRotation', () => {
  it('未实际摆正时允许预测字段为 null', () => {
    expect(
      sanitizeImageParseRotation({ ...base, predictedAngle: null, predictedScore: null }),
    ).toMatchObject({ predictedAngle: null, predictedScore: null });
  });

  it('实际摆正时预测字段必须有值', () => {
    expect(
      sanitizeImageParseRotation({
        ...base,
        applied: true,
        predictedAngle: null,
        predictedScore: null,
      }),
    ).toBeNull();
  });

  it('有预测分数时仍限制在 0~1', () => {
    expect(
      sanitizeImageParseRotation({
        ...base,
        predictedAngle: 2,
        predictedScore: 1.1,
      }),
    ).toBeNull();
  });
});
