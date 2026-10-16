/** Plain-language names for YAML value types, used in error messages written for learners. */
export function describeValue(value: unknown): string {
  if (value === null || value === undefined) return 'empty (null)';
  if (Array.isArray(value)) return 'a list';
  switch (typeof value) {
    case 'string':
      return 'text';
    case 'number':
      return 'a number';
    case 'boolean':
      return 'true or false';
    case 'object':
      return 'a nested map';
    default:
      return typeof value;
  }
}
