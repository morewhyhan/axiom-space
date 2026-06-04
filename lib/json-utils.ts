/**
 * JSON utility functions for safe parsing.
 *
 * Shared between server/api/routes/ files to avoid duplication.
 */

/** Defensive JSON.parse for arrays — never lets a corrupt JSON column 500 the request. */
export function safeParseJsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
