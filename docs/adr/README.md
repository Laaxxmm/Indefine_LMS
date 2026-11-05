# Architecture decision records — Indefine Firm OS

Each record states the context, the decision, its consequences and the alternatives considered.
A record changes only through a new record that supersedes it (thresholds included).
The repository inventory these decisions rest on is in [`docs/inventory.md`](../inventory.md).

| ADR | Title | Status | Date | In one line |
|---|---|---|---|---|
| [ADR-001](ADR-001-extend-lms.md) | Extend the LMS, do not build greenfield | Accepted | 2026-11-05 | Firm OS lives in this repo and follows its conventions: npm, flat `src/app/<module>/`, route handlers, `access.ts` roles, additive schema, `FIRM_OS_*` flags off. |
| [ADR-002](ADR-002-model-router.md) | ModelRouter and providers | Accepted | 2026-11-05 | All Firm OS AI goes through `src/lib/ai/router.ts`: Claude now, Grok optional, local stub fails closed; `local-only` never reaches the cloud; budget guard; `ModelCall` logs hashes only. Legacy Gemini stays, two callers flagged. |
| [ADR-003](ADR-003-turia-adapter.md) | Turia adapter | Accepted | 2026-11-05 | No documented Turia API exists; ManualBridge is active, UiAutomationBridge optional (partner, read-first, dry-run), ApiBridge only with vendor docs. |
| [ADR-004](ADR-004-sharepoint-path-a.md) | SharePoint Path A is the only document spine | Accepted | 2026-11-05 | Deliverables go to `CL-{Code}` sites under the Indefine-Compliance hub; legacy `GRAPH_CLIENTS_ROOT` stays readable; no moves or deletes. |
| [ADR-005](ADR-005-close-loop-done.md) | DONE requires Turia close and SharePoint presence | Accepted | 2026-11-05 | `JobTask` state machine; `DONE` only via `closeLoop.gate()`, enforced below the UI. |
| [ADR-006](ADR-006-dpdp-data-classes.md) | DPDP data classes and anonymization | Accepted | 2026-11-05 | Client PII reaches a cloud model only masked; token map never sent; inputs ≤ 30 days; break-nudge heartbeats 7 days, no manager report. |
| [ADR-007](ADR-007-graph-upload-put.md) | Graph file upload via create-only PUT | Accepted | 2026-11-05 | One PUT path with conflictBehavior=fail so deliverables can be written; never overwrites; versions instead. |
| [ADR-008](ADR-008-agent-guardrails.md) | Agent guardrails: stay in the department, never guess | Accepted | 2026-11-05 | Scope contract per agent, closed outputs with insufficient_evidence, grounding of every extracted value, mandatory validators, agreement on block-level judgements, wrong-input fail-closed, versioned prompts, drift monitoring. |
| [ADR-009](ADR-009-ai-guardrail-standards.md) | AI guardrails mapped to OWASP LLM Top 10 (2025) and the NIST AI RMF | Accepted | 2026-11-05 | Per-category control / gap / fix; untrusted-document fence and injection screen (block flag `possible-prompt-injection`), declared privacy per task, output-handling and no-tools scans, per-task token limits and run budget, hallucination budget per task, red-team fixtures gated in the harness, generated per-task profile; comms adopted; a withheld GST ledger has its ITC held back (owner, 2026-11-06). |

## Open items raised by these ADRs

| Item | ADR | Type |
|---|---|---|
| Turia API documentation and credentials; permission for UI automation | 003 | Blocked / needs human |
| PnP app certificate or secret; SharePoint/Entra admin consent for site creation | 004 | Blocked / needs human |
| Entra groups claim or Graph consent to read Partners/Staff membership | 001 | Needs human if consent required |
| Gemini transcription of recorded live sessions; SOP Builder free text unmasked | 002, 006 | Known gap, partner decision |
| Pin `@anthropic-ai/sdk` exactly in package.json; workspace next-task view to list the possible-prompt-injection question | 009 | Owner / workspace owner |
