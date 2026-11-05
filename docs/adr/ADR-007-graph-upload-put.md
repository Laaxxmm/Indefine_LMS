# ADR-007 — Graph file upload uses HTTP PUT, create-only

Status: Accepted (owner approved), 2026-11-05

## Context

Phase 1 kept the Firm OS SharePoint client to GET and POST so that no code path could overwrite,
move or delete a document (non-negotiable 2; ADR-004). Phase 4 must write agent deliverables to
`Working/` and copy approved files to `Final/`. Microsoft Graph has no POST form for file content:
simple upload (`PUT …/content`) and upload-session chunks (`PUT {uploadUrl}`) are both PUT.

## Decision

Allow exactly one PUT path, constrained so it can only create:

- The verb appears once, as `UPLOAD_VERB` in `src/lib/integrations/sharepoint/graph-client.ts`,
  used only by `putContent`.
- `putContent` only receives `…:/content?@microsoft.graph.conflictBehavior=fail` URLs or the
  `uploadUrl` of an upload session created with conflictBehavior `fail`. An existing file yields
  `ConflictError`; it is never overwritten.
- Callers version instead of replacing: Working files `_v{attempt}`, Final files `_v{n}` bumped
  on conflict.
- `no-destructive.test.ts` asserts the single occurrence and the conflictBehavior constraint;
  every other Path A file keeps the blanket ban on PUT/PATCH/DELETE. The SharePoint fake answers
  PUT only on those two targets and records anything else as a violation.

## Consequences

- Deliverables can be written without any overwrite, move or delete capability.
- A future change that adds a second PUT, PATCH or DELETE fails the test suite.
- `verify:no-delete` is unchanged (it targets DELETE and delete-named functions).

## Alternatives considered

- No upload; staff upload packs by hand. Rejected: defeats the agent pack and close-loop flow.
- Reuse legacy `src/lib/graph.ts` upload helpers. Rejected: they call global fetch directly, sit
  next to `deleteDriveItem`, and cannot be injected or tested with the fake.
