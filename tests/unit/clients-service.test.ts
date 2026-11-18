// src/lib/clients/service.ts: shared by POST /api/clients and the Firm OS onboarding saga.
import { describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { clientBodyZ } from "@/lib/clients/core";
import { ClientExistsError, ClientNameError, clientFolderName, createClientRecord, findDuplicateClient } from "@/lib/clients/service";

const body = clientBodyZ.parse({
  name: "Acme Widgets Private Limited", entityType: "PVT_LTD", pan: "AAACA1234F", turnover: "2500000", growthGoal: "MAINTAIN",
  onboardedOn: "2026-11-05", primaryHandlerId: "u-1",
});

function db(o: { dup?: { id: string; name: string } | null; createError?: Error } = {}) {
  return {
    client: {
      findFirst: vi.fn(async () => o.dup ?? null),
      create: vi.fn(async ({ data }: { data: { jobs?: unknown } }) => {
        if (o.createError) throw o.createError;
        return { id: "c-1", jobs: data.jobs ? [{ id: "j-1" }] : [] };
      }),
    },
  };
}

describe("clients service", () => {
  it("clientFolderName rejects names with no letter/digit and the reserved name", () => {
    expect(clientFolderName("Acme / Co")).toBe("Acme - Co");
    expect(() => clientFolderName("***")).toThrow(ClientNameError);
    expect(() => clientFolderName("_database")).toThrow(/reserved/);
  });

  it("findDuplicateClient matches name, folder name or PAN case-insensitively", async () => {
    const d = db();
    await findDuplicateClient(d as never, { name: "Acme", pan: "AAACA1234F" });
    expect(d.client.findFirst.mock.calls[0]).toEqual([
      { where: { OR: [{ name: { equals: "Acme", mode: "insensitive" } }, { folderName: { equals: "Acme", mode: "insensitive" } }, { pan: "AAACA1234F" }] }, select: { id: true, name: true } },
    ]);
    await findDuplicateClient(d as never, { name: "Acme" });
    expect((d.client.findFirst.mock.calls[1] as unknown as [{ where: { OR: unknown[] } }])[0].where.OR).toHaveLength(2);
  });

  it("creates the client (band derived, folder name set) with or without a first job", async () => {
    const d = db();
    expect(await createClientRecord(d as never, { client: body, createdById: "u-2" })).toEqual({ id: "c-1", jobId: null });
    const data = (d.client.create.mock.calls[0] as unknown as [{ data: Record<string, unknown> }])[0].data;
    expect(data).toMatchObject({ name: body.name, folderName: body.name, turnoverBand: "UNDER_40L", createdById: "u-2" });
    expect(data.jobs).toBeUndefined();
    const job = { serviceTypeId: "s", fy: "2026-27", handlerId: "u-1", status: "NOT_STARTED" as const };
    expect(await createClientRecord(d as never, { client: body, createdById: "u-2", job })).toEqual({ id: "c-1", jobId: "j-1" });
  });

  it("duplicates become ClientExistsError (found first, or via the unique constraint)", async () => {
    await expect(createClientRecord(db({ dup: { id: "c-9", name: "Acme" } }) as never, { client: body, createdById: "u" })).rejects.toMatchObject({ existingId: "c-9", message: "Client already exists: Acme" });
    const race = new Prisma.PrismaClientKnownRequestError("dup", { code: "P2002", clientVersion: "6" });
    const e = await createClientRecord(db({ createError: race }) as never, { client: body, createdById: "u" }).catch((x) => x);
    expect(e).toBeInstanceOf(ClientExistsError);
    expect(e.existingId).toBeNull();
    await expect(createClientRecord(db({ createError: new Error("down") }) as never, { client: body, createdById: "u" })).rejects.toThrow("down");
  });
});
