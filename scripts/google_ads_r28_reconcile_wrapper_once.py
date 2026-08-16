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
original_normalize_paid_media_test = module.normalize_paid_media_test


def normalize_runtime_resolver() -> None:
    original_normalize_runtime_resolver()
    path = Path('src/mcp/runtime-capability-resolver.ts')
    text = path.read_text()
    old = '                const record = result as Record<string, unknown>;'
    new = '                const record = result;'
    if old not in text:
        raise RuntimeError('runtime provider readback assertion anchor missing')
    path.write_text(text.replace(old, new, 1))


def normalize_paid_media_test() -> None:
    original_normalize_paid_media_test()
    path = Path('test/google-ads-paid-media.test.ts')
    text = path.read_text()
    text = text.replace(": ReturnType<GoogleAdsApiClient['listAccessibleCustomers']>", '')
    text = text.replace(": ReturnType<GoogleAdsApiClient['search']>", '')
    text = text.replace(": ReturnType<GoogleAdsApiClient['mutate']>", '')
    old = """                  id: '456',
                  resourceName: 'customers/9999999999/campaigns/456',
                  status: 'PAUSED',
"""
    new = """                  id: '456',
                  resourceName: 'customers/9999999999/campaigns/456',
                  name: 'Cross Account Campaign',
                  status: 'PAUSED',
                  campaignBudget: 'customers/9999999999/campaignBudgets/789',
"""
    if old not in text:
        raise RuntimeError('cross-account readback campaign anchor missing')
    text = text.replace(old, new, 1)

    campaign_close = """                  campaignBudget: 'customers/9999999999/campaignBudgets/789',
                },
"""
    complete_row = """                  campaignBudget: 'customers/9999999999/campaignBudgets/789',
                },
                campaignBudget: {
                  resourceName: 'customers/9999999999/campaignBudgets/789',
                  amountMicros: '17000000',
                },
"""
    if campaign_close not in text:
        raise RuntimeError('cross-account readback budget row anchor missing')
    path.write_text(text.replace(campaign_close, complete_row, 1))


module.normalize_runtime_resolver = normalize_runtime_resolver
module.normalize_paid_media_test = normalize_paid_media_test
module.main()
