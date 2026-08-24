/**
 * The only place JSON-in-TEXT columns are parsed.
 *
 * Every one of these values was written by either an LLM or an older version of
 * this app, so "it parsed last time" is not a guarantee. A bad value must
 * degrade to the fallback and let the page render, never throw inside a Server
 * Component where the message is stripped in production.
 */
export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    return (value ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
