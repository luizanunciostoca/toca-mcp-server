from pathlib import Path

path = Path('scripts/marketing-scheduled-publication-controller.mjs')
text = path.read_text(encoding='utf-8')
old_import = "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';"
new_import = "import { createHash } from 'node:crypto';\nimport { mkdirSync, readFileSync, writeFileSync } from 'node:fs';"
if text.count(old_import) != 1:
    raise SystemExit(f'import anchor count={text.count(old_import)}')
text = text.replace(old_import, new_import, 1)
old = "  fail(/^[a-f0-9]{64}$/.test(item.captionSha256 ?? ''), 'SCHEDULED_PUBLICATION_CAPTION_SHA_INVALID');\n}"
new = "  fail(/^[a-f0-9]{64}$/.test(item.captionSha256 ?? ''), 'SCHEDULED_PUBLICATION_CAPTION_SHA_INVALID');\n  const actualCaptionSha256 = createHash('sha256').update(item.caption).digest('hex');\n  fail(actualCaptionSha256 === item.captionSha256, 'SCHEDULED_PUBLICATION_CAPTION_HASH_MISMATCH');\n}"
if text.count(old) != 1:
    raise SystemExit(f'caption anchor count={text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')
