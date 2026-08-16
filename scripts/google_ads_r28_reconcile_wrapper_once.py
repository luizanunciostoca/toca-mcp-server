from __future__ import annotations

import importlib.util
from pathlib import Path

HELPER = Path('scripts/google-ads-r28-reconcile-once.py')
spec = importlib.util.spec_from_file_location('r28_reconcile_once', HELPER)
if spec is None or spec.loader is None:
    raise RuntimeError('R28_RECONCILE_HELPER_LOAD_FAILED')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

original_normalize_runtime_resolver = module.normalize_runtime_resolver


def normalize_runtime_resolver() -> None:
    original_normalize_runtime_resolver()
    path = Path('src/mcp/runtime-capability-resolver.ts')
    text = path.read_text()
    old = '                const record = result as Record<string, unknown>;'
    new = '                const record = result;'
    if old not in text:
        raise RuntimeError('runtime provider readback assertion anchor missing')
    path.write_text(text.replace(old, new, 1))


module.normalize_runtime_resolver = normalize_runtime_resolver
module.main()
