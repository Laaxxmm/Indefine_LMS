import assert from "node:assert/strict";
import { ELEVATED_SCOPES, LEAD_SCOPES, SIGNIN_SCOPES, scopesCover } from "../src/lib/graph-scopes";

const words = (s: string) => s.split(" ");
// Sign-in is identity only: no refresh token, no Graph data scopes.
assert.equal(words(SIGNIN_SCOPES).includes("offline_access"), false);
assert.equal(words(SIGNIN_SCOPES).some((s) => s.startsWith("Files.") || s.startsWith("Calendars.")), false);
// Each tier contains the one below it.
for (const s of words(SIGNIN_SCOPES)) assert.equal(words(ELEVATED_SCOPES).includes(s), true, s);
for (const s of words(ELEVATED_SCOPES)) assert.equal(words(LEAD_SCOPES).includes(s), true, s);
assert.equal(words(ELEVATED_SCOPES).includes("offline_access"), true);
assert.equal(words(ELEVATED_SCOPES).includes("Calendars.ReadWrite"), true);
assert.equal(words(LEAD_SCOPES).includes("ChatMessage.Send"), true);
assert.equal(words(ELEVATED_SCOPES).includes("ChatMessage.Send"), false);

// Coverage: what Entra stores vs what a caller needs.
const granted = "Files.Read.All Files.ReadWrite.All Calendars.ReadWrite OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetingArtifact.Read.All User.Read profile openid email";
assert.equal(scopesCover(granted, ELEVATED_SCOPES), true, "offline_access is not echoed and must not be required");
assert.equal(scopesCover(granted, LEAD_SCOPES), false, "chat scopes missing");
assert.equal(scopesCover(`${granted} Chat.Create ChatMessage.Send`, LEAD_SCOPES), true);
assert.equal(scopesCover("https://graph.microsoft.com/Files.Read.All https://graph.microsoft.com/User.Read", "User.Read Files.Read.All"), true, "URL-prefixed entries count");
assert.equal(scopesCover("User.Read profile openid email", ELEVATED_SCOPES), false, "a sign-in token cannot serve elevated callers");
assert.equal(scopesCover(null, SIGNIN_SCOPES), false);
assert.equal(scopesCover("User.Read", SIGNIN_SCOPES), true);

console.log("verify-graph-scopes: all checks passed");
