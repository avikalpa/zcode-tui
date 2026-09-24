// Ported from opencode v2.0.16 packages/tui/src/util/error.ts —
// errorMessage + errorFormat (the #50778/#50783 API-error-toast family:
// user-visible error surfaces must print the API's real message, never a
// bare "[object Object]"). isRecord is inlined from upstream util/record.ts
// to keep this a single-module port. cliErrorMessage is NOT ported — its
// CLI-exit/config-path concerns are upstream-shell concerns.

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

export function errorFormat(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? `${error.name}: ${error.message}`;
  }

  if (typeof error === "object" && error !== null) {
    try {
      const json = JSON.stringify(error, null, 2);
      // Plain objects whose own properties are all non-enumerable (or empty)
      // serialize to "{}", which prints as a useless bare `{}` on stderr.
      // Fall back to a custom toString first, then to ctor name + own prop names.
      if (json === "{}") {
        const str = String(error);
        if (str && str !== "[object Object]") return str;
        const ctor = error.constructor?.name;
        const prefix = ctor && ctor !== "Object" ? ctor : "Error";
        const names = Object.getOwnPropertyNames(error);
        return names.length === 0 ? `${prefix} (no message)` : `${prefix} { ${names.join(", ")} }`;
      }
      return json;
    } catch {
      return "Unexpected error (unserializable)";
    }
  }

  return String(error);
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.message) return error.message;
    if (error.name) return error.name;
  }

  if (isRecord(error) && typeof error.message === "string" && error.message) {
    return error.message;
  }

  if (isRecord(error) && isRecord(error.data) && typeof error.data.message === "string" && error.data.message) {
    return error.data.message;
  }

  const text = String(error);
  if (text && text !== "[object Object]") return text;

  const formatted = errorFormat(error);
  if (formatted) return formatted;
  return "unknown error";
}
