from pathlib import Path
import base64
import subprocess
import textwrap

quality = Path('.github/workflows/quality.yml').read_text()
start_marker = "          python3 <<'PY'\n"
end_marker = "\n          PY\n"
code = quality.split(start_marker, 1)[1].split(end_marker, 1)[0]
exec(textwrap.dedent(code), {})
subprocess.run(
    [
        'node_modules/.bin/prettier',
        '--write',
        '.github/workflows/deploy-gcp.yml',
        'scripts/capture-platform-evidence.mjs',
        'test/gcp-deploy-cloud-sql-proxy.test.ts',
    ],
    check=True,
)
for label, path in [
    ('DEPLOY', '.github/workflows/deploy-gcp.yml'),
    ('DOCKERFILE', 'Dockerfile'),
    ('EVIDENCE', 'scripts/capture-platform-evidence.mjs'),
    ('TEST', 'test/gcp-deploy-cloud-sql-proxy.test.ts'),
]:
    payload = base64.b64encode(Path(path).read_bytes()).decode('ascii')
    print(f'TOCA_RUNTIME_DB_BUNDLE_{label}={payload}')
