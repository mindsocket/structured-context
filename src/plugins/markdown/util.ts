/**
 * Coerce Date objects in frontmatter/YAML data to ISO date strings (YYYY-MM-DD).
 * gray-matter and js-yaml parse unquoted ISO dates (e.g. `date: 2026-03-31`) as
 * JavaScript Date objects, which are not valid JSON and fail string type validation.
 */
export function coerceDates(data: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Date) {
      result[key] = value.toISOString().slice(0, 10);
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = coerceDates(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Apply field remapping to a data object.
 * Renames keys according to fieldMap (file field name → canonical field name).
 * Fields not in the map are passed through unchanged.
 */
export function applyFieldMap(
  data: Record<string, unknown>,
  fieldMap: Record<string, string> | undefined,
): Record<string, unknown> {
  if (!fieldMap || Object.keys(fieldMap).length === 0) return data;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    result[fieldMap[key] ?? key] = value;
  }
  return result;
}

/**
 * Invert a fieldMap (file→canonical) to produce a reverse map (canonical→file).
 * Used for write operations (e.g. template-sync) to translate back to file field names.
 */
export function invertFieldMap(fieldMap: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(fieldMap).map(([src, canonical]) => [canonical, src]));
}
