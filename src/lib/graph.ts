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
  return account?.access_token ?? null;
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

/**
 * Recursively list every video file under `folderId`.
 * Each returned item carries the name of its immediate parent folder
 * (so the sync layer can group videos into Modules) and the full path
 * from the root for display.
 */
export async function listVideosRecursive(
  driveId: string,
  rootFolderId: string,
  token: string,
  rootFolderName = "Videos"
): Promise<VideoWithFolder[]> {
  const out: VideoWithFolder[] = [];
  const stack: { id: string; path: string[] }[] = [
    { id: rootFolderId, path: [rootFolderName] },
  ];
  while (stack.length) {
    const { id, path } = stack.pop()!;
    const children = await listChildren(driveId, id, token);
    const parentName = path[path.length - 1];
    for (const c of children) {
      if (c.folder) {
        stack.push({ id: c.id, path: [...path, c.name] });
      } else if (c.file?.mimeType?.startsWith("video/")) {
        out.push({ ...c, parentFolderName: parentName, parentPath: path });
      }
    }
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
  const item = await graphFetch<GraphDriveItem>(
    `/drives/${driveId}/items/${itemId}?$select=id,@microsoft.graph.downloadUrl`,
    token
  );
  return item["@microsoft.graph.downloadUrl"] ?? null;
}
