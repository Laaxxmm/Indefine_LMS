// Client-ops: the certificate-check host is validated at save time (validateHostname from
// src/lib/hardening/net.ts), so an IP address, a port or path, or an internal name is never stored
// and the daily certificate check never connects to it.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activeSession } from "./routes/harness";

const writes = vi.hoisted(() => ({ create: [] as Record<string, unknown>[], update: [] as Record<string, unknown>[] }));

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn(), handlers: {} }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/client-ops/refresh", () => ({ runChecks: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    opsSubscription: {
      create: async (a: { data: Record<string, unknown> }) => (writes.create.push(a.data), { id: "s1" }),
      update: async (a: { data: Record<string, unknown> }) => (writes.update.push(a.data), { id: "s1" }),
    },
  },
}));

const { auth } = await import("@/lib/auth");
const { addSubscription, updateSubscription } = await import("@/app/tools/client-ops/actions");

const form = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};
const NEW = { clientId: "c1", provider: "GoDaddy", expiresOn: "2027-01-31", chargeAmount: "1200", kind: "DOMAIN", cycle: "YEARLY" };
const EDIT = { id: "s1", expiresOn: "2027-01-31", chargeAmount: "1200" };

beforeEach(() => {
  writes.create.length = 0;
  writes.update.length = 0;
  (auth as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(activeSession({ id: "u-ops" }));
});

describe("certificate host at save time", () => {
  it("stores a plain host name, lower-cased; an empty field stays empty", async () => {
    await addSubscription(form({ ...NEW, sslHost: " WWW.Client.IN. " }));
    await addSubscription(form({ ...NEW, sslHost: "" }));
    await updateSubscription(form({ ...EDIT, sslHost: "shop.client.in" }));
    expect(writes.create.map((d) => d.sslHost)).toEqual(["www.client.in", null]);
    expect(writes.update.map((d) => d.sslHost)).toEqual(["shop.client.in"]);
  });

  it("refuses an IP address, a port or path, an internal name or a bare word: nothing is saved", async () => {
    for (const bad of ["10.0.0.5", "127.0.0.1", "[::1]", "www.client.in:8443", "client.in/admin", "intranet.local", "localhost", "metadata.internal", "user@client.in", "client"]) {
      await addSubscription(form({ ...NEW, sslHost: bad }));
      await updateSubscription(form({ ...EDIT, sslHost: bad }));
    }
    expect(writes.create).toEqual([]);
    expect(writes.update).toEqual([]);
  });
});
