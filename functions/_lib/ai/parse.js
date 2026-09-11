// Parses a model's JSON response, tolerating the shapes real models actually return:
// already-parsed objects, a clean JSON string, or JSON wrapped in prose/markdown fences.
export function parseModelJson(response) {
  if (response && typeof response === 'object') return response;
  if (typeof response !== 'string') return null;

  try {
    return JSON.parse(response);
  } catch {
    // fall through to the brace-extraction fallback
  }

  const start = response.indexOf('{');
  const end = response.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(response.slice(start, end + 1));
  } catch {
    return null;
  }
}
