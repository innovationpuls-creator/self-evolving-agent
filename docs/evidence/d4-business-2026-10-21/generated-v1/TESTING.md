# Verification report

Candidate-only implementation; no formal Skill or application configuration was modified. No network requests, dependency installations or external data services were needed. Runtime imports only host-provided SDK/typebox and the relative local `diff.ts` module. A bounded local LCS avoids adding a third-party dependency and its deployment closure.

## Reproduce

```sh
# From this package directory, with the application's installed SDK:
PI_SDK_ROOT=/path/to/node_modules/@earendil-works/pi-coding-agent JITI_FS_CACHE=false npm test
```

Observed with Node v26.10.0 and the application's Pi SDK v1.3.0: **9 tests passed, 0 failures, 0 skips**.

Coverage: both inputs empty; one side empty; Chinese replacement with exact old/new line numbers; repeated-line deterministic ties; CRLF/LF equivalence; final newline metadata; blank lines; whitespace; standalone CR; emoji; explicit size/line/table limits; pre-aborted calls; 1,000 seeded randomized comparisons validating reconstruction, line-number monotonicity and independently computed insertion/deletion distance. The native Pi loader loaded `extension.ts` with no errors, registered exactly one deferred Tool, and executed four real `text_diff` calls. TypeBox validated their parameters and structured output; JSON text, details and structuredContent matched. An oversized real Tool invocation rejected explicitly.

Strict TypeScript no-emit checking of `diff.ts` and `extension.ts` also passed using the application's installed compiler and host package type paths, with target ES2022, module/moduleResolution NodeNext, strict, allowImportingTsExtensions, and skipLibCheck. The temporary absolute-path check configuration was removed; runtime files contain no development-directory references.

## Evidence boundary

Local loader/execute checks are not claims of publication or later-session discovery. Submission includes the observed empty, Chinese and repeated-line calls as reproducible Host probes. Host validation/publication and subsequent ordinary-session `tool_search` discovery are the remaining platform acceptance steps.
