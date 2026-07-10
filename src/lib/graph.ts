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

  // Need to refresh. Without a refresh token we can't, so fall back to whatever
  // we have (may still work for a few seconds, otherwise caller errors).
  if (!account.refresh_token) return account.access_token ?? null;

  const tenant = process.env.MS_TENANT_ID;
  const clientId = process.env.MS_CLIENT_ID;
  const clientSecret = process.env.MS_CLIENT_SECRET;
  if (!tenant || !clientId || !clientSecret) return account.access_token ?? null;

  const res = await fetch(
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: account.refresh_token,
        scope:
          "openid profile email offline_access User.Read Files.Read.All Files.ReadWrite.All Calendars.ReadWrite",
      }),
    }
  );
  if (!res.ok) {
    console.error("Refresh token failed:", await res.text());
    return account.access_token ?? null;
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
