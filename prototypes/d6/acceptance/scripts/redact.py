import io
import json
import pathlib
import sys
import zipfile

request = json.load(sys.stdin)
directory = pathlib.Path(request['directory'])
secrets = [value.encode() for value in request['secrets']]


def clean(data):
    for value in secrets:
        data = data.replace(value, b'<RUN_PRIVATE_VALUE>')
    return data


checked = changed = 0
for path in [directory / 'command.log', *(directory / 'evidence').rglob('*')]:
    if not path.is_file():
        continue
    if path.suffix == '.zip':
        with zipfile.ZipFile(path) as source:
            entries = [(entry, source.read(entry)) for entry in source.infolist()]
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w', zipfile.ZIP_DEFLATED) as target:
            for entry, data in entries:
                target.writestr(entry, clean(data))
        path.write_bytes(buffer.getvalue())
        with zipfile.ZipFile(path) as result:
            assert result.testzip() is None
            assert not any(value in result.read(name) for value in secrets for name in result.namelist())
        checked += 1
    elif path.suffix in ['.json', '.jsonl', '.log', '.txt', '.html', '.md', '.trace', '.network']:
        data = path.read_bytes()
        result = clean(data)
        if result != data:
            path.write_bytes(result)
            changed += 1
        assert not any(value in result for value in secrets)
        checked += 1
(directory / 'redaction.json').write_text(json.dumps({
    'checked': checked, 'textFilesChanged': changed, 'privateValues': len(secrets),
    'rawSecretsRemaining': 0, 'scope': 'run evidence text and zip entries; videos and PNG do not display connection fields',
}, indent=2))
