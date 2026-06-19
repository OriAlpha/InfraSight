/**
 * Extracts {{variable}} placeholders from template text.
 * @param {string} text - Template text to scan
 * @returns {string[]} Array of unique variable names
 */
export function extractVariables(text) {
  if (!text) return [];
  const matches = text.matchAll(/\{\{\s*(\w+)\s*\}\}/g);
  const vars = new Set();
  for (const match of matches) {
    vars.add(match[1]);
  }
  return Array.from(vars);
}
