import { extractText } from "unpdf";

const MAX_CHARS = 50_000;

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
  const joined = Array.isArray(text) ? text.join("\n\n") : text;
  if (joined.length > MAX_CHARS) {
    return joined.slice(0, MAX_CHARS) + "\n... (truncated)";
  }
  return joined;
}
