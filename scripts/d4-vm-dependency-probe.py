"""Fixed dependency fixtures: Host creates bytes; Guest installs within its VM."""
import base64
import hashlib
import io
import json
import os
import pathlib
import subprocess
import sys
import tarfile
import time
import zipfile

CHECK = '''import os,pathlib,socket
p=pathlib.Path(os.environ['D4_DENIED_PATH'])
try:
 p.write_text('unauthorized')
 raise AssertionError('Host path visible')
except OSError as e:
 assert e.errno in (1,2,13),e
try:
 socket.socket(socket.AF_VSOCK,socket.SOCK_STREAM)
 raise AssertionError('management socket allowed')
except OSError as e:
 assert e.errno==1,e
assert os.geteuid()==1000
pathlib.Path(os.environ['D4_MARKER']).write_text('isolated-hook')
'''
BACKEND = '''import os,io,pathlib,zipfile
CHECK = %r

def get_requires_for_build_wheel(config_settings=None): return []
def build_wheel(wheel_directory, config_settings=None, metadata_directory=None):
 exec(CHECK)
 name='d4fixture-1.0-py3-none-any.whl'
 with zipfile.ZipFile(str(pathlib.Path(wheel_directory)/name),'w') as z:
  z.writestr('d4fixture.py','def value(): return 42\\n')
  z.writestr('d4fixture-1.0.dist-info/METADATA','Metadata-Version: 2.1\\nName: d4fixture\\nVersion: 1.0\\n')
  z.writestr('d4fixture-1.0.dist-info/WHEEL','Wheel-Version: 1.0\\nGenerator: d4\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n')
  z.writestr('d4fixture-1.0.dist-info/RECORD','')
 return name
''' % CHECK


def tar_bytes(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, value in files.items():
            data = value.encode()
            member = tarfile.TarInfo(name)
            member.size, member.mode, member.mtime = len(data), 0o644, 0
            archive.addfile(member, io.BytesIO(data))
    return output.getvalue()


def fixtures():
    lifecycle = "require('node:child_process').execFileSync('/usr/local/bin/python3',['-c'," + json.dumps(CHECK) + "]);"
    npm = tar_bytes({'package/package.json': json.dumps({'name':'d4-owned-dependency','version':'1.0.0','scripts':{'install':'node hook.cjs'}}),
                     'package/hook.cjs': lifecycle, 'package/index.js': 'module.exports=42;'})
    sdist = tar_bytes({'d4fixture-1.0/pyproject.toml':'[build-system]\nrequires=[]\nbuild-backend="backend"\nbackend-path=["."]\n',
                      'd4fixture-1.0/backend.py': BACKEND,
                      'd4fixture-1.0/PKG-INFO':'Metadata-Version: 2.1\nName: d4fixture\nVersion: 1.0\n'})
    wheel = io.BytesIO()
    with zipfile.ZipFile(wheel, 'w') as z:
        z.writestr('d4wheel.py', 'def value(): return 42\n')
        z.writestr('d4wheel-1.0.dist-info/METADATA', 'Metadata-Version: 2.1\nName: d4wheel\nVersion: 1.0\n')
        z.writestr('d4wheel-1.0.dist-info/WHEEL', 'Wheel-Version: 1.0\nGenerator: d4\nRoot-Is-Purelib: true\nTag: py3-none-any\n')
        z.writestr('d4wheel-1.0.dist-info/RECORD', '')
    return [{'name':name,'sha256':hashlib.sha256(data).hexdigest(),'base64':base64.b64encode(data).decode()}
            for name,data in [('dependency.tgz',npm),('d4fixture-1.0.tar.gz',sdist),('d4wheel-1.0-py3-none-any.whl',wheel.getvalue())]]


if sys.argv[1] == '--fixtures':
    print(json.dumps(fixtures()))
    sys.exit(0)

own = pathlib.Path('/tmp') / sys.argv[2]
own.mkdir(exist_ok=True)
for _ in range(500):
    try:
        if pathlib.Path('/opt/runtime/ready').exists(): break
    except PermissionError:
        # tar applies final directory permissions after extracting children.
        pass
    time.sleep(.02)
else: raise AssertionError('runtime not ready')
artifacts = json.loads(sys.argv[4])
def verified_bytes(data, expected):
    if hashlib.sha256(data).hexdigest() != expected:
        raise ValueError('dependency_digest_mismatch')
    return data

for artifact in artifacts:
    data = base64.b64decode(artifact['base64'])
    try:
        verified_bytes(data + b'corrupt', artifact['sha256'])
        raise AssertionError('corrupt dependency accepted')
    except ValueError as error:
        assert str(error) == 'dependency_digest_mismatch'
    (own / artifact['name']).write_bytes(verified_bytes(data, artifact['sha256']))
(own / 'package.json').write_text('{"private":true}')
(own / 'user.npmrc').write_text('')
(own / 'global.npmrc').write_text('')
env = {**os.environ, 'D4_DENIED_PATH':json.loads(sys.argv[3])[-3],
       'D4_MARKER':str(own/'npm-marker'), 'npm_config_cache':str(own/'cache'),
       'npm_config_userconfig':str(own/'user.npmrc'), 'npm_config_globalconfig':str(own/'global.npmrc')}


def run(args, environment=env):
    result = subprocess.run(args, cwd=own, env=environment, capture_output=True, timeout=25)
    assert result.returncode == 0, (args, result.stdout[-2048:], result.stderr[-2048:])
    return result.stdout

(own / 'corrupt.tgz').write_bytes(b'not-a-gzip-archive')
bad_npm = subprocess.run(['npm','install','--offline','--ignore-scripts','--no-audit','--no-fund',str(own/'corrupt.tgz')],
                         cwd=own,env=env,capture_output=True,timeout=25)
assert bad_npm.returncode != 0
bad_wheel = own/'corrupt'/'d4wheel-1.0-py3-none-any.whl'
bad_wheel.parent.mkdir()
bad_wheel.write_bytes(b'not-a-wheel')
bad_pip = subprocess.run([sys.executable,'-m','pip','install','--no-index','--no-deps','--no-cache-dir','--target',str(own/'bad-wheel'),str(bad_wheel)],
                         cwd=own,env=env,capture_output=True,timeout=25)
assert bad_pip.returncode != 0
assert not (own/'npm-marker').exists()
run(['npm','install','--offline','--ignore-scripts','--no-audit','--no-fund',str(own/'dependency.tgz')])
assert not (own/'npm-marker').exists()
run(['npm','rebuild','--offline','--foreground-scripts','--no-audit','--no-fund'])
assert (own/'npm-marker').read_text() == 'isolated-hook'
assert run(['node','-e',"process.stdout.write(String(require('d4-owned-dependency')))"]) == b'42'
run([sys.executable,'-m','pip','install','--no-index','--no-deps','--no-cache-dir','--target',str(own/'wheel'),str(own/'d4wheel-1.0-py3-none-any.whl')])
run([sys.executable,'-c',"import sys;sys.path.insert(0,'wheel');import d4wheel;assert d4wheel.value()==42"])
env['D4_MARKER'] = str(own/'build-marker')
run([sys.executable,'-m','pip','install','--no-index','--no-deps','--no-cache-dir','--no-build-isolation','--target',str(own/'sdist'),str(own/'d4fixture-1.0.tar.gz')])
assert (own/'build-marker').read_text() == 'isolated-hook'
run([sys.executable,'-c',"import sys;sys.path.insert(0,'sdist');import d4fixture;assert d4fixture.value()==42"])
print(json.dumps({'workloadReport':'dependencies','npmLifecycle':True,'pipWheel':True,'pipSdistBuildHook':True,
                  'corruptDigestRejected':True,'corruptNpmRejected':bad_npm.returncode,
                  'corruptWheelRejected':bad_pip.returncode,
                  'fixtures':[{'name':a['name'],'sha256':a['sha256']} for a in artifacts]}),flush=True)
time.sleep(2)
