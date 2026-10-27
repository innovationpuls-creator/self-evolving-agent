import os as _d6_os
from pathlib import Path as _D6Path
if not _d6_os.environ.get('D6_RUN_ROOT') or not _D6Path(__file__).resolve().is_relative_to(_D6Path(_d6_os.environ['D6_RUN_ROOT']).resolve()):
    raise SystemExit('D6 output requires acceptance/scripts/run.mjs -- <command>')
"""Redact shareable evidence only; never read or rewrite Host data stores."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json

root = Path(__file__).resolve().parents[1]
private = json.loads((root.parent / 'host/.runtime/connection.json').read_text())
secrets = [private['token'], private['key']]
replacements = [(value, '<redacted>') for value in secrets]
replacements += [(str(root) + '/', '<D6_INTEGRATION>/'), (str(root), '<D6_INTEGRATION>'), (str(Path.home()), '<USER_HOME>'), ('<D6_INTEGRATION>.runtime', '<D6_INTEGRATION>/.runtime')]

def text(value):
    for before, after in replacements:
        value = value.replace(before, after)
    # Encoded paths occur in recorded query strings.
    from urllib.parse import quote
    value = value.replace(quote(str(root), safe=''), '<D6_INTEGRATION>')
    value = value.replace(quote(str(Path.home()), safe=''), '<USER_HOME>')
    return value

def clean(value):
    if isinstance(value, dict):
        return {k: '<omitted local prompt context>' if k in ('systemPrompt', 'systemPromptSections') else clean(v) for k, v in value.items()}
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, str):
        if value.startswith(('<skills>', '<tools>')):
            return '<omitted local prompt context>'
        return text(value)
    return value

count = 0
for path in (root / 'evidence').rglob('*.json'):
    value = json.loads(path.read_text())
    path.write_text(json.dumps(clean(value), ensure_ascii=False, indent=2))
    count += 1
for path in (root / 'evidence').rglob('*.zip'):
    with ZipFile(path) as archive:
        entries = [(info, archive.read(info.filename)) for info in archive.infolist()]
    with ZipFile(path, 'w', compression=ZIP_DEFLATED) as archive:
        for info, data in entries:
            try:
                data = text(data.decode('utf-8')).encode('utf-8')
            except UnicodeDecodeError:
                pass
            archive.writestr(info, data)
    with ZipFile(path) as archive:
        assert archive.testzip() is None
        assert not any(secret.encode() in archive.read(name) for secret in secrets for name in archive.namelist())
    count += 1
for path in (root / 'evidence').rglob('*'):
    if path.is_file() and path.suffix in ('.json', '.html', '.md', '.log'):
        assert not any(secret in path.read_text() for secret in secrets), str(path)
print(json.dumps({'redacted_files': count, 'secret_scan': 'passed', 'private_runtime': 'excluded'}))
