/**
 * Parser for the filter expression DSL.
 *
 * Grammar (keywords are case-insensitive):
 *   WHERE {jsonata}                    — filter predicate only
 *   SELECT {spec} WHERE {jsonata}      — include spec + filter predicate
 *   SELECT {spec}                      — include spec only (Phase 2: expansion from all nodes)
 *   {jsonata}                          — bare JSONata treated as WHERE predicate (convenience)
 */

export type ParsedFilterExpression = {
  /** JSONata predicate evaluated per node. Absent means match all. */
  where?: string;
  /** Include spec for result expansion (Phase 1: stored but not evaluated). */
  include?: string;
};

/**
 * Parse a filter expression string into its WHERE and SELECT parts.
 * Throws a descriptive error on malformed input.
 */
export function parseFilterExpression(expr: string): ParsedFilterExpression {
  const trimmed = expr.trim();
  if (!trimmed) {
    throw new Error('Filter expression must not be empty');
  }

  // Case-insensitive keyword detection using regex
  // SELECT ... WHERE ... (both present)
  const selectWhereMatch = trimmed.match(/^SELECT\s+([\s\S]+?)\s+WHERE\s+([\s\S]+)$/i);
  if (selectWhereMatch) {
    const include = selectWhereMatch[1]!.trim();
    const where = selectWhereMatch[2]!.trim();
    if (!include) throw new Error('SELECT clause must not be empty');
    if (!where) throw new Error('WHERE clause must not be empty');
    return { include, where };
  }

  // SELECT ... (no WHERE)
  const selectOnlyMatch = trimmed.match(/^SELECT\s+([\s\S]+)$/i);
  if (selectOnlyMatch) {
    const include = selectOnlyMatch[1]!.trim();
    if (!include) throw new Error('SELECT clause must not be empty');
    // Detect SELECT {spec} WHERE (trailing WHERE with no content)
    if (/\sWHERE\s*$/i.test(include)) {
      throw new Error('WHERE clause must not be empty');
    }
    return { include };
  }

  // WHERE ... (no SELECT)
  const whereOnlyMatch = trimmed.match(/^WHERE\s+([\s\S]+)$/i);
  if (whereOnlyMatch) {
    const where = whereOnlyMatch[1]!.trim();
    if (!where) throw new Error('WHERE clause must not be empty');
    return { where };
  }

  // Detect a keyword used without any content (e.g. just "WHERE" or "SELECT")
  if (/^WHERE\s*$/i.test(trimmed)) {
    throw new Error('WHERE clause must not be empty');
  }
  if (/^SELECT\s*$/i.test(trimmed)) {
    throw new Error('SELECT clause must not be empty');
  }

  // Bare JSONata — treat as WHERE predicate
  return { where: trimmed };
}
