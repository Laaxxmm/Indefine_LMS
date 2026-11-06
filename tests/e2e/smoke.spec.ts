// E2E smoke: the four staff routes are behind sign-in. A visitor with no session cookie is
// sent to "/" (the Microsoft sign-in page). Uses only the `request` fixture (no browser).
import { expect, test } from "@playwright/test";

for (const route of ["/dashboard", "/clients", "/work", "/tools"]) {
  test(`${route} redirects a signed-out visitor to sign-in`, async ({ request, baseURL }) => {
    const first = await request.get(route, { maxRedirects: 0 });
    expect(first.status(), `${route} status`).toBeGreaterThanOrEqual(300);
    expect(first.status(), `${route} status`).toBeLessThan(400);
    expect(new URL(first.headers()["location"] ?? "", baseURL).pathname).toBe("/");

    const landed = await request.get(route);
    expect(landed.ok()).toBe(true);
    expect(new URL(landed.url()).pathname).toBe("/");
    expect(await landed.text()).toContain("Internal learning portal");
  });
}
