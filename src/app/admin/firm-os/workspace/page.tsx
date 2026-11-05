import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { isAdmin } from "@/lib/access";
import { prisma } from "@/lib/prisma";
import { btnGhost, card, field } from "@/components/ui";
import { eyebrow, focusRing, sectionTitle, tableWrap } from "@/app/agents/parts";
import {
  loadPerson,
  loadRoleDefaults,
  peopleWithOwnSettings,
  personAccessNotes,
  roleAccessNotes,
  searchPeople,
  type AdminWorkspaceDb,
  type PersonRow,
} from "@/lib/workspace/admin";
import { ALWAYS_ON, BUILT_IN_FOCUS, BUILT_IN_ROLE_MODULES, FIRM_ROLES, ROLE_LABELS, isFirmRole, moduleLabel } from "@/lib/workspace/registry";
import { PersonForm, RoleDefaultForm } from "./WorkspaceForms";

export const dynamic = "force-dynamic";

// Firm OS · workspace settings: which modules each role sees by default, and per person (their own
// list, focus mode, companion extension). A switched-on module never grants access the role does
// not have. Every save is confirmed with a change list first and recorded as an AuditEvent.

const pill = `shrink-0 whitespace-nowrap px-3.5 py-2 rounded-full text-sm font-semibold text-ink-mute hover:text-ink hover:bg-muted transition ${focusRing}`;
// NavLink's active style (src/components/NavLink.tsx navActive). Written out because a value
// exported from a "use client" module is a client reference inside a server component.
const navActive = "bg-brand-50 text-brand-600 hover:bg-brand-50 hover:text-brand-600";

/** `current`: "page" for the view the person is on; "true" for the selected role inside it. */
function Pill({ href, current, children }: { href: string; current: false | "page" | "true"; children: React.ReactNode }) {
  return (
    <Link href={href} aria-current={current || undefined} className={current ? `${pill} ${navActive}` : pill}>
      {children}
    </Link>
  );
}

const peopleHref = (q: string, user?: string) => {
  const sp = new URLSearchParams({ view: "people" });
  if (q) sp.set("q", q);
  if (user) sp.set("user", user);
  return `/admin/firm-os/workspace?${sp.toString()}`;
};

function PeopleList({ rows, q, selected, caption, title }: { rows: PersonRow[]; q: string; selected: string | undefined; caption: string; title?: string }) {
  // The heading sits above the list's container, as the section titles over tables on /agents do.
  return (
    <section aria-label={title ? undefined : caption} className="mb-6">
      {title && <h2 className={sectionTitle}>{title}</h2>}
      <div className={tableWrap}>
      <ul aria-label={caption} className="divide-y divide-border">
      {rows.map((p) => (
        <li key={p.id} className={`px-5 py-3 flex items-center justify-between gap-4 flex-wrap ${p.id === selected ? "bg-muted/60" : ""}`}>
          <div className="min-w-0">
            <p className="text-[13.5px] font-semibold">
              {p.name}
              {!p.active && <span className="ml-2 text-[11.5px] text-ink-mute font-normal">inactive</span>}
            </p>
            <p className="text-[12px] text-ink-mute break-all">
              {p.email} · {p.roleLabel} · {p.modulesFrom === "user" ? "own modules" : `${p.roleLabel} default modules`} · focus {p.focusMode ? "on" : "off"}
              {p.companionEnabled ? " · companion allowed" : ""}
            </p>
          </div>
          <Link
            href={peopleHref(q, p.id)}
            aria-current={p.id === selected ? "true" : undefined}
            aria-label={`${p.id === selected ? "Editing" : "Edit"} workspace for ${p.name}`}
            className={`${btnGhost} ${focusRing}`}
          >
            {p.id === selected ? "Editing" : "Edit"}
          </Link>
        </li>
      ))}
      </ul>
      </div>
    </section>
  );
}

export default async function WorkspaceSettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!isAdmin(session.user)) redirect("/dashboard");

  const sp = await searchParams;
  const db = prisma as unknown as AdminWorkspaceDb;
  const view = sp.view === "people" ? "people" : "roles";
  const q = (sp.q ?? "").trim().slice(0, 100);
  const role = isFirmRole(sp.role) ? sp.role : "staff";

  let body: React.ReactNode;
  if (view === "roles") {
    const roles = await loadRoleDefaults(db);
    const r = roles.find((x) => x.role === role)!;
    body = (
      <>
        <nav aria-label="Roles" className="flex items-center gap-1 mb-4 max-w-full overflow-x-auto">
          {FIRM_ROLES.map((x) => (
            <Pill key={x} href={`/admin/firm-os/workspace?role=${x}`} current={x === role && "true"}>
              {ROLE_LABELS[x]}
            </Pill>
          ))}
        </nav>
        <section aria-labelledby="role-default" className={card}>
          <h2 id="role-default" className={sectionTitle}>
            {r.label} default
          </h2>
          <p className="text-[13px] text-ink-mute mb-4">
            {r.from === "role" ? `Saved${r.updatedAt ? ` on ${r.updatedAt}` : ""}.` : "Built-in default; nothing saved for this role yet."} Applies to everyone in the {r.label} role who
            has no setting of their own. Now on: {r.modules.map(moduleLabel).join(", ") || "nothing"}.
          </p>
          <RoleDefaultForm
            key={`${r.role}-${r.modules.join()}-${r.focusMode}`}
            role={r.role}
            label={r.label}
            modules={r.modules}
            focusMode={r.focusMode}
            builtIn={[...BUILT_IN_ROLE_MODULES[r.role]]}
            builtInFocus={BUILT_IN_FOCUS[r.role]}
            alwaysOn={[...ALWAYS_ON[r.role]]}
            notes={roleAccessNotes(r.role)}
          />
        </section>
      </>
    );
  } else {
    const [found, custom, person] = await Promise.all([
      q ? searchPeople(db, q) : Promise.resolve([]),
      q ? Promise.resolve([]) : peopleWithOwnSettings(db),
      sp.user ? loadPerson(db, sp.user) : Promise.resolve(null),
    ]);
    body = (
      <>
        <form method="GET" className={`${card} mb-6 flex flex-wrap items-end gap-4`}>
          <input type="hidden" name="view" value="people" />
          <label htmlFor="ws-q" className="text-sm flex-1 min-w-56">
            <span className="block text-ink-mute mb-1">Search people by name or email</span>
            <input id="ws-q" type="search" name="q" defaultValue={q} maxLength={100} autoComplete="off" className={`${field} ${focusRing}`} />
          </label>
          <button type="submit" className={`${btnGhost} ${focusRing}`}>
            Search
          </button>
        </form>

        {q ? (
          found.length ? (
            <PeopleList rows={found} q={q} selected={sp.user} caption={`People matching ${q}`} />
          ) : (
            <p className="text-[13px] text-ink-mute mb-6" role="status">
              No one matches &ldquo;{q}&rdquo;. Check the spelling, or search by email.
            </p>
          )
        ) : custom.length ? (
          <PeopleList rows={custom} q={q} selected={sp.user} caption="People with their own settings" title="People with their own settings" />
        ) : (
          <p className="text-[13px] text-ink-mute mb-6">Everyone follows their role default. Search for a person to give them their own settings.</p>
        )}

        {sp.user && !person && (
          <p className="rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-[13px] mb-6" role="status">
            That person was not found. Search again and pick them from the list.
          </p>
        )}
        {person && (
          <section aria-labelledby="person" className={card}>
            <h2 id="person" className={sectionTitle}>
              {person.name}
            </h2>
            <p className="text-[13px] text-ink-mute mb-4 break-all">
              {person.email} · {person.roleLabel}
              {person.active ? "" : " · inactive"} · can open now: {person.effective.map(moduleLabel).join(", ") || "nothing"}
              {person.updatedAt ? ` · last changed ${person.updatedAt}` : ""}
            </p>
            <PersonForm
              key={`${person.id}-${JSON.stringify(person.setting)}`}
              userId={person.id}
              name={person.name}
              setting={person.setting}
              roleDefault={person.roleDefault}
              alwaysOn={person.alwaysOn}
              notes={personAccessNotes(person)}
            />
          </section>
        )}
      </>
    );
  }

  return (
    <main className="min-h-screen px-6 py-10 max-w-6xl mx-auto">
      <div className="mb-6 flex items-end justify-between flex-wrap gap-4">
        <div>
          <p className={`${eyebrow} mb-1.5`}>Admin · Firm OS</p>
          <h1 className="font-display text-[32px] font-extrabold tracking-[-0.02em] leading-none">Workspace settings</h1>
          <p className="text-sm text-ink-mute mt-2 max-w-2xl">
            Choose which modules each role sees, and change them for one person when needed. Switching a module on never gives access a role does not
            already have.
          </p>
        </div>
        <Link
          href="/admin"
          className={`text-sm text-ink-mute hover:text-ink inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white hover:bg-muted border border-border shadow-soft transition shrink-0 ${focusRing}`}
        >
          ← Admin
        </Link>
      </div>

      <nav aria-label="Workspace settings" className="flex items-center gap-1 mb-6 max-w-full overflow-x-auto">
        <Pill href="/admin/firm-os/workspace" current={view === "roles" && "page"}>
          Role defaults
        </Pill>
        <Pill href="/admin/firm-os/workspace?view=people" current={view === "people" && "page"}>
          People
        </Pill>
      </nav>

      {body}
    </main>
  );
}
