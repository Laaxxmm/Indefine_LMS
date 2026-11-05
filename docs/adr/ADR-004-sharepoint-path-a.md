# ADR-004: SharePoint Path A is the only document spine

- **Status:** Accepted, 2026-11-05
- **Deciders:** Lakshmanan A (owner); Firm OS lead engineer
- **Related:** ADR-005, `docs/folder-contract.md` (Phase 1), `docs/inventory.md` §8.1–8.2, G-5

## Context

The firm has set up "Path A" on SharePoint: a hub site
`https://srcaassociate.sharepoint.com/sites/Indefine-Compliance` with one site per client,
`https://srcaassociate.sharepoint.com/sites/CL-{Code}`, each holding a `Compliance` library.

The LMS stores client files differently. `src/lib/clients/storage.ts` writes to one drive
(`GRAPH_DRIVE_ID`) under `GRAPH_CLIENTS_ROOT` (default `Clients`):
`<root>/<Client>/KYC/` and `<root>/<Client>/<FY>/<Department>/<Service>/`, with
`<root>/_Database/Client Database.xlsx`. `ClientDocument` rows point at those items by drive and item
id. The same drive also holds L&D videos, SOP documents and engagement letters.

Two parallel stores for client deliverables would make "is the file filed?" (ADR-005) ambiguous.

## Decision

1. **Path A is the only place Firm OS writes client deliverables.** Layout (detailed in
   `docs/folder-contract.md`, Phase 1):
   `CL-{Code}` site → `Compliance` library → `FY{YYYY-YY}/` → `{Service}/` (`GST`, `ROC`,
   `IncomeTax`, `TDS`, `Books`, `Audit`, `Engagement`) → `{Period}/` (`2026-10`, `Q2`, `Annual`) →
   `Working/`, `Final/`, `ClientDocs/`. `{Code}` is the Turia/firm client code, uppercase A–Z0–9,
   3–10 characters.
2. **Paths are computed, not typed.** `src/lib/integrations/sharepoint/paths.ts` provides pure
   `clSiteUrl(code)` and `deliverablePath(code, fy, service, period, kind)`. The FY boundary is
   1 April, computed in IST via `src/lib/ist.ts`.
3. **Create-if-missing, never delete.** `clfolders.ts` offers idempotent `ensureClientSite(code)`
   (joined to the hub) and `ensureFyTree(code, fy)`. The SharePoint adapter re-exports only
   non-destructive Graph functions; `deleteDriveItem`, `deleteEvent`, `moveDriveItem` and
   `sendMailAsUser` from `src/lib/graph.ts` are not reachable from Firm OS code
   (`verify:no-delete`).
4. **Legacy layout stays readable.** Nothing under `GRAPH_CLIENTS_ROOT` is moved, renamed or
   deleted by Firm OS. `ClientDocument` links keep working. `/clients` resolves new links through
   `paths.ts` only when `FIRM_OS_CL_PATHS` is on. `scripts/map-legacy-folders.ts` produces a dry-run
   mapping report (legacy folder → proposed `CL-{Code}` path); any actual copy is a separate,
   human-approved step.
5. `FirmClient` (already in the schema) links an LMS `Client` to its `clientCode`,
   `turiaClientRef` and `clSiteUrl`.

## Consequences

- One answer to "where is the final file": `deliverablePath()` for that job. The close-loop gate checks that exact path (ADR-005).
- Creating sites and joining them to the hub needs SharePoint permissions beyond what the LMS app documents (`Files.ReadWrite.All`, `User.Read.All`). Phase 1 uses the PnP app (ClientId `381abf0e-e427-417f-9b45-651e8ca823ec`, tenant `srcaassociate`). **Blocked / needs human:** its certificate or secret, and SharePoint/Entra admin consent.
- Clients without a code cannot get a Path A site until the code is assigned (Phase 3 asks for it).
- For a while some client history sits in the legacy layout and new work in Path A. The dry-run report makes the gap visible; it is closed by people, not by an automatic move.
- `verify-patha` (Phase 1) is read-only and reports gaps into PROGRESS.

## Alternatives considered

1. **Keep using `GRAPH_CLIENTS_ROOT` for Firm OS deliverables.** Rejected: one shared drive cannot give per-client permissions, the `Client Upload` group, or per-client lists that Path A provides.
2. **Migrate legacy folders into Path A automatically.** Rejected: moves on a live drive risk broken links and lost permissions; the LMS rule is no moves or deletes without a human.
3. **Store deliverables in Postgres or Railway storage.** Rejected: SharePoint is the firm's document system, with retention and access control already in place.
