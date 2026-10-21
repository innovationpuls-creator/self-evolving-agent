#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdio.h>
// Test-only inherited sandbox probe; argv is never interpreted by a privileged process.
int main(int argc, char **argv) {
    if (argc != 2) return 2;
    int root = open(".", O_RDONLY | O_DIRECTORY);
    if (root < 0) return 3;
    int readFD = openat(root, argv[1], O_RDONLY);
    int readError = readFD < 0 ? errno : 0;
    if (readFD >= 0) close(readFD);
    int writeFD = openat(root, argv[1], O_RDWR);
    int writeError = writeFD < 0 ? errno : 0;
    if (writeFD >= 0) close(writeFD);
    close(root);
    printf("{\"read\":%d,\"write\":%d}\n", readError, writeError);
    return 0;
}
