import { requireIsolation } from '../../acceptance/scripts/isolation.mjs';
requireIsolation(import.meta.url);
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../', import.meta.url));
const source = `
import json,pathlib,sys,zipfile,io
base=pathlib.Path(sys.argv[1]); root=base.parent
secrets=[]
for path in [base/'.runtime/connection.json',root/'host/.runtime/connection.json',root/'reflection-lifecycle/.runtime/controlled-connection.json']:
    config=json.loads(path.read_text())
    for k in ['token','key']:
        if config.get(k): secrets.append((config[k].encode(),('<TOKEN>' if k=='token' else '<KEY>').encode()))
replacements=secrets+[(b'/Users/torch',b'<USER_HOME>'),(b'%2FUsers%2Ftorch',b'%3CUSER_HOME%3E'),(b'%2fUsers%2ftorch',b'%3CUSER_HOME%3E')]
def clean(data):
    for a,b in replacements: data=data.replace(a,b)
    return data
count=0; archives=0
for path in (base/'evidence').rglob('*'):
    if not path.is_file(): continue
    if path.suffix=='.zip':
        target=io.BytesIO()
        with zipfile.ZipFile(path) as z,zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED) as out:
            for info in z.infolist():
                data=z.read(info.filename)
                if not info.filename.endswith(('.png','.jpg','.jpeg','.webp','.woff','.woff2')): data=clean(data)
                out.writestr(info,data)
        path.write_bytes(target.getvalue());archives+=1
    elif path.suffix in ['.json','.log','.txt','.html','.md']:
        data=path.read_bytes(); redacted=clean(data)
        if redacted!=data: path.write_bytes(redacted);count+=1
errors=[]
for path in (base/'evidence').rglob('*'):
    if not path.is_file(): continue
    entries=[]
    if path.suffix=='.zip':
        with zipfile.ZipFile(path) as z:
            if z.testzip(): errors.append(str(path.relative_to(base))+' integrity')
            entries=[(n,z.read(n)) for n in z.namelist()]
    elif path.suffix in ['.json','.log','.txt','.html','.md']: entries=[('',path.read_bytes())]
    for name,data in entries:
        if any(secret in data for secret,_ in secrets): errors.append(str(path.relative_to(base))+'/'+name)
result={'status':'passed' if not errors else 'failed','textFilesChanged':count,'archivesChecked':archives,'credentialSources':3,'rawSecretsFound':len(errors),'errors':errors,'scope':'current phase evidence only; private runtime untouched; PNG/video pixels not OCR scanned'}
(base/'evidence/redaction.json').write_text(json.dumps(result,indent=2));print(json.dumps(result));sys.exit(1 if errors else 0)
`;
const r = spawnSync('python3', ['-c', source, base], { encoding: 'utf8' });
console.log(r.stdout);
if (r.stderr) console.error(r.stderr);
process.exitCode = r.status || 0;
