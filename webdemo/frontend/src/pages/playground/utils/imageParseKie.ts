/** 关键信息抽取字段约束与结果展示解析，与后端校验保持一致。 */

export const MAX_IMAGE_PARSE_KIE_FIELDS = 20;

/** 将批量输入按常见分隔符拆分，保留字段内部空格和原始顺序。 */
export function splitImageParseKieFields(value: string): string[] {
  return value
    .split(/[,，、;；\r\n\t]+/)
    .map((field) => field.trim())
    .filter(Boolean);
}

/** 字段在去空白后必须非空、唯一，且不能包含会破坏提示词的引号或换行。 */
export function imageParseKieFieldsError(fields: readonly string[]): string | undefined {
  if (fields.length === 0) return 'imageParseKieFieldsRequired';
  if (fields.length > MAX_IMAGE_PARSE_KIE_FIELDS) return 'imageParseKieFieldsTooMany';
  const seen = new Set<string>();
  for (const raw of fields) {
    const field = raw.trim();
    if (!field) return 'imageParseKieFieldsEmpty';
    if (/["'\r\n]/.test(field)) return 'imageParseKieFieldsInvalid';
    if (seen.has(field)) return 'imageParseKieFieldsDuplicate';
    seen.add(field);
  }
  return undefined;
}

/** 提交前统一去掉首尾空白；后端会再次校验，不能只依赖前端。 */
export function normalizeImageParseKieFields(fields: readonly string[]): string[] {
  return fields.map((field) => field.trim()).filter(Boolean);
}

/** 解析模型返回的 JSON 对象；不是对象或不是 JSON 时返回 null，保留原文展示。 */
export function imageParseKieValues(content: string): Record<string, string> | null {
  const trimmed = content.trim();
  const unfenced = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  if (!unfenced.startsWith('{')) return null;
  try {
    const value: unknown = JSON.parse(unfenced);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const output: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
        output[key] = String(raw);
      } else if (raw !== null) {
        return null;
      }
    }
    return output;
  } catch {
    return null;
  }
}

/** 按请求顺序生成结果行，统一正文与工具栏对漏字段、空值和占位值的判断。 */
export function imageParseKieRows(
  values: Record<string, string> | null,
  fields: readonly string[],
) {
  if (!values) return [];
  const requested = fields.length > 0 ? fields : Object.keys(values);
  return requested.map((field) => {
    const value = values[field];
    return { field, value, missing: value === undefined || !value.trim() || value === '###' };
  });
}
