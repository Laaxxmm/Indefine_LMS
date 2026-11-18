import { describe, it, expect } from "vitest";
import { PNP_CLIENT_ID_DEFAULT, pnpBlockedAction, readSharePointConfig, requirePnp } from "./config";
import { BlockedError } from "./errors";

describe("readSharePointConfig", () => {
  it("defaults to the srcaassociate tenant and Indefine-Compliance hub with no certificate", () => {
    const c = readSharePointConfig({});
    expect(c.tenantHost).toBe("srcaassociate.sharepoint.com");
    expect(c.hubSiteUrl).toBe("https://srcaassociate.sharepoint.com/sites/Indefine-Compliance");
    expect(c.tenantId).toBe("srcaassociate.onmicrosoft.com");
    expect(c.siteOwner).toBeNull();
    expect(c.pnp).toBeNull();
    expect(c.pnpMissing).toEqual(["SP_PNP_CERT_KEY_PEM", "SP_PNP_CERT_PEM or SP_PNP_CERT_THUMBPRINT"]);
  });

  it("reads overrides, unescapes PEM newlines and normalises the thumbprint", () => {
    const c = readSharePointConfig({
      SP_TENANT_HOST: "contoso.sharepoint.com",
      SP_HUB_SITE_URL: "https://contoso.sharepoint.com/sites/Hub",
      MS_TENANT_ID: "tid-ms",
      SP_SITE_OWNER: " admin@contoso.com ",
      SP_PNP_CLIENT_ID: "cid",
      SP_PNP_CERT_KEY_PEM: "line1\\nline2\\nline3",
      SP_PNP_CERT_THUMBPRINT: "8e:d1:dc:e7:9a:d8:93:c7:0d:19:a4:8e:77:c2:02:ae:8f:c5:74:d3",
      SP_PNP_CERT_KEY_PASSPHRASE: "pw",
    });
    expect(c.tenantHost).toBe("contoso.sharepoint.com");
    expect(c.hubSiteUrl).toBe("https://contoso.sharepoint.com/sites/Hub");
    expect(c.tenantId).toBe("tid-ms");
    expect(c.siteOwner).toBe("admin@contoso.com");
    expect(c.pnpMissing).toEqual([]);
    expect(c.pnp).toEqual({
      tenantId: "tid-ms",
      clientId: "cid",
      privateKeyPem: "line1\nline2\nline3",
      certPem: null,
      thumbprint: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3",
      passphrase: "pw",
    });
  });

  it("prefers SP_TENANT_ID and the PnP default client id; cert PEM satisfies the thumbprint need", () => {
    const c = readSharePointConfig({ SP_TENANT_ID: "tid-sp", MS_TENANT_ID: "tid-ms", SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_PEM: "c" });
    expect(c.tenantId).toBe("tid-sp");
    expect(c.pnp?.clientId).toBe(PNP_CLIENT_ID_DEFAULT);
    expect(c.pnp?.certPem).toBe("c");
    expect(c.pnp?.thumbprint).toBeNull();
  });

  it("reports what is missing when only part of the certificate is configured", () => {
    expect(readSharePointConfig({ SP_PNP_CERT_PEM: "c" }).pnpMissing).toEqual(["SP_PNP_CERT_KEY_PEM"]);
    const keyOnly = readSharePointConfig({ SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_THUMBPRINT: "  " });
    expect(keyOnly.pnp).toBeNull();
    expect(keyOnly.pnpMissing).toEqual(["SP_PNP_CERT_PEM or SP_PNP_CERT_THUMBPRINT"]);
  });
});

describe("requirePnp", () => {
  it("throws BlockedError naming the exact human action", () => {
    const c = readSharePointConfig({});
    try {
      requirePnp(c);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(BlockedError);
      const action = (e as BlockedError).action;
      expect(action).toContain("381abf0e-e427-417f-9b45-651e8ca823ec");
      expect(action).toContain("Sites.FullControl.All");
      expect(action).toContain("SP_PNP_CERT_KEY_PEM");
      expect((e as Error).message).toBe(`BLOCKED: ${action}`);
    }
  });

  it("returns credentials when configured", () => {
    const c = readSharePointConfig({ SP_PNP_CERT_KEY_PEM: "k", SP_PNP_CERT_PEM: "c" });
    expect(requirePnp(c).privateKeyPem).toBe("k");
    expect(pnpBlockedAction(["X"], "id")).toContain("ClientId id");
  });
});
