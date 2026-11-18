// The one LMS address this extension sends the Turia session to, pinned at build time (security
// audit #17: it used to be a free-text field, so anyone at the keyboard could point the HttpOnly
// Turia token and the relay token at any https host). It must match host_permissions and the
// connect-src of the content security policy in manifest.json. For another LMS (staging, local
// dev), run `node neo-centra-extension/build.mjs --origin=https://<host>` and load the dist/ folder
// it writes; the build rewrites all three places together.
export const LMS_ORIGIN = "https://lms.indefine.in";
