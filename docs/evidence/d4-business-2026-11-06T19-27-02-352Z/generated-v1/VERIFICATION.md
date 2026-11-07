# Verification

Authorized scope: only the new text-diff candidate package. No formal versions or other capabilities changed. No external data service used. No extra runtime dependencies installed; the extension uses host-provided typebox only.

Command (run from package root):

```sh
PI_SDK_ROOT=/Users/torch/Documents/ChatGPT/agent/node_modules/@earendil-works/pi-coding-agent npm test
```

Result: 8 tests passed, 0 failed, 0 skipped. Includes 1000 seeded reconstruction, line numbering, deterministic alignment and independent minimum edit-distance checks; empty inputs, Chinese replacement, repeated lines, blank lines, CRLF, final newlines, whitespace, Unicode, lone CR, size limits and cancellation. Actual native Pi extension loader loaded extension.ts without errors and invoked the registered deferred text_diff Tool for empty text, Chinese insertion, repeated lines and final-newline changes. Returned JSON was checked against the core comparison.

No separate compilation/build is needed: Pi loads this extension using its native loader. Runtime files use package-relative imports and have no dependency on the candidate's absolute location. PI_SDK_ROOT is used only by optional loader tests.

Pending host acceptance: discovery/activation and submitted probes through the native Tool pipeline, package validation and publication. Local loader tests alone do not establish publication or availability in future ordinary sessions.
