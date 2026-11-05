// Shared fixtures for the route smoke tests: an empty-database Prisma stand-in, sessions,
// and the redirect/notFound sentinels that the mocked next/navigation throws.
//
// Each test file still declares its own vi.mock calls (vitest hoists them per file); they
// delegate here so every route renders against the same fake world.
import type { Session } from "next-auth";
import { isValidElement, type ReactElement } from "react";
import { renderToReadableStream } from "react-dom/server.edge";

// ------------------------------------------------------------------ navigation sentinels

export class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}
export class NotFoundSignal extends Error {
  constructor() {
    super("NEXT_NOT_FOUND");
  }
}

export const navigationMock = {
  redirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
  permanentRedirect: (url: string): never => {
    throw new RedirectSignal(url);
  },
  notFound: (): never => {
    throw new NotFoundSignal();
  },
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  RedirectType: { push: "push", replace: "replace" },
};

// ------------------------------------------------------------------ empty-database Prisma

/** Every query a page can make returns the "nothing in the database yet" answer. */
function emptyResult(method: string, args: unknown): unknown {
  if (method === "findMany" || method === "groupBy") return [];
  if (method === "count") return 0;
  if (method === "aggregate") return { _sum: {}, _avg: {}, _min: {}, _max: {}, _count: {} };
  if (method.startsWith("find")) {
    if (method.endsWith("OrThrow")) throw new Error(`prisma mock: ${method} found nothing`);
    return null;
  }
  if (method === "createMany" || method === "updateMany" || method === "deleteMany") return { count: 0 };
  // create / update / upsert echo back what the page wrote, as Prisma would.
  const a = (args ?? {}) as { data?: object; create?: object };
  return { id: "mock-id", createdAt: new Date(), updatedAt: new Date(), ...(a.create ?? {}), ...(a.data ?? {}) };
}

export type PrismaCall = { model: string; method: string; args: unknown };
export const prismaCalls: PrismaCall[] = [];

function model(name: string) {
  return new Proxy(
    {},
    {
      get: (_t, method: string | symbol) => {
        if (typeof method !== "string" || method === "then") return undefined;
        return async (args?: unknown) => {
          prismaCalls.push({ model: name, method, args });
          return emptyResult(method, args);
        };
      },
    },
  );
}

export const prismaMock: Record<string, unknown> = new Proxy(
  {},
  {
    get: (_t, key: string | symbol) => {
      if (typeof key !== "string" || key === "then") return undefined;
      if (key === "$transaction") {
        return async (arg: unknown) => (Array.isArray(arg) ? Promise.all(arg) : (arg as (tx: unknown) => unknown)(prismaMock));
      }
      if (key === "$queryRaw" || key === "$queryRawUnsafe") return async () => [];
      if (key === "$executeRaw" || key === "$executeRawUnsafe") return async () => 0;
      if (key.startsWith("$")) return async () => undefined;
      return model(key);
    },
  },
);

// ------------------------------------------------------------------ sessions

export const TEST_EMAIL = "smoke.user@indefine.test";

export function activeSession(overrides: Partial<Session["user"]> = {}): Session {
  return {
    expires: new Date(Date.now() + 3_600_000).toISOString(),
    user: {
      id: "user-smoke-1",
      name: "Smoke User",
      email: TEST_EMAIL,
      image: null,
      role: "EMPLOYEE",
      active: true,
      department: "GENERAL",
      level: "EXECUTIVE",
      ...overrides,
    },
  };
}

// ------------------------------------------------------------------ assertions

/** Resolves when `fn` throws the redirect sentinel; returns its target. */
export async function redirectTarget(fn: () => unknown): Promise<string> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error("expected a redirect, but the component rendered");
}

/** Server-renders an element tree (async server components included) to HTML. */
export async function renderHtml(el: ReactElement): Promise<string> {
  if (!isValidElement(el)) throw new Error("not a React element");
  const errors: unknown[] = [];
  const stream = await renderToReadableStream(el, { onError: (e) => void errors.push(e) });
  await stream.allReady;
  const html = await new Response(stream).text();
  if (errors.length) throw errors[0];
  return html;
}
