/**
 * Utility for parsing SQLite datetime strings with cross-browser compatibility (e.g. Safari / WebKit).
 *
 * @param {string|Date} dateVal
 * @returns {Date}
 */
export function parseDate(dateVal) {
  if (!dateVal) return new Date();
  if (dateVal instanceof Date) return dateVal;
  
  if (typeof dateVal === 'string') {
    // If it is already in ISO format with 'T', or doesn't have a space, return as is
    // Otherwise, replace space with 'T' to prevent Invalid Date on Safari
    const cleaned = dateVal.includes(' ') ? dateVal.replace(' ', 'T') : dateVal;
    return new Date(cleaned);
  }
  
  return new Date(dateVal);
}
