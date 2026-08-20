from pathlib import Path

path = Path('docs/checkpoints/email-real-sendgrid-2026-08-20.md')
text = path.read_text()
text = text.replace(
    '- Bounded exponential retry/defer for transient provider failures.\n',
    '- Bounded exponential retry with provider `Retry-After` honored for transient failures.\n',
)
text = text.replace(
    '9. Inbound Parse public key is configured when inbound email is enabled.\n10. Independent Email Activity readback is enabled.\n',
    '9. When inbound email is enabled, its receiving hostname is configured, MX resolves to `mx.sendgrid.net`, and the Inbound Parse signing key is configured.\n10. Independent Email Activity readback is enabled.\n',
)
path.write_text(text)
