const HTML_JSON_ESCAPES: Record<string, string> = {
  "&": "\\u0026",
  "<": "\\u003c",
  ">": "\\u003e",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/** Serializes JSON without allowing data to terminate an inline script element. */
export function serializeJsonForHtml(value: unknown): string {
  const json = JSON.stringify(value);
  if (json === undefined) throw new TypeError("Value is not JSON-serializable");
  return json.replace(/[<>&\u2028\u2029]/g, (character) => HTML_JSON_ESCAPES[character]);
}
