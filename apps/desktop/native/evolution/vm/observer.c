#include <libproc.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/resource.h>
#include <signal.h>
#include <errno.h>

/* Read-only observer. Process birth times disambiguate reused PIDs. */
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    int pid = atoi(argv[1]);
    struct proc_bsdinfo b = {0};
    struct rusage_info_v4 r = {0};
    if (pid <= 0) return 2;
    if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &b, sizeof(b)) != sizeof(b)
        || proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&r) != 0) {
        if (kill(pid, 0) == -1 && errno == ESRCH) {
            printf("{\"pid\":%d,\"absent\":true}\n", pid);
            return 0;
        }
        return 1;
    }
    printf("{\"pid\":%d,\"startSeconds\":%llu,\"startMicroseconds\":%llu,"
           "\"startAbsolute\":%llu,\"physicalFootprint\":%llu,\"residentBytes\":%llu}\n",
           pid, b.pbi_start_tvsec, b.pbi_start_tvusec, r.ri_proc_start_abstime,
           r.ri_phys_footprint, r.ri_resident_size);
    return 0;
}
