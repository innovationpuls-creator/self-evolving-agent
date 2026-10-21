#import <Foundation/Foundation.h>
#import <Security/Security.h>
#import <xpc/xpc.h>
#import <spawn.h>
#import <signal.h>
#import <sys/wait.h>
#import <unistd.h>
#import <fcntl.h>
#import <stdatomic.h>

// Only this fixed, bundled service is addressable. JSON operation authorization stays in Host.
#ifdef D4_SANDBOX
static NSString *const serviceID = @"dev.personal.agent.d4-sandbox";
static const char *bridgeID = "dev.personal.agent.d4-bridge";
#else
static NSString *const serviceID = @"dev.personal.agent.reflection";
static const char *bridgeID = "dev.personal.agent.reflection-bridge";
#endif
static const NSUInteger lineLimit = 8 * 1024 * 1024;
static xpc_connection_t connection;
static pid_t workerPID;
static int workerInput = -1;
static BOOL started;
static _Atomic(BOOL) workerFinished;
static NSString *workerTerminal;
static NSLock *writeLock;
static NSMutableSet<NSString *> *outstanding;
static NSUInteger idleSeconds;
static dispatch_source_t workerTimer;
static dispatch_queue_t workerWriteQueue;

static void stopWorker(void) {
    @synchronized(writeLock) {
        if (workerInput >= 0) { close(workerInput); workerInput = -1; }
        if (workerPID > 0) {
            pid_t pid = workerPID;
            kill(-pid, SIGKILL);
        }
    }
}

static void sendLine(xpc_connection_t peer, NSString *line) {
    if (!line || [line lengthOfBytesUsingEncoding:NSUTF8StringEncoding] > lineLimit) return;
    xpc_object_t message = xpc_dictionary_create(NULL, NULL, 0);
    xpc_dictionary_set_string(message, "line", line.UTF8String);
    xpc_connection_send_message(peer, message);
}

static void fail(NSString *reason) {
    stopWorker();
    NSData *data = [NSJSONSerialization dataWithJSONObject:@{@"kind": @"finished", @"ok": @NO, @"error": reason} options:0 error:NULL];
    NSString *line = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
#ifdef REFLECTION_SERVICE
    sendLine(connection, line);
#else
    write(STDOUT_FILENO, data.bytes, data.length); write(STDOUT_FILENO, "\n", 1);
    exit(1);
#endif
}

static NSString *codeRequirement(NSURL *bundle) {
    SecStaticCodeRef code = NULL;
    CFDictionaryRef information = NULL;
    if (SecStaticCodeCreateWithPath((__bridge CFURLRef)bundle, kSecCSDefaultFlags, &code) != errSecSuccess) return nil;
    OSStatus valid = SecStaticCodeCheckValidity(code, kSecCSStrictValidate, NULL);

    OSStatus copied = SecCodeCopySigningInformation((SecCodeRef)code, kSecCSSigningInformation, &information);
    NSData *hash = information ? ((__bridge NSDictionary *)information)[(__bridge NSString *)kSecCodeInfoUnique] : nil;
    NSMutableString *hex = [NSMutableString string];
    if (valid == errSecSuccess && copied == errSecSuccess && hash.length >= 20) {
        const unsigned char *bytes = hash.bytes;
        for (NSUInteger i = 0; i < hash.length; i++) [hex appendFormat:@"%02x", bytes[i]];
    }
    if (information) CFRelease(information);
    CFRelease(code);
    return hex.length ? [NSString stringWithFormat:@"cdhash H\"%@\"", hex] : nil;
}

static BOOL pinPeer(xpc_connection_t peer, NSURL *expectedBundle) {

    NSString *requirement = codeRequirement(expectedBundle);
    return requirement && xpc_connection_set_peer_code_signing_requirement(peer, requirement.UTF8String) == 0;
}

static BOOL writeAll(int fd, NSData *data) {
    const char *bytes = data.bytes; NSUInteger offset = 0;
    while (offset < data.length) {
        ssize_t size = write(fd, bytes + offset, data.length - offset);
        if (size < 0 && errno == EINTR) continue;
        if (size <= 0) return NO;
        offset += size;
    }
    return YES;
}

static void readLines(int fd, void (^lineHandler)(NSString *), void (^endHandler)(void)) {
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        @autoreleasepool {
            NSMutableData *pending = [NSMutableData data]; char buffer[8192];
            ssize_t count;
#ifdef D4_SANDBOX
            NSUInteger totalBytes = 0;
#endif
            while ((count = read(fd, buffer, sizeof(buffer))) > 0) {
#ifdef D4_SANDBOX
                totalBytes += (NSUInteger)count;
                if (totalBytes > 32 * 1024 * 1024) { fail(@"d4_output_limit"); return; }
#endif
                for (ssize_t i = 0; i < count; i++) {
                    if (buffer[i] == '\n') {
                        NSString *line = [[NSString alloc] initWithData:pending encoding:NSUTF8StringEncoding];
                        if (!line) { fail(@"native_protocol_invalid"); return; }
                        lineHandler(line); [pending setLength:0];
                    } else {
                        [pending appendBytes:&buffer[i] length:1];
                        if (pending.length > lineLimit) { fail(@"native_message_too_large"); return; }
                    }
                }
            }
            endHandler();
        }
    });
}

#ifdef REFLECTION_SERVICE
static void startWorker(NSString *firstLine) {
    NSURL *contents = [NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:@"Contents"];
#ifdef D4_SANDBOX
    NSString *node = [[contents URLByAppendingPathComponent:@"MacOS/D4Node"] path];
    NSString *launcher = [[contents URLByAppendingPathComponent:@"MacOS/D4Launcher"] path];
    NSString *worker = [[contents URLByAppendingPathComponent:@"Resources/runtime/dist/host/evolution/sandbox/worker.js"] path];
#else
    NSString *node = [[contents URLByAppendingPathComponent:@"MacOS/ReflectionNode"] path];
    NSString *worker = [[contents URLByAppendingPathComponent:@"Resources/runtime/dist/host/reflection/worker.js"] path];
#endif
    NSString *workspace = [NSTemporaryDirectory() stringByAppendingPathComponent:[@"reflection-" stringByAppendingString:NSUUID.UUID.UUIDString]];
    NSString *agentDir = [workspace stringByAppendingPathComponent:@"agent"];
    if (![NSFileManager.defaultManager createDirectoryAtPath:agentDir withIntermediateDirectories:YES attributes:@{NSFilePosixPermissions:@0700} error:NULL]) { fail(@"sandbox_workspace_unavailable"); return; }
    int input[2], output[2], diagnostics[2];
    if (pipe(input) || pipe(output) || pipe(diagnostics)) { fail(@"worker_pipe_failed"); return; }
    posix_spawn_file_actions_t actions; posix_spawn_file_actions_init(&actions);
    posix_spawn_file_actions_adddup2(&actions, input[0], STDIN_FILENO);
    posix_spawn_file_actions_adddup2(&actions, output[1], STDOUT_FILENO);
    posix_spawn_file_actions_adddup2(&actions, diagnostics[1], STDERR_FILENO);
    posix_spawn_file_actions_addchdir_np(&actions, workspace.UTF8String);
    posix_spawnattr_t attributes; posix_spawnattr_init(&attributes);
    posix_spawnattr_setflags(&attributes, POSIX_SPAWN_SETPGROUP | POSIX_SPAWN_CLOEXEC_DEFAULT);
    posix_spawnattr_setpgroup(&attributes, 0);
#ifdef D4_SANDBOX
    char *arguments[] = {(char *)launcher.UTF8String, (char *)node.UTF8String, (char *)worker.UTF8String, NULL};
#else
    NSString *launcher = node;
    char *arguments[] = {(char *)node.UTF8String, (char *)worker.UTF8String, NULL};
#endif
    NSArray<NSString *> *environment = @[@"PATH=/usr/bin:/bin", @"PI_OFFLINE=1", @"PI_SKIP_VERSION_CHECK=1", @"PI_TELEMETRY=0", [@"TMPDIR=" stringByAppendingString:NSTemporaryDirectory()], [@"HOME=" stringByAppendingString:NSHomeDirectory()], [@"AGENT_REFLECTION_AGENT_DIR=" stringByAppendingString:agentDir]];
#ifdef D4_SANDBOX
    NSString *temp = [workspace stringByAppendingPathComponent:@"tmp"];
    [NSFileManager.defaultManager createDirectoryAtPath:temp withIntermediateDirectories:YES attributes:nil error:NULL];
    environment = @[@"PATH=/usr/bin:/bin", @"PI_OFFLINE=1", @"PI_SKIP_VERSION_CHECK=1", @"PI_TELEMETRY=0", @"AGENT_D4_SANDBOX=1", [@"TMPDIR=" stringByAppendingString:temp], [@"HOME=" stringByAppendingString:workspace], [@"AGENT_REFLECTION_AGENT_DIR=" stringByAppendingString:agentDir]];
#endif
    char *variables[environment.count + 1];
    for (NSUInteger i = 0; i < environment.count; i++) variables[i] = (char *)environment[i].UTF8String;
    variables[environment.count] = NULL;
    int result = posix_spawn(&workerPID, launcher.UTF8String, &actions, &attributes, arguments, variables);
    posix_spawnattr_destroy(&attributes); posix_spawn_file_actions_destroy(&actions);
    close(input[0]); close(output[1]); close(diagnostics[1]);
    if (result != 0) { close(input[1]); close(output[0]); close(diagnostics[0]); workerPID = 0; fail(@"sandbox_worker_start_failed"); return; }
    workerInput = input[1];
    NSData *initial = [[firstLine stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding];
    if (!writeAll(workerInput, initial)) { fail(@"worker_input_failed"); return; }
#ifdef D4_SANDBOX
    pid_t guardedPID = workerPID;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 300 * NSEC_PER_SEC), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        @synchronized(writeLock) { if (workerPID == guardedPID) fail(@"d4_activity_timeout"); }
    });
#endif
    int outputRead = output[0], diagnosticRead = diagnostics[0];
    dispatch_semaphore_t stdoutDone = dispatch_semaphore_create(0);
    readLines(outputRead, ^(NSString *line) {
        NSData *data = [line dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *message = [NSJSONSerialization JSONObjectWithData:data options:0 error:NULL];
        if (![message isKindOfClass:NSDictionary.class] || ![@[@"request", @"ready", @"finished"] containsObject:message[@"kind"]]) { fail(@"worker_protocol_invalid"); return; }
        if ([message[@"kind"] isEqual:@"request"] && [message[@"requestId"] isKindOfClass:NSString.class]) {
            @synchronized(outstanding) { [outstanding addObject:message[@"requestId"]]; idleSeconds = 0; }
        }
        if (atomic_load(&workerFinished)) { fail(@"worker_protocol_after_terminal"); return; }
        if ([message[@"kind"] isEqual:@"finished"]) {
            // Publish completion only after the process has exited and its pipes are drained.
            // Otherwise Host EOF can cancel a still-exiting worker and produce two terminals.
            workerTerminal = line;
            atomic_store(&workerFinished, YES);
            return;
        }
        sendLine(connection, line);
    }, ^{ close(outputRead); dispatch_semaphore_signal(stdoutDone); });
    // Diagnostic output is drained but never crosses the sandbox/Host boundary.
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ char ignored[8192]; ssize_t count; NSUInteger total=0; while ((count=read(diagnosticRead, ignored, sizeof(ignored))) > 0) {
#ifdef D4_SANDBOX
        total += (NSUInteger)count; if(total > 4 * 1024 * 1024) { fail(@"d4_diagnostics_limit"); break; }
#endif
    } close(diagnosticRead); });
    pid_t spawnedPID=workerPID;
    dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        pid_t pid = spawnedPID;
        siginfo_t info = {0};
        while(waitid(P_PID,pid,&info,WEXITED | WNOWAIT)<0 && errno==EINTR){}
        kill(-pid, SIGKILL); // The unreaped leader reserves its PID while descendants terminate.
        int status; while (waitpid(pid, &status, 0) < 0 && errno == EINTR) {}
        long drainResult = dispatch_semaphore_wait(stdoutDone, dispatch_time(DISPATCH_TIME_NOW, 5 * NSEC_PER_SEC));
        @synchronized(writeLock) { workerPID = 0; if (workerInput >= 0) { close(workerInput); workerInput = -1; } }
        [NSFileManager.defaultManager removeItemAtPath:workspace error:NULL];
        if (drainResult != 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0 || !atomic_load(&workerFinished)) fail(@"reflection_worker_exited");
        else sendLine(connection, workerTerminal);
    });
}

static void receive(NSString *line) {
    NSDictionary *message = [NSJSONSerialization JSONObjectWithData:[line dataUsingEncoding:NSUTF8StringEncoding] options:0 error:NULL];
    NSString *kind = [message isKindOfClass:NSDictionary.class] ? message[@"kind"] : nil;
    if ([kind isEqual:@"cancel"]) { stopWorker(); return; }
    if ([kind isEqual:@"start"] && !started) { started = YES; startWorker(line); return; }
    if (![kind isEqual:@"response"] || !started || workerInput < 0) { fail(@"host_protocol_invalid"); return; }
    @synchronized(outstanding) { [outstanding removeObject:message[@"requestId"] ?: @""]; idleSeconds = 0; }
    dispatch_async(workerWriteQueue, ^{
        int inputCopy=-1;
        @synchronized(writeLock) { if(workerInput>=0)inputCopy=fcntl(workerInput,F_DUPFD_CLOEXEC,0); }
        BOOL written = inputCopy>=0 && writeAll(inputCopy, [[line stringByAppendingString:@"\n"] dataUsingEncoding:NSUTF8StringEncoding]);
        if(inputCopy>=0)close(inputCopy);
        if (!written) fail(@"worker_input_failed");
    });
}

static void acceptPeer(xpc_connection_t peer) {
            if (connection || xpc_connection_set_peer_team_identity_requirement(peer, bridgeID) != 0) { xpc_connection_cancel(peer); return; }
            connection = peer;
            xpc_connection_set_event_handler(peer, ^(xpc_object_t event) {
                if (xpc_get_type(event) == XPC_TYPE_ERROR) { stopWorker(); exit(0); }
                if (xpc_get_type(event) != XPC_TYPE_DICTIONARY) { fail(@"native_protocol_invalid"); return; }
                const char *line = xpc_dictionary_get_string(event, "line");
                if (!line || strnlen(line, lineLimit + 1) > lineLimit) { fail(@"native_protocol_invalid"); return; }
                receive([NSString stringWithUTF8String:line]);
            });
            xpc_connection_resume(peer);
            workerTimer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_global_queue(QOS_CLASS_UTILITY, 0));
            dispatch_source_set_timer(workerTimer, dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC), NSEC_PER_SEC, NSEC_PER_SEC / 10);
            dispatch_source_set_event_handler(workerTimer, ^{
                // Host may deliberately defer background work while a foreground Agent is busy.
                BOOL expired;
                @synchronized(outstanding) { if (outstanding.count == 0) idleSeconds++; expired=idleSeconds >= 15 * 60; }
                if (expired) { fail(@"reflection_worker_idle_timeout"); stopWorker(); exit(1); }
            });
            dispatch_resume(workerTimer);
}
int main(void) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN); writeLock = [NSLock new]; outstanding = [NSMutableSet set];
        workerWriteQueue = dispatch_queue_create("dev.personal.agent.reflection.worker-input", DISPATCH_QUEUE_SERIAL);
        xpc_main(acceptPeer);
    }
}
#else
int main(void) {
    @autoreleasepool {
        signal(SIGPIPE, SIG_IGN); writeLock = [NSLock new];
        NSURL *service = [NSBundle.mainBundle.bundleURL URLByAppendingPathComponent:[NSString stringWithFormat:@"Contents/XPCServices/%@.xpc", serviceID]];
        connection = xpc_connection_create(serviceID.UTF8String, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0));
        if (!pinPeer(connection, service)) { fail(@"xpc_service_identity_invalid"); return 1; }
        xpc_connection_set_event_handler(connection, ^(xpc_object_t event) {
            if (xpc_get_type(event) == XPC_TYPE_ERROR) {
                fail(event == XPC_ERROR_PEER_CODE_SIGNING_REQUIREMENT ? @"xpc_peer_identity_rejected" : event == XPC_ERROR_CONNECTION_INVALID ? @"xpc_service_connection_invalid" : @"xpc_service_interrupted"); return;
            }
            if (xpc_get_type(event) != XPC_TYPE_DICTIONARY) { fail(@"native_protocol_invalid"); return; }
            const char *line = xpc_dictionary_get_string(event, "line");
            if (!line || strnlen(line, lineLimit + 1) > lineLimit) { fail(@"native_protocol_invalid"); return; }
            [writeLock lock];
            write(STDOUT_FILENO, line, strlen(line)); write(STDOUT_FILENO, "\n", 1);
            [writeLock unlock];
        });
        xpc_connection_resume(connection);
        readLines(STDIN_FILENO, ^(NSString *line) { sendLine(connection, line); }, ^{
            sendLine(connection, @"{\"kind\":\"cancel\"}");
            dispatch_after(dispatch_time(DISPATCH_TIME_NOW, NSEC_PER_SEC / 5), dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ exit(0); });
        });
        dispatch_main();
    }
}
#endif
