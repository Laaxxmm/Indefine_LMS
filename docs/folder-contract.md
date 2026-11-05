# Folder contract — SharePoint Path A

SharePoint Path A is the firm's only document spine for compliance work (ADR-004). This
contract defines where every client deliverable lives. The code that builds these paths
is `src/lib/integrations/sharepoint/paths.ts`; nothing else may hand-assemble a Path A URL.

## 1. Layout

```
https://srcaassociate.sharepoint.com/sites/CL-{Code}          one communication site per client
└── Compliance                                                document library (URL name "Compliance")
    └── FY{YYYY-YY}/                                          e.g. FY2026-27
        └── {Service}/                                        GST | ROC | IncomeTax | TDS | Books | Audit | Engagement
            └── {Period}/                                     2026-10 (monthly) | Q2 (quarterly) | Annual
                ├── Working/                                  agent drafts, staff workings
                ├── Final/                                    approved deliverables (close-loop gate reads here)
                └── ClientDocs/                               documents received from the client
```

Example: the approved GSTR-3B pack for October 2026 for client `ACME01`:

```
https://srcaassociate.sharepoint.com/sites/CL-ACME01/Compliance/FY2026-27/GST/2026-10/Final/
```

### Hub

Every `CL-{Code}` site is associated with the hub
`https://srcaassociate.sharepoint.com/sites/Indefine-Compliance` (navigation, search scope,
shared theme). The hub itself holds no client documents.

### Per-site objects

| Object | Type | Purpose |
|---|---|---|
| `Compliance` | Document library | The FY tree above. |
| `ClientObligations` | Generic list | One row per statutory obligation for the client (service, period, due date, status). |
| `ClientRequests` | Generic list | Open document requests to the client (item, service, period, requested on, status). |
| `Client Upload` | SharePoint site group | Client-side contributors. Intended to receive Contribute on `ClientDocs` folders only (permission scoping is a later phase; the group is created empty). |

Firm-wide Entra groups (checked by `scripts/verify-patha.ts`, not created by code):
Partners `e5583268-4c8c-4abf-8b35-3ef1f0d37a78`, Staff `67ed1191-302b-495a-913b-b93cc6ee118d`.

## 2. Segment rules

| Segment | Rule | Valid | Invalid |
|---|---|---|---|
| `{Code}` | Turia / firm client code. Uppercase `A–Z0–9` only, 3–10 characters. Never lower-cased or trimmed silently — invalid input is rejected. | `ACME`, `ACME01`, `SRCA2026` | `acme`, `AC`, `ACME-01`, `ABCDEFGHIJK` |
| `FY{YYYY-YY}` | Indian financial year, 1 April – 31 March, decided on the **IST** calendar date. `31 Mar 23:59 IST` belongs to the previous FY; `1 Apr 00:00 IST` (= `31 Mar 18:30 UTC`) starts the new one. | `FY2026-27`, `FY2099-00` | `FY2026-28`, `2026-27` (as a folder name) |
| `{Service}` | Exactly one of `GST`, `ROC`, `IncomeTax`, `TDS`, `Books`, `Audit`, `Engagement` (case-sensitive). | `IncomeTax` | `Income Tax`, `gst` |
| `{Period}` | Monthly `YYYY-MM` (must fall inside the FY: Apr of the start year to Mar of the end year); quarterly `Q1`–`Q4` (FY quarters: Q1 = Apr–Jun … Q4 = Jan–Mar); or `Annual`. | `2026-10`, `Q2`, `Annual` | `2026-13`, `Q5`, `2027-04` under FY2026-27, `annual` |
| `{Kind}` | Exactly one of `Working`, `Final`, `ClientDocs`. | `Final` | `final`, `Draft` |

Default periods created by `ensureFyTree` when the caller does not say otherwise:

| Service | Default periods |
|---|---|
| GST, Books | 12 months `YYYY-04` … `YYYY+1-03` |
| TDS | `Q1`–`Q4` |
| ROC, IncomeTax, Audit, Engagement | `Annual` |

## 3. Provisioning (idempotent, no deletes)

`src/lib/integrations/sharepoint/clfolders.ts`:

- `ensureClientSite(code)` — finds `/sites/CL-{Code}` via Graph; when missing, creates a
  communication site through SharePoint REST `/_api/SPSiteManager/create`, waits for it to be
  ready, then joins the hub with `/_api/site/JoinHubSite('{hubSiteId}')` if it is not already
  associated. Site creation needs a SharePoint-resource token from the PnP app (certificate auth;
  see §6). Without the certificate it throws `BlockedError` naming the exact human action.
- `ensureFyTree(code, fy, { periods? })` — ensures the `Compliance` library, the FY folder, every
  service folder, the period folders and `Working` / `Final` / `ClientDocs` under each period.
- `ensureClientLists(code)` — ensures `ClientObligations` and `ClientRequests`.
- `ensureClientUploadGroup(code)` — ensures the `Client Upload` site group.

Each returns the list of things it created; a second run returns an empty list and leaves
SharePoint unchanged (asserted by `clfolders.integration.test.ts`). The Path A client exposes no
delete, move or rename operation at all.

Gap check (read-only): `npx tsx scripts/verify-patha.ts [--codes ACME,FOO] [--fy 2026-27] [--out gaps.md]`.
Exit 0 = no gaps, 1 = gaps found, 2 = blocked (credentials or consent missing; never a pass).

## 4. Mapping from the legacy `/clients` layout

The LMS `/clients` module (Sept 2026) stores files in one shared drive (`GRAPH_DRIVE_ID`):

```
<GRAPH_CLIENTS_ROOT>/<Client folder name>/KYC/
<GRAPH_CLIENTS_ROOT>/<Client folder name>/<FY 2026-27>/<Department>/<Service>/
```

| Legacy | Path A |
|---|---|
| `<Client folder name>` | `CL-{Code}` site, where `{Code}` = `FirmClient.clientCode` for that LMS client. No code → no Path A target (stays legacy). |
| `KYC/` | `FY{onboarding FY}/Engagement/Annual/ClientDocs/` |
| `<FY>` e.g. `2026-27` | `FY2026-27` |
| `Tax/` + service mentioning GST | `GST/` |
| `Tax/` + service mentioning TDS | `TDS/` |
| `Tax/` + anything else (ITR, advance tax, notices, appeals) | `IncomeTax/` |
| `Audit/` (statutory, tax, internal, stock audit, certification) | `Audit/` |
| `Accounts/` (bookkeeping, MIS, payroll, finalisation) | `Books/` |
| `ROC/` | `ROC/` |
| `Tech/`, `Admin - Ops/`, `General/` | no Path A target — reported as *unmapped, needs a decision* |

The period level has no legacy equivalent: annual services map to `Annual`; GST, TDS and
Books files are placed into their month/quarter folder when they are copied. Files inside a
legacy job folder map to `Working/` unless the document type is a filed return,
acknowledgement or client sign-off (→ `Final/`) or source data (→ `ClientDocs/`).

`scripts/map-legacy-folders.ts` prints this mapping for every client and job as a dry-run
report (markdown or CSV). It reads the database and the legacy folders and **never writes** to
Graph or the database. Moving content is a separate, human-approved step; the legacy layout
stays readable indefinitely — nothing is moved or deleted by this phase.

## 5. Feature flag `FIRM_OS_CL_PATHS`

Read only through `src/lib/integrations/sharepoint/flags.ts`. Default **off**.

| Flag | Client has `FirmClient.clientCode` | `/clients/[id]` folder links |
|---|---|---|
| off (default) | any | Legacy behaviour, unchanged: "SharePoint: Clients / <folder>" and per-document links. |
| on | no | Legacy behaviour, unchanged. |
| on | yes | Header links to `https://srcaassociate.sharepoint.com/sites/CL-{Code}`; each job links to its `Compliance/FY…/{Service}/` folder (resolved by `paths.ts`). Existing document links (`webUrl`) keep pointing at the legacy files. Uploads still go to the legacy layout until the copy step is approved. |

Values `1`, `true`, `on`, `yes` (any case) turn it on; anything else is off.

## 6. Configuration

| Variable | Meaning |
|---|---|
| `FIRM_OS_CL_PATHS` | Flag above. |
| `SP_TENANT_HOST` | `srcaassociate.sharepoint.com` (default). |
| `SP_HUB_SITE_URL` | Defaults to `https://<SP_TENANT_HOST>/sites/Indefine-Compliance`. |
| `SP_TENANT_ID` | Entra tenant id or domain for the PnP token; defaults to `MS_TENANT_ID`, then `<tenant>.onmicrosoft.com`. |
| `SP_PNP_CLIENT_ID` | PnP app registration; defaults to `381abf0e-e427-417f-9b45-651e8ca823ec`. |
| `SP_PNP_CERT_KEY_PEM` | PEM private key of the certificate uploaded to the PnP app (`\n` escapes allowed). |
| `SP_PNP_CERT_PEM` | The matching public certificate PEM (the SHA-1/SHA-256 thumbprints are derived from it), **or** |
| `SP_PNP_CERT_THUMBPRINT` | the certificate's SHA-1 thumbprint (hex) when the PEM is not supplied. |
| `SP_SITE_OWNER` | UPN set as owner of newly created `CL-` sites (SharePoint requires an owner for app-only creation). |

Graph reads (sites, lists, drives, folders, groups) use the existing LMS app-only token
(`getAppOnlyToken` in `src/lib/graph.ts`, `MS_*` variables). Required application permissions:
Graph `Sites.ReadWrite.All` (folders, lists) and `Group.Read.All` (gap check); SharePoint
`Sites.FullControl.All` on the PnP app (site creation, hub join, site groups).
