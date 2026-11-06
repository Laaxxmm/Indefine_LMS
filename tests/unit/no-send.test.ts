// Non-negotiable 1 (client-facing sends are human-only): no code path in src/ sends mail. Repo scan
// over every code file under src/ (tests included) for a Graph send call — the sendMail action or
// a message's send / reply / replyAll / forward action — and for the sendMail-only payload field.
// Client emails are Outlook drafts in the person's own mailbox (src/lib/integrations/outlook).
//
// The forbidden words are assembled from pieces so this file never matches its own rules.
import { describe, expect, it } from "vitest";
import { loadFiles } from "../../scripts/lib/repo-files";

const SEND = "send";
const MAIL = "Mail";
const VERBS = [SEND, "reply", "reply" + "All", "forward"];

export const NO_SEND_RULES: [string, RegExp][] = [
  // The Graph sendMail action, or any helper named after it (sendMail, sendMailAsUser, ...).
  ["no-send:sendmail", new RegExp(`${SEND}${MAIL}`)],
  // A message action path: .../send, .../reply, .../replyAll, .../forward at the end of a URL path segment.
  ["no-send:message-action", new RegExp(`/(?:${VERBS.join("|")})(?=["'\`?/)]|$)`, "m")],
  // Only a sendMail request body carries this field.
  ["no-send:save-to-sent-items", new RegExp(`saveTo${"Sent"}Items`)],
];

const CODE = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

export function sendViolations(files: { path: string; content: string }[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    f.content.split(/\r?\n/).forEach((line, i) => {
      for (const [rule, re] of NO_SEND_RULES) if (re.test(line)) out.push(`${f.path}:${i + 1}  ${rule}  ${line.trim().slice(0, 160)}`);
    });
  }
  return out;
}

describe("no send path in src/", () => {
  it("no file under src/ calls a Graph send, reply or forward action", () => {
    const files = loadFiles((p) => p.startsWith("src/") && CODE.test(p));
    expect(files.length).toBeGreaterThan(300);
    expect(sendViolations(files)).toEqual([]);
  });

  it("the rules catch each send form (and leave drafts and our own routes alone)", () => {
    const hit = (line: string) => sendViolations([{ path: "x.ts", content: line }]);
    const caught = [
      `await fetch(\`\${GRAPH}/me/${SEND}${MAIL}\`, {`,
      `export async function ${SEND}${MAIL}AsUser(token: string) {}`,
      `fetch(\`\${GRAPH}/me/messages/\${id}/${SEND}\`, { method: "POST" })`,
      `client.api("/users/x/messages/abc/${SEND}").post({})`,
      `fetch(\`\${GRAPH}/me/messages/\${id}/reply\`)`,
      `fetch(\`\${GRAPH}/me/messages/\${id}/replyAll?x=1\`)`,
      `const p = "/me/messages/1/forward";`,
      `body: JSON.stringify({ message, saveTo${"Sent"}Items: true })`,
    ];
    for (const line of caught) expect(hit(line), line).toHaveLength(1);
    const allowed = [
      'fetch(`${GRAPH_BASE}/me/messages`, { method: "POST" })',
      "`/me/messages/${id}/attachments/createUploadSession`",
      "`/api/tools/engagement-letters/${id}/outlook-draft`",
      "`/api/firm-os/comms/drafts/${id}/outlook`",
      "Chat.Create ChatMessage.Send",
      "createReply is a draft; so is createForward",
      "// staff send it themselves from Outlook",
    ];
    for (const line of allowed) expect(hit(line), line).toEqual([]);
  });

  it("the Outlook adapter exports draft functions only", async () => {
    const mod = await import("@/lib/integrations/outlook/drafts");
    expect(Object.keys(mod).filter((k) => /send|reply|forward/i.test(k))).toEqual([]);
    expect(typeof mod.createOutlookDraft).toBe("function");
  });
});
