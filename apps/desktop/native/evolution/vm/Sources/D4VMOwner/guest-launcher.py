"""Trusted Linux/arm64 launcher. Filters persist across fork and exec.

This closes workload access to the guest management plane. It does not attest
the VM or cgroup boundary; those require independent runtime measurements.
"""
import ctypes
import errno
import os
import platform
import sys


def launch():
    if sys.platform != "linux" or platform.machine() != "aarch64" or os.geteuid() != 1000:
        raise RuntimeError("d4_launcher_identity")
    with open("/proc/self/status", encoding="ascii") as status:
        capabilities = dict(line.split(":", 1) for line in status if ":" in line)
    for key in ("CapInh", "CapPrm", "CapEff", "CapBnd", "CapAmb"):
        if int(capabilities[key].strip(), 16) != 0:
            raise RuntimeError("d4_launcher_capabilities")

    class Filter(ctypes.Structure):
        _fields_ = [("code", ctypes.c_ushort), ("jt", ctypes.c_ubyte),
                    ("jf", ctypes.c_ubyte), ("k", ctypes.c_uint)]

    class Program(ctypes.Structure):
        _fields_ = [("length", ctypes.c_ushort), ("filter", ctypes.POINTER(Filter))]

    deny = 0x00050000 | errno.EPERM
    # seccomp_data nr=0, arch=4, args[0]=16. AUDIT_ARCH_AARCH64.
    rules = [(0x20, 0, 0, 4), (0x15, 1, 0, 0xC00000B7), (0x06, 0, 0, 0x80000000),
             (0x20, 0, 0, 0), (0x15, 0, 3, 198), (0x20, 0, 0, 16),
             (0x15, 0, 1, 40), (0x06, 0, 0, deny), (0x20, 0, 0, 0)]
    # Forbid privileged management, namespaces and io_uring socket bypasses.
    for syscall in (40, 41, 97, 104, 117, 142, 241, 265, 268, 271, 280, 425, 426, 427):
        rules += [(0x15, 0, 1, syscall), (0x06, 0, 0, deny)]
    # Return ENOSYS for clone3 so glibc can fall back to clone.
    rules += [(0x15, 0, 1, 435), (0x06, 0, 0, 0x00050000 | errno.ENOSYS),
              (0x15, 0, 3, 220), (0x20, 0, 0, 16),
              (0x45, 0, 1, 0x10000000), (0x06, 0, 0, deny),
              (0x06, 0, 0, 0x7FFF0000)]
    filters = (Filter * len(rules))(*(Filter(*rule) for rule in rules))
    program = Program(len(rules), filters)
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(38, 1, 0, 0, 0) != 0 or libc.prctl(22, 2, ctypes.byref(program), 0, 0) != 0:
        raise OSError(ctypes.get_errno(), "d4_seccomp_required")
    if len(sys.argv) < 2:
        raise RuntimeError("d4_workload_required")
    os.execvpe(sys.argv[1], sys.argv[1:], {
        "PATH": "/opt/runtime/toolchains/bin:/usr/local/bin:/usr/bin:/bin",
        "HOME": "/tmp", "TMPDIR": "/tmp",
    })


launch()
