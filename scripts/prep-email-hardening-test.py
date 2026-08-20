from pathlib import Path

path = Path('test/sendgrid-email-provider.test.ts')
text = path.read_text()
text = text.replace(
    "new Response('{\\\"errors\\\":[{\\\"message\\\":\\\"rate limited\\\"}]}', {",
    "new Response('{\"errors\":[{\"message\":\"rate limited\"}]}', {",
)
path.write_text(text)
