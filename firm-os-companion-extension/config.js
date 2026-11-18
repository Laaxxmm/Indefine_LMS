// The one Firm OS address this extension talks to. It must match host_permissions and the
// connect-src of the content security policy in manifest.json. To point a copy at another Firm OS
// (staging), run `node firm-os-companion-extension/build.mjs --origin=https://<host>` and load the
// dist/ folder it writes; the build rewrites all three places together.
export const LMS_ORIGIN = "https://lms.indefine.in";
