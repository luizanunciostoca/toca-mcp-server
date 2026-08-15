from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"PATCH_ANCHOR_COUNT_INVALID:{path}:{count}")
    file.write_text(text.replace(old, new, 1))


path = "src/persistence/postgres-event-record-store.ts"
replace_once(
    path,
    "    JSON.stringify(left.attributes) === JSON.stringify(right.attributes)",
    "    canonicalJson(left.attributes) === canonicalJson(right.attributes)",
)
replace_once(
    path,
    """function asEventRecord(value: unknown): EventRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('EVENT_RECORD_REVISION_SNAPSHOT_INVALID');
  const candidate = value as EventRecord;
  validateEventRecord(candidate);
  return candidate;
}

function asAttributes(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      normalized[key] = item as string | number | boolean | null;
    }
  }
  return normalized;
}
""",
    """function asEventRecord(value: unknown): EventRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('EVENT_RECORD_REVISION_SNAPSHOT_INVALID');
  const candidate = value as EventRecord;
  try {
    validateEventRecord(candidate);
  } catch {
    throw new Error('EVENT_RECORD_REVISION_SNAPSHOT_INVALID');
  }
  return candidate;
}

function asAttributes(
  value: unknown,
): Readonly<Record<string, string | number | boolean | null>> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('EVENT_RECORD_ATTRIBUTES_INVALID');
  const entries = Object.entries(value as Record<string, unknown>);
  const normalized: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of entries) {
    if (item !== null && !['string', 'number', 'boolean'].includes(typeof item))
      throw new Error('EVENT_RECORD_ATTRIBUTES_INVALID');
    normalized[key] = item as string | number | boolean | null;
  }
  validateAttributes(normalized);
  return normalized;
}

function canonicalJson(
  value: Readonly<Record<string, string | number | boolean | null>>,
): string {
  return JSON.stringify(
    Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right))),
  );
}
""",
)
