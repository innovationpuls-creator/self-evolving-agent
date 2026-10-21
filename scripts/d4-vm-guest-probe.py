"""Experimental adversarial workload. Its JSON is NOT trusted attestation."""
import ctypes
import base64
import errno
import json
import os
import pathlib
import socket
import subprocess
import sys
import time
import threading

mode = sys.argv[1]
own = pathlib.Path('/tmp') / sys.argv[2]
own.mkdir(exist_ok=True)
for part in ('workspace', 'cache', 'build', 'tmp'):
    (own / part).mkdir(exist_ok=True)
    (own / part / 'canary').write_text(sys.argv[2])
time.sleep(1)

if mode == 'boundary':
    denied = []
    paths = json.loads(sys.argv[3])
    for p in paths:
        for operation in ('read', 'write', 'symlink', 'openat'):
            try:
                if operation == 'read':
                    pathlib.Path(p).read_bytes()
                elif operation == 'write':
                    with open(p, 'r+b') as f:
                        f.write(b'unauthorized')
                elif operation == 'symlink':
                    link = own / 'link'
                    link.unlink(missing_ok=True)
                    link.symlink_to(p)
                    link.read_bytes()
                else:
                    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY)
                    try:
                        target = os.open(p.lstrip('/'), os.O_RDONLY, dir_fd=fd)
                        os.close(target)
                    finally:
                        os.close(fd)
                raise RuntimeError('access unexpectedly succeeded: ' + operation + ':' + p)
            except OSError as e:
                denied.append([operation, p, e.errno])
    assert subprocess.check_output(['/bin/sh', '-c', 'printf shell-ok']) == b'shell-ok'
    for _ in range(100):
        if pathlib.Path('/usr/local/bin/node').exists():
            break
        time.sleep(0.1)
    assert subprocess.check_output(['node', '-e', 'process.stdout.write(String(2+2))']) == b'4'
    compile('assert 2 + 2 == 4', 'business.py', 'exec')
    exec('assert 2 + 2 == 4')
    controls = {}
    for name in ('memory.max', 'memory.swap.max', 'cpu.max', 'pids.max'):
        p = pathlib.Path('/sys/fs/cgroup') / name
        controls[name] = p.read_text().strip()
        try:
            p.write_text('max')
            raise RuntimeError('workload modified ' + name)
        except OSError:
            pass
    try:
        s = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
        s.close()
        raise RuntimeError('AF_VSOCK was not denied')
    except OSError as e:
        assert e.errno == errno.EPERM, e
    for family, address in ((socket.AF_INET, ('1.1.1.1', 443)),
                            (socket.AF_INET6, ('2606:4700:4700::1111', 443))):
        try:
            s = socket.socket(family, socket.SOCK_STREAM)
            s.settimeout(1)
            s.connect(address)
            raise RuntimeError('unauthorized network')
        except OSError:
            pass
        finally:
            s.close()
    print(json.dumps({'workloadReport': mode, 'denied': denied, 'cgroup': controls,
                      'fds': os.listdir('/proc/self/fd')}), flush=True)
    inherited = []
    for fd in range(3, 32):
        try:
            inherited.append({'fd': fd, 'bytes': base64.b64encode(os.pread(fd, 128, 0)).decode()})
        except OSError:
            pass
    print(json.dumps({'inheritedFDProbe': inherited}), flush=True)
elif mode == 'network':
    targets = json.loads(sys.argv[4])
    failures = {}
    for name, family, kind, target in (
            ('tcp4', socket.AF_INET, socket.SOCK_STREAM, (targets['address'], targets['tcp'])),
            ('tcp6', socket.AF_INET6, socket.SOCK_STREAM, ('::1', targets['tcp6'])),
            ('udp', socket.AF_INET, socket.SOCK_DGRAM, (targets['address'], targets['udp'])),
            ('dns-transport', socket.AF_INET, socket.SOCK_DGRAM, (targets['address'], 53)),
            ('unix', socket.AF_UNIX, socket.SOCK_STREAM, targets['unix'])):
        s = socket.socket(family, kind)
        s.settimeout(1)
        try:
            if kind == socket.SOCK_DGRAM:
                s.sendto(b'non-authorized-probe', target)
            else:
                s.connect(target)
            raise AssertionError('Guest reached Host endpoint: ' + name)
        except OSError as error:
            failures[name] = error.errno
        finally:
            s.close()
    try:
        socket.getaddrinfo('example.com', 443)
        raise AssertionError('Guest DNS unexpectedly resolved')
    except socket.gaierror as error:
        failures['system-dns'] = error.errno
    assert set(os.listdir('/sys/class/net')) == {'lo'}
    print(json.dumps({'workloadReport':mode,'denied':failures,'interfaces':['lo']}),flush=True)
elif mode == 'cpu':
    for _ in range(4):
        if os.fork() == 0:
            until = time.monotonic() + 5
            while time.monotonic() < until:
                pass
            os._exit(0)
    for _ in range(4):
        os.wait()
elif mode == 'pids':
    children = []
    try:
        for _ in range(160):
            child = os.fork()
            if child == 0:
                time.sleep(6)
                os._exit(0)
            children.append(child)
        raise RuntimeError('pids limit not enforced')
    except OSError as e:
        assert e.errno == errno.EAGAIN, e
        print(json.dumps({'workloadReport': mode, 'forks': len(children), 'errno': e.errno}), flush=True)
        time.sleep(2)
    finally:
        for child in children:
            os.kill(child, 9)
            os.waitpid(child, 0)
elif mode == 'memory':
    for _ in range(5):
        if os.fork() == 0:
            memory = bytearray(260 * 1024 * 1024)
            for page in range(0, len(memory), 4096):
                memory[page] = 1
            time.sleep(5)
            os._exit(0)
    time.sleep(8)
elif mode == 'threads':
    threads = []
    try:
        for _ in range(160):
            thread = threading.Thread(target=lambda: time.sleep(6))
            thread.start()
            threads.append(thread)
        raise AssertionError('aggregate TID limit not enforced')
    except RuntimeError as error:
        assert 'thread' in str(error), error
        assert 100 <= len(threads) < 128, len(threads)
        print(json.dumps({'workloadReport': mode, 'threads': len(threads)}), flush=True)
        time.sleep(2)
    finally:
        for thread in threads:
            thread.join()
elif mode == 'output':
    for _ in range(3):
        if os.fork() == 0:
            for _ in range(96):
                os.write(1, b'x' * 32768)
            os._exit(0)
    time.sleep(5)
elif mode == 'storage':
    def fill(name):
        try:
            with open(own / name, 'wb', buffering=0) as f:
                for _ in range(1700):
                    f.write(b'x' * (1024 * 1024))
            raise RuntimeError('disk limit not enforced')
        except OSError as e:
            assert e.errno == errno.ENOSPC, e
            print(json.dumps({'workloadReport': mode, 'errno': e.errno}), flush=True)
    if os.fork() == 0:
        fill('child.bin')
        os._exit(0)
    fill('parent.bin')
    os.wait()
elif mode == 'detached':
    if os.fork() == 0:
        os.setsid()
        if os.fork() == 0:
            while True:
                with open(own / 'heartbeat', 'a') as f:
                    f.write(str(time.monotonic()) + '\n')
                time.sleep(0.1)
        os._exit(0)
    os.wait()
    print(json.dumps({'workloadReport': mode, 'pid': os.getpid()}), flush=True)
    time.sleep(120)
else:
    raise RuntimeError('unknown mode')
time.sleep(2)
