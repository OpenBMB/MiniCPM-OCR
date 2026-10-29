/** Key information extraction field constraints and result-display parsing, kept consistent with backend validation. */

export const MAX_IMAGE_PARSE_KIE_FIELDS = 20;

/** Split batch input on common separators, keeping spaces inside a field and the original order. */
export function splitImageParseKieFields(value: string): string[] {
  return value
    .split(/[,，、;；\r\n\t]+/)
    .map((field) => field.trim())
    .filter(Boolean);
}

/** After whitespace is removed, a field must be non-empty and unique, and must not contain quotes or newlines that would break the prompt. */
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

/** Strip leading and trailing whitespace before submit; the backend validates again, so the frontend must not be the only check. */
export function normalizeImageParseKieFields(fields: readonly string[]): string[] {
  return fields.map((field) => field.trim()).filter(Boolean);
}

/** Parse the JSON object returned by the model; return null when it is not an object or not JSON, and keep the original text for display. */
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

/** Build result rows in request order, so the body and the toolbar judge missing fields, empty values, and placeholder values the same way. */
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
