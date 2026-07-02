export function formatForLog(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (!text) {
    return "";
  }
  const plainText = stripAnsi(text);
  return plainText.length > 600 ? `${plainText.slice(0, 600)}...` : plainText;
}

function stripAnsi(text: string): string {
  return text.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, "");
}
