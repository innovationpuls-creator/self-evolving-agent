#include <sys/resource.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <errno.h>
// Fixed inherited hard ceilings; never selected by untrusted IPC input.
static void limit(int key, rlim_t value) {
    struct rlimit current;
    if (getrlimit(key, &current)) _exit(125);
    if (current.rlim_max < value) value = current.rlim_max;
    struct rlimit next = {value, value};
    if (setrlimit(key, &next)) _exit(125);
}
int main(int argc, char **argv) {
    if (argc < 2) return 125;
    limit(RLIMIT_CORE, 0);
#ifdef D4_LIMIT_PROBE
    limit(RLIMIT_CPU, 2);
    limit(RLIMIT_FSIZE, 128 * 1024);
    limit(RLIMIT_NOFILE, 64);
#else
    limit(RLIMIT_CPU, 60);
    limit(RLIMIT_FSIZE, 64 * 1024 * 1024);
    limit(RLIMIT_NOFILE, 256);
#endif
    if (strcmp(argv[1], "--report") == 0) {
        struct rlimit cpu, files, fds, core;
        getrlimit(RLIMIT_CPU, &cpu); getrlimit(RLIMIT_FSIZE, &files);
        getrlimit(RLIMIT_NOFILE, &fds); getrlimit(RLIMIT_CORE, &core);
        struct rlimit raised = {fds.rlim_max + 1, fds.rlim_max + 1};
        int result = setrlimit(RLIMIT_NOFILE, &raised);
        printf("{\"cpu\":%llu,\"file\":%llu,\"fds\":%llu,\"core\":%llu,\"raiseResult\":%d,\"raiseErrno\":%d}\n", (unsigned long long)cpu.rlim_max, (unsigned long long)files.rlim_max, (unsigned long long)fds.rlim_max, (unsigned long long)core.rlim_max, result, errno);
        return 0;
    }
    execv(argv[1], argv + 1);
    return 126;
}
