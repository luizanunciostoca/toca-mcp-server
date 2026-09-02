export function normalizeKnowledgeSourceText(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ')
    .replace(/[\u2028\u2029]/g, '\n')
    .normalize('NFC');
}
