# Summary execution

The sidebar generates an initial summary and at most one refinement for each
immutable user message. Successful cached summaries survive reloads. It does not
regenerate an unchanged message on a turn counter.

Each request reserves its attempt on disk before transport. Two attempts per
message cover successes and failures together. A transient failure schedules a
retry after `Retry-After`, or after 60 seconds when no deadline is supplied.
After those attempts, that message keeps its text preview. New messages remain
eligible. This sidecar never pauses the owner goal or its workers.

Summary calls wait while the parent goal or shared guard is paused. Queued work
continues after admission returns. An already dispatched request may settle.
Worker cards consume activity events and make no additional model calls.

Cache envelopes contain validated records and a SHA-256 digest. Invalid caches
produce a diagnostic naming the file and issue no requests. Cached request
reservations also expose interrupted work rather than forgetting its attempt.

`/sidebar-summaries status` shows the sidecar state. An optional human
`/sidebar-summaries retry` grants another bounded attempt after a diagnosed
persistent failure. Routine transport recovery needs no command.

## Verification

On 2026-09-13, the existing 82 checks and TypeScript check passed. Direct manual
execution with a local response fixture verified zero calls while the parent
was paused, continuation when admission returned, two calls over 100 unchanged
turns including a reload, and automatic recovery from HTTP 503 after its supplied
retry deadline. These checks made no upstream requests. Fleet adoption is a
separate release requirement.
