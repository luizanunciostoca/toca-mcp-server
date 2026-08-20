from pathlib import Path

provider = Path('src/providers/sendgrid/email-provider.ts')
text = provider.read_text()
text = text.replace(
    "super(`SENDGRID_MAIL_SEND_FAILED:${status}`);",
    "super(`SENDGRID_MAIL_SEND_FAILED:${status}:provider-rejected`);",
)
provider.write_text(text)

test = Path('test/email-orchestrator.test.ts')
text = test.read_text()
text = text.replace(
    "new Error('SENDGRID_MAIL_SEND_FAILED:429')",
    "new Error('SENDGRID_MAIL_SEND_FAILED:429:provider-rejected')",
)
text = text.replace(
    "new Error('SENDGRID_MAIL_SEND_FAILED:500')",
    "new Error('SENDGRID_MAIL_SEND_FAILED:500:provider-rejected')",
)
test.write_text(text)
