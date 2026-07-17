// Microsoft Graph helpers.
//
// Two access patterns:
//   1. App-only token (client_credentials) — used server-side to list the shared
//      videos folder and resolve fresh stream URLs. Requires Files.Read.All
//      (application) admin consent on the Entra app registration.
//   2. Delegated token (per-user) — fallback if app-only is not granted. Pulls
//      the access_token from the user's NextAuth Account row.
//
// We prefer app-only because video listings should be identical for everyone.

import { prisma } from "@/lib/prisma";

const GRAPH = "https://graph.microsoft.com/v1.0";

let cachedAppToken: { token: string; exp: number } | null = null;

export async function getAppOnlyToken(): Promise<string | null> {
  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) return null;

  if (cachedAppToken && cachedAppToken.exp > Date.now() + 60_000) {
    return cachedAppToken.token;
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    }
  );
  if (!res.ok) {
    console.error("Graph app-only token failed:", await res.text());
    return null;
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedAppToken = {
    token: json.access_token,
    exp: Date.now() + json.expires_in * 1000,
  };
  return cachedAppToken.token;
}

export async function getUserGraphToken(userId: string): Promise<string | null> {
  const account = await prisma.account.findFirst({
    where: { userId, provider: "microsoft-entra-id" },
  });
  if (!account) return null;

  // Token still valid (with 60s slack) → use as-is.
  const now = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at > now + 60) {
    return account.access_token;
  }

  // Expired and no refresh token — force a clean re-auth upstream rather than
  // handing back a dead token (Graph rejects it with a confusing 401).
  if (!account.refresh_token) return null;

  // Refresh using the SAME Entra app that minted the delegated token (the one
  // NextAuth signs in with), falling back to the app-only client vars only if
  // those aren't set. A refresh_token can only be redeemed by its own client,
  // so using the wrong client_id here silently fails.
  const clientId =
    process.env.AUTH_MICROSOFT_ENTRA_ID_ID ?? process.env.MS_CLIENT_ID;
  const clientSecret =
    process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET ?? process.env.MS_CLIENT_SECRET;
  const issuer = process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER;
  const tokenUrl = issuer
    ? issuer.replace(/\/v2\.0\/?$/, "") + "/oauth2/v2.0/token"
    : `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}/oauth2/v2.0/token`;
  if (!clientId || !clientSecret) return null;

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
      scope:
        "openid profile email offline_access User.Read Files.Read.All Files.ReadWrite.All Calendars.ReadWrite OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetingArtifact.Read.All",
    }),
  });
  if (!res.ok) {
    console.error("Refresh token failed:", await res.text());
    return null;
  }
  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };
  await prisma.account.update({
    where: {
      provider_providerAccountId: {
        provider: account.provider,
        providerAccountId: account.providerAccountId,
      },
    },
    data: {
      access_token: json.access_token,
      expires_at: now + json.expires_in,
      refresh_token: json.refresh_token ?? account.refresh_token,
    },
  });
  return json.access_token;
}

async function graphFetch<T>(path: string, token: string): Promise<T> {
  const res = await fetch(`${GRAPH}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Graph ${path} failed: ${res.status} ${await res.text()}`);
  }
  return res.json() as Promise<T>;
}

export interface GraphDriveItem {
  id: string;
  name: string;
  size?: number;
  folder?: { childCount: number };
  file?: { mimeType: string };
  video?: { duration?: number; width?: number; height?: number };
  "@microsoft.graph.downloadUrl"?: string;
}

export interface VideoWithFolder extends GraphDriveItem {
  /** Name of the immediate parent folder (used as the Module title). */
  parentFolderName: string;
  /** Path from the root sync folder, e.g. ["L&D", "AS"]. */
  parentPath: string[];
}

async function listChildren(
  driveId: string,
  itemId: string,
  token: string
): Promise<GraphDriveItem[]> {
  const data = await graphFetch<{ value: GraphDriveItem[]; "@odata.nextLink"?: string }>(
    `/drives/${driveId}/items/${itemId}/children?$top=200&$select=id,name,size,folder,file,video,@microsoft.graph.downloadUrl`,
    token
  );
  return data.value;
}

async function listChildrenByPath(
  driveId: string,
  path: string,
  token: string
): Promise<GraphDriveItem[]> {
  // path-based children listing — more robust than item-id lookup for the
  // top-level folder, which can return IDs that don't round-trip cleanly
  // in some SharePoint configurations.
  const encoded = path
    .split("/")
    .filter(Boolean)
    .map(encodeURIComponent)
    .join("/");
  const data = await graphFetch<{ value: GraphDriveItem[] }>(
    `/drives/${driveId}/root:/${encoded}:/children?$top=200&$select=id,name,size,folder,file,video,@microsoft.graph.downloadUrl`,
    token
  );
  return data.value;
}

/**
 * List the names of the immediate subfolders of a drive path (e.g. the course
 * folders under the L&D root). Used to offer existing folders as choices when
 * scheduling a live session. Best-effort — returns [] on any failure.
 */
export async function listSubfolderNames(
  driveId: string,
  parentPath: string,
  token: string
): Promise<string[]> {
  try {
    const children = await listChildrenByPath(driveId, parentPath, token);
    return children
      .filter((c) => c.folder)
      .map((c) => c.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

/**
 * Recursively list every video file under `folderId`.
 * Each returned item carries the name of its immediate parent folder
 * (so the sync layer can group videos into Modules) and the full path
 * from the root for display.
 */
export async function listVideosRecursive(
  driveId: string,
  root: { kind: "id"; itemId: string } | { kind: "path"; folderPath: string },
  token: string,
  rootFolderName = "Videos"
): Promise<VideoWithFolder[]> {
  const out: VideoWithFolder[] = [];

  // First listing: by path or by id, depending on what we have.
  const firstChildren =
    root.kind === "path"
      ? await listChildrenByPath(driveId, root.folderPath, token)
      : await listChildren(driveId, root.itemId, token);

  const stack: { children: GraphDriveItem[]; path: string[] }[] = [
    { children: firstChildren, path: [rootFolderName] },
  ];

  while (stack.length) {
    const { children, path } = stack.pop()!;
    const parentName = path[path.length - 1];
    for (const c of children) {
      if (c.folder) {
        // Subfolder IDs from a successful listing always round-trip cleanly,
        // so we can use item-id-based recursion from here on.
        const sub = await listChildren(driveId, c.id, token);
        stack.push({ children: sub, path: [...path, c.name] });
      } else if (c.file?.mimeType?.startsWith("video/")) {
        out.push({ ...c, parentFolderName: parentName, parentPath: path });
      }
    }
  }
  return out;
}

// -------------------- Organisation users --------------------

export interface GraphOrgUser {
  id: string;
  displayName: string | null;
  mail: string | null;
  userPrincipalName: string;
  jobTitle?: string | null;
  accountEnabled: boolean;
  assignedLicenses?: { skuId: string }[];
  userType?: string | null;  // "Member" or "Guest"
}

/**
 * Fetch all enabled + licensed Member users in the M365 tenant.
 * Mirrors the M365 admin "Active users · Licensed users" filter so
 * service accounts, shared mailboxes, guests, and unlicensed accounts
 * are excluded automatically.
 *
 * Requires User.Read.All Application permission with admin consent.
 */
export async function listOrgUsers(token: string): Promise<GraphOrgUser[]> {
  const out: GraphOrgUser[] = [];
  let url:
    | string
    | undefined = `${GRAPH}/users?$select=id,displayName,mail,userPrincipalName,jobTitle,accountEnabled,assignedLicenses,userType&$top=999`;
  while (url) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Graph /users failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as {
      value: GraphOrgUser[];
      "@odata.nextLink"?: string;
    };
    for (const u of json.value) {
      // Three filters that match the M365 admin "Active · Licensed" view:
      //   1. accountEnabled — sign-in not blocked
      //   2. has at least one assigned license
      //   3. userType is Member (not Guest / external)
      const enabled = u.accountEnabled === true;
      const licensed = (u.assignedLicenses?.length ?? 0) > 0;
      const isMember = !u.userType || u.userType.toLowerCase() === "member";
      if (enabled && licensed && isMember) out.push(u);
    }
    url = json["@odata.nextLink"];
  }
  return out;
}

/** Single-level listing kept for back-compat / direct use. */
export async function listFolderVideos(
  driveId: string,
  folderId: string,
  token: string
): Promise<GraphDriveItem[]> {
  const children = await listChildren(driveId, folderId, token);
  return children.filter((i) => i.file?.mimeType?.startsWith("video/"));
}

export async function getStreamUrl(
  driveId: string,
  itemId: string,
  token: string
): Promise<string | null> {
  // Preferred: ask Graph for the metadata, which usually includes a
  // pre-authenticated @microsoft.graph.downloadUrl. App-only tokens against
  // SharePoint sometimes omit this field, so we have a fallback below.
  const item = await graphFetch<GraphDriveItem>(
    `/drives/${driveId}/items/${itemId}?$select=id,@microsoft.graph.downloadUrl`,
    token
  );
  if (item["@microsoft.graph.downloadUrl"]) {
    return item["@microsoft.graph.downloadUrl"];
  }

  // Fallback: hit /content directly. Graph responds with a 302 to a
  // pre-authenticated CDN URL. We capture the Location header without
  // following the redirect.
  const res = await fetch(
    `${GRAPH}/drives/${driveId}/items/${itemId}/content`,
    {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      redirect: "manual",
    }
  );
  const location = res.headers.get("location");
  if (location) return location;
  return null;
}

// -------------------- Live sessions (Teams) --------------------

export interface TeamsEventInput {
  subject: string;
  bodyHtml?: string;
  /** Wall-clock local times "YYYY-MM-DDTHH:mm:ss" interpreted in `timeZone`. */
  startLocal: string;
  endLocal: string;
  /** Time zone name Graph understands, e.g. "India Standard Time". */
  timeZone: string;
  attendeeEmails: string[];
}

export interface TeamsEventResult {
  eventId: string;
  joinUrl: string | null;
}

/**
 * Create a Teams meeting as a calendar event on the signed-in user's calendar.
 * Graph emails the Teams invite to every attendee automatically.
 * Requires a delegated token with Calendars.ReadWrite.
 */
export async function createTeamsEvent(
  token: string,
  input: TeamsEventInput
): Promise<TeamsEventResult> {
  const payload = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.bodyHtml ?? "" },
    start: { dateTime: input.startLocal, timeZone: input.timeZone },
    end: { dateTime: input.endLocal, timeZone: input.timeZone },
    isOnlineMeeting: true,
    onlineMeetingProvider: "teamsForBusiness",
    allowNewTimeProposals: false,
    attendees: input.attendeeEmails.map((address) => ({
      emailAddress: { address },
      type: "required",
    })),
  };
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`Graph create event failed: ${res.status} ${await res.text()}`);
  }
  const ev = (await res.json()) as {
    id: string;
    onlineMeeting?: { joinUrl?: string } | null;
  };
  return { eventId: ev.id, joinUrl: ev.onlineMeeting?.joinUrl ?? null };
}

/** Reschedule / rename an existing calendar event (Teams pushes the update to
 * attendees). Requires the organizer's delegated token. */
export async function updateTeamsEvent(
  token: string,
  eventId: string,
  input: { subject: string; startLocal: string; endLocal: string; timeZone: string }
): Promise<void> {
  const res = await fetch(`${GRAPH}/me/events/${eventId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      subject: input.subject,
      start: { dateTime: input.startLocal, timeZone: input.timeZone },
      end: { dateTime: input.endLocal, timeZone: input.timeZone },
    }),
  });
  if (!res.ok) {
    throw new Error(`Graph update event failed: ${res.status} ${await res.text()}`);
  }
}

/** Cancel (delete) a previously created calendar event. Best-effort. */
export async function deleteEvent(token: string, eventId: string): Promise<void> {
  await fetch(`${GRAPH}/me/events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

/**
 * Ensure a subfolder exists under `parentPath` on `driveId`, returning its
 * driveItem id. Idempotent — returns the existing folder if already present.
 * Requires a write scope (delegated or app Files.ReadWrite.All).
 */
export async function ensureFolder(
  driveId: string,
  parentPath: string,
  folderName: string,
  token: string
): Promise<string> {
  const enc = (p: string) =>
    p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const cleanParent = parentPath.replace(/^\/+|\/+$/g, "");
  const fullPath = cleanParent ? `${cleanParent}/${folderName}` : folderName;

  // Already there?
  const getRes = await fetch(`${GRAPH}/drives/${driveId}/root:/${enc(fullPath)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (getRes.ok) {
    const item = (await getRes.json()) as { id: string };
    return item.id;
  }

  // Create it under the parent (or the drive root if parent is empty).
  const childrenUrl = cleanParent
    ? `${GRAPH}/drives/${driveId}/root:/${enc(cleanParent)}:/children`
    : `${GRAPH}/drives/${driveId}/root/children`;
  const createRes = await fetch(childrenUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: folderName,
      folder: {},
      "@microsoft.graph.conflictBehavior": "fail",
    }),
  });
  if (!createRes.ok) {
    throw new Error(
      `Graph create folder failed: ${createRes.status} ${await createRes.text()}`
    );
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Resolve the Teams onlineMeeting id for a join URL, in the signed-in user's
 * (/me) context. Requires OnlineMeetings.Read(Write).
 */
export async function resolveOnlineMeetingId(
  token: string,
  joinWebUrl: string
): Promise<string | null> {
  const filter = `JoinWebUrl eq '${joinWebUrl}'`;
  const res = await fetch(
    `${GRAPH}/me/onlineMeetings?$filter=${encodeURIComponent(filter)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { value?: { id: string }[] };
  return json.value?.[0]?.id ?? null;
}

/**
 * Apply our meeting defaults: automatic cloud recording, and org-wide
 * presenting. Auto-record alone guarantees the recording is attributed to the
 * ORGANIZER (and lands in their OneDrive) no matter who presents; letting any
 * internal attendee present keeps trainer-led sessions working when the
 * trainer isn't the scheduler. "End meeting for all" stays organizer-only in
 * Teams regardless of this setting. Best-effort — returns ok.
 */
export async function applyMeetingSettings(
  token: string,
  meetingId: string
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/me/onlineMeetings/${meetingId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      recordAutomatically: true,
      allowedPresenters: "organization",
    }),
  });
  return res.ok;
}

export interface RecordingCandidate {
  id: string;
  name: string;
  driveId: string;
  createdDateTime: string;
  size: number;
}

/**
 * List video files in a OneDrive /Recordings folder — where Teams saves cloud
 * recordings of non-channel meetings. Newest first (sorted client-side:
 * $orderby on createdDateTime isn't reliably supported by Graph for children
 * listings, and a rejected query would look identical to "no recordings").
 */
async function listRecordingsIn(
  token: string,
  drivePrefix: string // "/me/drive" or "/users/{idOrUpn}/drive"
): Promise<RecordingCandidate[]> {
  const res = await fetch(
    `${GRAPH}${drivePrefix}/root:/Recordings:/children?$select=id,name,size,file,createdDateTime,parentReference&$top=200`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) {
    // 404 just means the user has never recorded anything (no folder yet).
    if (res.status !== 404) {
      console.error(
        `Graph ${drivePrefix}/Recordings listing failed: ${res.status} ${await res
          .text()
          .catch(() => "")}`
      );
    }
    return [];
  }
  const json = (await res.json()) as {
    value?: {
      id: string;
      name: string;
      size?: number;
      createdDateTime: string;
      file?: { mimeType?: string };
      parentReference?: { driveId?: string };
    }[];
  };
  return (json.value ?? [])
    .filter((i) => i.file?.mimeType?.startsWith("video/"))
    .map((i) => ({
      id: i.id,
      name: i.name,
      driveId: i.parentReference?.driveId ?? "",
      createdDateTime: i.createdDateTime,
      size: i.size ?? 0,
    }))
    .sort((a, b) => b.createdDateTime.localeCompare(a.createdDateTime));
}

/**
 * Upload a small file (materials/PDF) into a drive folder by path, via simple
 * upload (fine for <250MB). Overwrites a same-named file. Best-effort per file.
 */
export async function uploadFileToFolder(
  driveId: string,
  folderPath: string,
  fileName: string,
  bytes: ArrayBuffer,
  token: string
): Promise<boolean> {
  const enc = (p: string) =>
    p.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const path = `${enc(folderPath)}/${encodeURIComponent(fileName)}`;
  const res = await fetch(
    `${GRAPH}/drives/${driveId}/root:/${path}:/content?@microsoft.graph.conflictBehavior=replace`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/octet-stream" },
      body: bytes,
    }
  );
  if (!res.ok) {
    console.error(`Graph upload ${fileName} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.ok;
}

/** Resolve a folder's driveItem id from its path under the drive root. */
export async function resolveFolderId(
  driveId: string,
  path: string,
  token: string
): Promise<string | null> {
  const enc = path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const url = enc
    ? `${GRAPH}/drives/${driveId}/root:/${enc}`
    : `${GRAPH}/drives/${driveId}/root`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  if (!res.ok) return null;
  const item = (await res.json()) as { id: string };
  return item.id;
}

/**
 * Move a driveItem into another folder (and optionally rename it). Used to
 * relocate a live-session's folder under a new parent — the item id is
 * preserved, so recordings inside keep resolving. Requires a write scope.
 */
export async function moveDriveItem(
  driveId: string,
  itemId: string,
  destParentId: string,
  token: string,
  newName?: string
): Promise<boolean> {
  const res = await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      parentReference: { id: destParentId },
      ...(newName ? { name: newName } : {}),
    }),
  });
  if (!res.ok) {
    console.error(`Graph move item failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  return res.ok;
}

/** Delete a drive item (best-effort). Used to drop a wrongly-ingested recording. */
export async function deleteDriveItem(
  driveId: string,
  itemId: string,
  token: string
): Promise<void> {
  await fetch(`${GRAPH}/drives/${driveId}/items/${itemId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  }).catch(() => {});
}

/** The signed-in user's own /Recordings (delegated token). */
export async function listMyRecordings(
  token: string
): Promise<RecordingCandidate[]> {
  return listRecordingsIn(token, "/me/drive");
}

/**
 * Another user's /Recordings, addressed by Entra object id or UPN/email.
 * Requires an APP-ONLY token with Files.Read.All (application) — a delegated
 * token cannot read other people's OneDrives.
 */
export async function listUserRecordings(
  appToken: string,
  userIdOrUpn: string
): Promise<RecordingCandidate[]> {
  return listRecordingsIn(appToken, `/users/${encodeURIComponent(userIdOrUpn)}/drive`);
}

/**
 * Copy a drive item into a folder (possibly on another drive within the tenant).
 * Graph runs this asynchronously — returns the monitor URL to poll, or null.
 */
export async function copyDriveItem(
  token: string,
  srcDriveId: string,
  itemId: string,
  destDriveId: string,
  destFolderId: string,
  newName?: string
): Promise<string | null> {
  const res = await fetch(
    `${GRAPH}/drives/${srcDriveId}/items/${itemId}/copy`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        parentReference: { driveId: destDriveId, id: destFolderId },
        ...(newName ? { name: newName } : {}),
      }),
    }
  );
  if (res.status === 202 || res.ok) return res.headers.get("location");
  return null;
}

/**
 * Poll a copy monitor URL until the async copy finishes; returns the new item
 * id, or null if it fails / doesn't complete within the budget.
 */
export async function pollCopyStatus(
  monitorUrl: string,
  maxTries = 20,
  delayMs = 3000
): Promise<string | null> {
  for (let i = 0; i < maxTries; i++) {
    const res = await fetch(monitorUrl, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as {
        status?: string;
        resourceId?: string;
      };
      if (json.status === "completed" && json.resourceId) return json.resourceId;
      if (json.status === "failed") return null;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

/**
 * Fetch the Teams meeting transcript text (the organizer's /me meeting), if one
 * exists. Returns plain text parsed from the WebVTT, or null if there's no
 * transcript yet. Requires OnlineMeetingTranscript.Read.All and that
 * transcription actually ran during the meeting.
 */
export async function fetchMeetingTranscript(
  token: string,
  meetingId: string
): Promise<string | null> {
  const listRes = await fetch(
    `${GRAPH}/me/onlineMeetings/${meetingId}/transcripts`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!listRes.ok) return null;
  const list = (await listRes.json()) as {
    value?: { id: string; createdDateTime?: string }[];
  };
  const transcripts = list.value ?? [];
  if (transcripts.length === 0) return null;

  // Newest transcript first.
  transcripts.sort((a, b) =>
    (b.createdDateTime ?? "").localeCompare(a.createdDateTime ?? "")
  );

  const contentRes = await fetch(
    `${GRAPH}/me/onlineMeetings/${meetingId}/transcripts/${transcripts[0].id}/content?$format=text/vtt`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!contentRes.ok) return null;
  const vtt = await contentRes.text();
  return vttToText(vtt);
}

/**
 * True once the meeting has at least one completed session — Teams generates
 * an attendance report the moment a meeting session ends, so this is the
 * fastest truthful "it actually ended" signal (recording processing lags by
 * minutes). Returns null when unknown (permission missing / API error).
 * Requires OnlineMeetingArtifact.Read.All.
 */
export async function meetingHasEnded(
  token: string,
  meetingId: string
): Promise<boolean | null> {
  const res = await fetch(
    `${GRAPH}/me/onlineMeetings/${meetingId}/attendanceReports?$top=1`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = (await res.json()) as { value?: unknown[] };
  return (json.value?.length ?? 0) > 0;
}

export interface AttendanceEntry {
  email: string;
  seconds: number;
}

/**
 * Fetch per-attendee attendance for the organizer's (/me) meeting from the Teams
 * attendance report: each attendee's email + total seconds present (summed
 * across rejoins). Empty until Teams has generated the report (minutes after the
 * meeting ends). Requires OnlineMeetingArtifact.Read.All.
 */
export async function listAttendanceRecords(
  token: string,
  meetingId: string
): Promise<AttendanceEntry[]> {
  const listRes = await fetch(
    `${GRAPH}/me/onlineMeetings/${meetingId}/attendanceReports?$top=5`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!listRes.ok) return [];
  const list = (await listRes.json()) as {
    value?: { id: string; meetingEndDateTime?: string }[];
  };
  const reports = (list.value ?? []).slice();
  if (reports.length === 0) return [];
  // Newest report (most recent meeting occurrence) first.
  reports.sort((a, b) =>
    (b.meetingEndDateTime ?? "").localeCompare(a.meetingEndDateTime ?? "")
  );

  const recRes = await fetch(
    `${GRAPH}/me/onlineMeetings/${meetingId}/attendanceReports/${reports[0].id}/attendanceRecords?$top=200`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
  );
  if (!recRes.ok) return [];
  const recs = (await recRes.json()) as {
    value?: { emailAddress?: string | null; totalAttendanceInSeconds?: number }[];
  };
  // A person who rejoined has multiple records — sum their seconds by email.
  const byEmail = new Map<string, number>();
  for (const r of recs.value ?? []) {
    const email = (r.emailAddress ?? "").trim().toLowerCase();
    if (!email) continue;
    byEmail.set(email, (byEmail.get(email) ?? 0) + (r.totalAttendanceInSeconds ?? 0));
  }
  return [...byEmail].map(([email, seconds]) => ({ email, seconds }));
}

/** Strip WebVTT cue timings / numbers / speaker tags down to readable text. */
function vttToText(vtt: string): string {
  const out: string[] = [];
  let last = "";
  for (const raw of vtt.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line === "WEBVTT" || line.startsWith("NOTE")) continue;
    if (line.includes("-->")) continue; // cue timing
    if (/^\d+$/.test(line)) continue; // cue number
    if (/^[0-9a-f-]{20,}\/\d+-\d+$/i.test(line)) continue; // cue id
    const clean = line.replace(/<[^>]+>/g, "").trim(); // drop <v Speaker> etc.
    if (clean && clean !== last) {
      out.push(clean);
      last = clean;
    }
  }
  return out.join(" ");
}

/**
 * Upload (create or replace) a small file's content by path. For files < 4 MB —
 * fine for generated SOP .docx documents. Returns the new item's id + webUrl.
 */
export async function uploadFileContent(
  driveId: string,
  fullPath: string,
  bytes: Uint8Array,
  contentType: string,
  token: string
): Promise<{ id: string; webUrl: string }> {
  const enc = fullPath.split("/").filter(Boolean).map(encodeURIComponent).join("/");
  const res = await fetch(`${GRAPH}/drives/${driveId}/root:/${enc}:/content`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": contentType },
    body: bytes as BodyInit,
  });
  if (!res.ok) throw new Error(`Graph upload failed: ${res.status} ${await res.text()}`);
  const item = (await res.json()) as { id: string; webUrl: string };
  return { id: item.id, webUrl: item.webUrl };
}
