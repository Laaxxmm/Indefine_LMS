import { describe, it, expect, vi } from "vitest";
import { createHash, generateKeyPairSync, verify, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildClientAssertion, certThumbprints, createPnpTokenProvider, tokenEndpoint } from "./sp-auth";
import { GraphError } from "./errors";
import type { PnpCredentials } from "./config";

// Public test certificate only (CN=firm-os-test-only); its private key was never kept.
const CERT = readFileSync(join(__dirname, "../../../../tests/fixtures/sharepoint/test-cert.pem"), "utf8");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const creds = (over: Partial<PnpCredentials> = {}): PnpCredentials => ({
  tenantId: "srcaassociate.onmicrosoft.com",
  clientId: "381abf0e-e427-417f-9b45-651e8ca823ec",
  privateKeyPem: KEY_PEM,
  certPem: CERT,
  thumbprint: null,
  passphrase: null,
  ...over,
});

const decode = (part: string) => JSON.parse(Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());

describe("certThumbprints", () => {
  it("derives x5t (SHA-1) and x5t#S256 from the certificate", () => {
    const der = new X509Certificate(CERT).raw;
    const t = certThumbprints({ certPem: CERT, thumbprint: null });
    expect(Buffer.from(t.x5t, "base64url").toString("hex")).toBe(createHash("sha1").update(der).digest("hex"));
    expect(Buffer.from(t.x5tS256!, "base64url").toString("hex")).toBe(createHash("sha256").update(der).digest("hex"));
    expect(t.x5t).not.toMatch(/[+/=]/);
  });

  it("uses a configured SHA-1 thumbprint when no certificate PEM is given", () => {
    const hex = "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3";
    const t = certThumbprints({ certPem: null, thumbprint: hex });
    expect(Buffer.from(t.x5t, "base64url").toString("hex").toUpperCase()).toBe(hex);
    expect(t.x5tS256).toBeUndefined();
  });

  it("rejects a malformed or missing thumbprint", () => {
    expect(() => certThumbprints({ certPem: null, thumbprint: "ABC" })).toThrow(/40 hex/);
    expect(() => certThumbprints({ certPem: null, thumbprint: null })).toThrow(/40 hex/);
  });
});

describe("buildClientAssertion", () => {
  it("produces an RS256 JWT the public key verifies, with Entra v2 claims", () => {
    const jwt = buildClientAssertion(creds(), { nowSec: 1_800_000_000, jti: "jti-1" });
    const [h, p, s] = jwt.split(".");
    const header = decode(h);
    const payload = decode(p);
    expect(header).toMatchObject({ alg: "RS256", typ: "JWT" });
    expect(header.x5t).toBeTruthy();
    expect(header["x5t#S256"]).toBeTruthy();
    expect(payload).toEqual({
      aud: "https://login.microsoftonline.com/srcaassociate.onmicrosoft.com/oauth2/v2.0/token",
      iss: "381abf0e-e427-417f-9b45-651e8ca823ec",
      sub: "381abf0e-e427-417f-9b45-651e8ca823ec",
      jti: "jti-1",
      nbf: 1_800_000_000,
      iat: 1_800_000_000,
      exp: 1_800_000_600,
    });
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("defaults jti/now and omits x5t#S256 in thumbprint mode", () => {
    const jwt = buildClientAssertion(creds({ certPem: null, thumbprint: "8ED1DCE79AD893C70D19A48E77C202AE8FC574D3" }));
    const header = decode(jwt.split(".")[0]);
    const payload = decode(jwt.split(".")[1]);
    expect(header["x5t#S256"]).toBeUndefined();
    expect(payload.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(Math.abs(payload.nbf - Date.now() / 1000)).toBeLessThan(5);
  });

  it("supports an encrypted private key with passphrase", () => {
    const enc = privateKey.export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "pw" }).toString();
    const jwt = buildClientAssertion(creds({ privateKeyPem: enc, passphrase: "pw" }));
    const [h, p, s] = jwt.split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });
});

describe("createPnpTokenProvider", () => {
  it("posts a client-assertion grant for the SharePoint resource and caches per host", async () => {
    let t = 1_000_000;
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      const body = new URLSearchParams(String(init.body));
      return new Response(JSON.stringify({ access_token: `tok:${body.get("scope")}`, expires_in: 3600 }), { status: 200 });
    });
    const get = createPnpTokenProvider(creds(), { fetch, now: () => t });
    expect(await get("srcaassociate.sharepoint.com")).toBe("tok:https://srcaassociate.sharepoint.com/.default");
    expect(await get("srcaassociate.sharepoint.com")).toBe("tok:https://srcaassociate.sharepoint.com/.default");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe(tokenEndpoint("srcaassociate.onmicrosoft.com"));
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_assertion_type")).toBe("urn:ietf:params:oauth:client-assertion-type:jwt-bearer");
    expect(body.get("client_assertion")!.split(".")).toHaveLength(3);
    expect(body.get("client_secret")).toBeNull();

    await get("other.sharepoint.com");
    expect(fetch).toHaveBeenCalledTimes(2);
    t += 3600 * 1000; // expired
    await get("srcaassociate.sharepoint.com");
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("throws GraphError when the token endpoint refuses", async () => {
    const fetch = vi.fn(async () => new Response("AADSTS700027: certificate not registered", { status: 401 }));
    const get = createPnpTokenProvider(creds(), { fetch });
    await expect(get("srcaassociate.sharepoint.com")).rejects.toBeInstanceOf(GraphError);
    await expect(get("srcaassociate.sharepoint.com")).rejects.toThrow(/AADSTS700027/);
  });

  it("falls back to global fetch when none is injected", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ access_token: "g", expires_in: 60 }), { status: 200 }));
    expect(await createPnpTokenProvider(creds())("h.sharepoint.com")).toBe("g");
    expect(spy).toHaveBeenCalledOnce();
  });
});
