// Nudges go into a Teams chat as the lead. Graph does not allow app-only tokens to post
// chat messages, so this rides on the lead's delegated token (getUserGraphToken), which
// means the lead must have signed in after Chat.Create / ChatMessage.Send were added.
import { getUserGraphToken } from "@/lib/graph";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { trackerUsers } from "./db";

const GRAPH = "https://graph.microsoft.com/v1.0";
const post = (token: string, body: unknown): RequestInit => ({
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(15_000),
});

/** Find or create the chat. Tries a named group chat first; if Graph refuses a two-person
 *  group, falls back to a oneOnOne chat. The id is stored in Settings either way. */
async function ensureChat(token: string): Promise<string> {
  const settings = await getSettings();
  if (settings.workTeamsChatId) return settings.workTeamsChatId;
  const users = await trackerUsers();
  if (users.length < 2) throw new Error("Need two tracker users to create the chat");
  const members = users.map((u) => ({
    "@odata.type": "#microsoft.graph.aadUserConversationMember",
    roles: ["owner"],
    "user@odata.bind": `${GRAPH}/users('${u.email}')`,
  }));
  let res = await fetch(`${GRAPH}/chats`, post(token, { chatType: "group", topic: "Tech Work", members }));
  if (!res.ok) {
    console.warn("Tech Work group chat refused, trying oneOnOne:", res.status, await res.text());
    res = await fetch(`${GRAPH}/chats`, post(token, { chatType: "oneOnOne", members: members.slice(0, 2) }));
  }
  if (!res.ok) throw new Error(`Graph create chat failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  await prisma.settings.update({ where: { id: 1 }, data: { workTeamsChatId: id } });
  return id;
}

/** Post one plain-text message. Never throws; the caller logs the result and moves on. */
export async function postTechWorkMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const lead = (await trackerUsers())[0];
    if (!lead) return { ok: false, error: "No tracker users configured" };
    const token = await getUserGraphToken(lead.id);
    if (!token) return { ok: false, error: "Lead has no usable Graph token, sign out and in again" };
    const chatId = await ensureChat(token);
    const res = await fetch(`${GRAPH}/chats/${chatId}/messages`, post(token, { body: { contentType: "text", content: text } }));
    if (!res.ok) return { ok: false, error: `Graph post failed: ${res.status} ${await res.text()}` };
    return { ok: true };
  } catch (e) {
    console.error("Tech Work nudge failed:", e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
