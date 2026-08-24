from pathlib import Path
import base64
import gzip
import hashlib
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
payload = Path('.github/workflows/deploy-gcp.yml').read_bytes()
compressed = base64.b64encode(gzip.compress(payload, compresslevel=9)).decode('ascii')
print(f'TOCA_RUNTIME_DB_DEPLOY_GZIP_BASE64={compressed}')
print(f'TOCA_RUNTIME_DB_DEPLOY_SHA256={hashlib.sha256(payload).hexdigest()}')
