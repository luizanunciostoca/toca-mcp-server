from __future__ import annotations

import re
import subprocess
from pathlib import Path

BASE = '81f6f84df6b725bfc5994c2d1582241b7936c614'
ORIGINAL_WORKFLOW = Path('.github/workflows/google-ads-r28-reconcile-once.yml')


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text()
    if old not in text:
        raise RuntimeError(f'{label}: anchor missing')
    path.write_text(text.replace(old, new, 1))


def extract_original_materialization() -> str:
    lines = ORIGINAL_WORKFLOW.read_text().splitlines()
    start = None
    end = None
    for index, line in enumerate(lines):
        if line.strip() == '- name: Reconcile legacy R28 delta into current core facade':
            start = index
        elif start is not None and line.strip() == '- name: Commit clean current-architecture reconciliation':
            end = index
            break
    if start is None or end is None:
        raise RuntimeError('original reconciliation step not found')

    run_index = None
    for index in range(start + 1, end):
        if lines[index].strip() == 'run: |':
            run_index = index
            break
    if run_index is None:
        raise RuntimeError('original reconciliation run block not found')

    body: list[str] = []
    for line in lines[run_index + 1 : end]:
        if line.startswith('          '):
            line = line[10:]
        body.append(line)
    script = '\n'.join(body) + '\n'
    script = '\n'.join(
        line
        for line in script.splitlines()
        if 'git diff --name-only "$BASE" HEAD' not in line and line.strip() != 'pnpm quality'
    ) + '\n'
    return script


def normalize_runtime_resolver() -> None:
    path = Path('src/mcp/runtime-capability-resolver.ts')
    text = path.read_text()
    schema_end = "const googleAdsCampaignReferenceSchema = z.object({ campaignIdOrName: z.string().min(1) });\n"
    helper = """

function googleAdsPlanFromInput(
  input: z.infer<typeof googleAdsPlanSchema>,
): GoogleAdsCampaignPlan {
  return {
    customerId: input.customerId,
    currencyCode: input.currencyCode,
    campaignName: input.campaignName,
    budgetName: input.budgetName,
    dailyBudgetMicros: input.dailyBudgetMicros,
    advertisingChannelType: input.advertisingChannelType ?? 'SEARCH',
    targeting: {
      locationCriterionIds: input.targeting.locationCriterionIds,
      ...(input.targeting.languageCriterionIds !== undefined
        ? { languageCriterionIds: input.targeting.languageCriterionIds }
        : {}),
      ...(input.targeting.presenceOnly !== undefined
        ? { presenceOnly: input.targeting.presenceOnly }
        : {}),
    },
  };
}
"""
    if schema_end not in text:
        raise RuntimeError('runtime schema anchor missing')
    text = text.replace(schema_end, schema_end + helper, 1)
    text = text.replace(
        'services.googleAds!.prepare(input as GoogleAdsCampaignPlan)',
        'services.googleAds!.prepare(googleAdsPlanFromInput(input))',
    )
    text = text.replace(
        'services.googleAds!.validateTargeting(input as GoogleAdsCampaignPlan)',
        'services.googleAds!.validateTargeting(googleAdsPlanFromInput(input))',
    )
    text = text.replace(
        'services.googleAds!.createPaused(input as GoogleAdsCampaignPlan)',
        'services.googleAds!.createPaused(googleAdsPlanFromInput(input))',
    )
    path.write_text(text)


def normalize_api_client() -> None:
    path = Path('src/providers/google-ads/google-ads-api-client.ts')
    old = """    return {
      body: payload,
      ...(response.headers.get('request-id')
        ? { requestId: response.headers.get('request-id') ?? undefined }
        : {}),
    };
"""
    new = """    const requestId = response.headers.get('request-id');
    return {
      body: payload,
      ...(requestId ? { requestId } : {}),
    };
"""
    replace_once(path, old, new, 'api request id')


def normalize_paid_media() -> None:
    path = Path('src/providers/google-ads/google-ads-paid-media.ts')
    old = """    const results = response.body.results ?? [];
    const first = results[0] as Record<string, unknown> | undefined;
    const campaign = first?.campaign as Record<string, unknown> | undefined;
"""
    new = """    const rawResults = response.body.results;
    const results = Array.isArray(rawResults)
      ? rawResults.filter(
          (item): item is Record<string, unknown> =>
            item !== null && typeof item === 'object' && !Array.isArray(item),
        )
      : [];
    const first = results[0];
    const campaign = first?.campaign as Record<string, unknown> | undefined;
"""
    replace_once(path, old, new, 'paid media readback rows')


def normalize_api_test() -> None:
    path = Path('test/google-ads-api-client.test.ts')
    text = path.read_text()
    old_fetch = """    const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'request-id': 'req-123', 'content-type': 'application/json' },
      });
    }) as typeof fetch;
"""
    new_fetch = """    const fakeFetch: typeof fetch = async (input, init) => {
      await Promise.resolve();
      calls.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
        ...(init ? { init } : {}),
      });
      return new Response(JSON.stringify({ results: [] }), {
        status: 200,
        headers: { 'request-id': 'req-123', 'content-type': 'application/json' },
      });
    };
"""
    if old_fetch not in text:
        raise RuntimeError('api test fakeFetch anchor missing')
    text = text.replace(old_fetch, new_fetch, 1)
    old_body = """    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      query: 'SELECT campaign.id FROM campaign LIMIT 1',
    });
"""
    new_body = """    const requestBody = calls[0]?.init?.body;
    expect(typeof requestBody).toBe('string');
    if (typeof requestBody !== 'string') throw new Error('TEST_REQUEST_BODY_STRING_REQUIRED');
    expect(JSON.parse(requestBody)).toEqual({
      query: 'SELECT campaign.id FROM campaign LIMIT 1',
    });
"""
    if old_body not in text:
        raise RuntimeError('api test body anchor missing')
    text = text.replace(old_body, new_body, 1)
    old_boundary = """      (async () => new Response('{}', { status: 200 })) as typeof fetch,
"""
    new_boundary = """      async () => {
        await Promise.resolve();
        return new Response('{}', { status: 200 });
      },
"""
    if old_boundary not in text:
        raise RuntimeError('api test boundary fetch anchor missing')
    path.write_text(text.replace(old_boundary, new_boundary, 1))


def normalize_paid_media_test() -> None:
    path = Path('test/google-ads-paid-media.test.ts')
    text = path.read_text()
    signatures = {
        '  async listAccessibleCustomers() {': "  async listAccessibleCustomers(): ReturnType<GoogleAdsApiClient['listAccessibleCustomers']> {",
        '  async search(query: string) {': "  async search(query: string): ReturnType<GoogleAdsApiClient['search']> {",
        '  async mutate(path: string, body: Record<string, unknown>) {': "  async mutate(path: string, body: Record<string, unknown>): ReturnType<GoogleAdsApiClient['mutate']> {",
        '      override async mutate(path: string, body: Record<string, unknown>) {': "      override async mutate(path: string, body: Record<string, unknown>): ReturnType<GoogleAdsApiClient['mutate']> {",
        '      override async search(query: string) {': "      override async search(query: string): ReturnType<GoogleAdsApiClient['search']> {",
    }
    for old, new in signatures.items():
        if old in text:
            text = text.replace(old, new)

    for method in ('listAccessibleCustomers', 'search', 'mutate'):
        pattern = rf'(?m)^(\s*)(override\s+)?async {method}([^\n]*\{{)\n(?!\s*await Promise\.resolve\(\);)'

        def inject(match: re.Match[str]) -> str:
            indent = match.group(1)
            override = match.group(2) or ''
            rest = match.group(3)
            return f'{indent}{override}async {method}{rest}\n{indent}  await Promise.resolve();\n'

        text = re.sub(pattern, inject, text)
    path.write_text(text)


def main() -> None:
    run('git', 'merge-base', '--is-ancestor', BASE, 'HEAD')
    script = extract_original_materialization()
    Path('/tmp/r28-reconcile.sh').write_text(script)
    run('bash', '/tmp/r28-reconcile.sh')

    normalize_runtime_resolver()
    normalize_api_client()
    normalize_paid_media()
    normalize_api_test()
    normalize_paid_media_test()

    run(
        'pnpm',
        'exec',
        'prettier',
        '--write',
        'src/mcp/runtime-capability-resolver.ts',
        'src/providers/google-ads/google-ads-api-client.ts',
        'src/providers/google-ads/google-ads-paid-media.ts',
        'test/google-ads-api-client.test.ts',
        'test/google-ads-paid-media.test.ts',
    )
    run('pnpm', 'quality')


if __name__ == '__main__':
    main()
