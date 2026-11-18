"use client";

// Forms for /admin/firm-os/workspace: a role's default, and one person's own setting. Nothing is
// saved on the first click: "Review changes" shows the plain-English list of what will change
// (the same list the AuditEvent keeps), and "Confirm and save" sends it.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { btnGhost, btnPrimary, call, errorText, focusRing } from "@/components/ui";
import type { FirmRole } from "@/lib/rbac/policy";
import { FOLLOW_ROLE, roleDefaultChanges, userSettingChanges, type UserSettingInput } from "@/lib/workspace/changes";
import { MODULES, sortModules, type ModuleKey } from "@/lib/workspace/registry";
import { Button } from "@/components/firm-os";

/** Why switching a module on may not show it, per module (set by the page from the access rules). */
export type AccessNotes = Partial<Record<ModuleKey, string>>;

const sameList = (a: readonly ModuleKey[], b: readonly ModuleKey[]) => a.length === b.length && a.every((k) => b.includes(k));

function ModuleToggles({
  legend,
  selected,
  onToggle,
  disabled = false,
  alwaysOn,
  notes,
}: {
  legend: string;
  selected: readonly ModuleKey[];
  onToggle: (k: ModuleKey) => void;
  disabled?: boolean;
  alwaysOn: readonly ModuleKey[];
  notes: AccessNotes;
}) {
  const id = useId();
  return (
    <fieldset disabled={disabled} className="min-w-0">
      <legend className="text-[13px] font-semibold mb-2">{legend}</legend>
      <ul className="grid sm:grid-cols-2 gap-2">
        {MODULES.map((m) => {
          const locked = alwaysOn.includes(m.key);
          const note = locked ? "Always on for admins." : notes[m.key];
          return (
            <li key={m.key}>
              <label htmlFor={`${id}-${m.key}`} className={`flex items-start gap-3 rounded-lg border border-border px-3 py-3 h-full ${disabled || locked ? "bg-muted/60" : "bg-card hover:bg-muted/40 cursor-pointer"}`}>
                <input
                  id={`${id}-${m.key}`}
                  type="checkbox"
                  className={`mt-0.5 h-4 w-4 shrink-0 accent-brand-500 ${focusRing}`}
                  checked={selected.includes(m.key) || locked}
                  disabled={locked}
                  onChange={() => onToggle(m.key)}
                />
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold">{m.label}</span>
                  <span className="block text-[12px] text-ink-mute">{m.description}</span>
                  <span className="block text-[12px] text-ink-mute font-mono break-all">{m.routes.join(" ")}</span>
                  {note && <span className="block text-[12px] text-amber-800 mt-1">{note}</span>}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </fieldset>
  );
}

/** The confirm step: what will change, Back / Confirm and save. */
function ConfirmChanges({ changes, busy, onBack, onConfirm, who }: { changes: string[]; busy: boolean; onBack: () => void; onConfirm: () => void; who: string }) {
  const id = useId();
  return (
    <div role="group" aria-labelledby={`${id}-h`} className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 mt-6">
      <p id={`${id}-h`} className="text-[13px] font-semibold">
        Check before saving. This changes {who}:
      </p>
      <ul className="list-disc pl-6 mt-2 space-y-1 text-[13px] text-ink-soft">
        {changes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="text-[12px] text-ink-soft mt-2">It applies the next time they open a page. The change is recorded in the audit log.</p>
      <div className="flex items-center gap-2 justify-end mt-3 flex-wrap">
        <Button disabled={busy} onClick={onBack}>
          Cancel
        </Button>
        <Button variant="primary" busy={busy} busyLabel="Saving…" onClick={onConfirm}>
          Confirm and save
        </Button>
      </div>
    </div>
  );
}

function useSave() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(url: string, body: unknown, after: () => void) {
    setBusy(true);
    setError(null);
    setSaved(false);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    setSaved(true);
    after();
    router.refresh();
  }
  return { busy, error, saved, setSaved, save };
}

// ------------------------------------------------------------------ role default

export function RoleDefaultForm({
  role,
  label,
  modules,
  focusMode,
  builtIn,
  builtInFocus,
  alwaysOn,
  notes,
}: {
  role: FirmRole;
  label: string;
  modules: ModuleKey[];
  focusMode: boolean;
  builtIn: ModuleKey[];
  builtInFocus: boolean;
  alwaysOn: ModuleKey[];
  notes: AccessNotes;
}) {
  const id = useId();
  const [selected, setSelected] = useState<ModuleKey[]>(modules);
  const [focus, setFocus] = useState(focusMode);
  const [reviewing, setReviewing] = useState(false);
  const { busy, error, saved, setSaved, save } = useSave();
  const after = { modules: sortModules([...selected, ...alwaysOn]), focusMode: focus };
  const changes = roleDefaultChanges(role, { modules, focusMode }, after);
  const toggle = (k: ModuleKey) => {
    setSaved(false);
    setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : sortModules([...s, k])));
  };
  const isBuiltIn = sameList(after.modules, builtIn) && focus === builtInFocus;

  return (
    <div>
      <ModuleToggles legend={`Modules the ${label} role sees`} selected={selected} onToggle={toggle} disabled={reviewing} alwaysOn={alwaysOn} notes={notes} />
      <label htmlFor={`${id}-focus`} className="flex items-start gap-3 mt-4">
        <input
          id={`${id}-focus`}
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 accent-brand-500 ${focusRing}`}
          checked={focus}
          disabled={reviewing}
          onChange={(e) => {
            setSaved(false);
            setFocus(e.target.checked);
          }}
        />
        <span>
          <span className="block text-[13px] font-semibold">Focus mode</span>
          <span className="block text-[12px] text-ink-mute">Open on the next-task page, one task at a time.</span>
        </span>
      </label>

      {reviewing ? (
        <ConfirmChanges
          who={`the default for everyone in the ${label} role who has no setting of their own`}
          changes={changes}
          busy={busy}
          onBack={() => setReviewing(false)}
          onConfirm={() => save(`/api/firm-os/workspace/roles/${encodeURIComponent(role)}`, after, () => setReviewing(false))}
        />
      ) : (
        <div className="flex items-center gap-2 justify-end mt-6 flex-wrap">
          {saved && (
            <span role="status" className="text-[12px] text-emerald-800 mr-auto">
              Saved.
            </span>
          )}
          <button
            type="button"
            disabled={isBuiltIn}
            onClick={() => {
              setSaved(false);
              setSelected(builtIn);
              setFocus(builtInFocus);
            }}
            className={btnGhost}
          >
            Use built-in defaults
          </button>
          <button type="button" disabled={changes.length === 0} onClick={() => setReviewing(true)} className={btnPrimary}>
            Review changes
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`${errorText} mt-2 text-right`}>
          {error}
        </p>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ one person

type FocusChoice = "role" | "on" | "off";
const toChoice = (v: boolean | null): FocusChoice => (v === null ? "role" : v ? "on" : "off");
const fromChoice = (c: FocusChoice): boolean | null => (c === "role" ? null : c === "on");

export function PersonForm({
  userId,
  name,
  setting,
  roleDefault,
  alwaysOn,
  notes,
}: {
  userId: string;
  name: string;
  setting: UserSettingInput;
  roleDefault: { label: string; modules: ModuleKey[]; focusMode: boolean };
  alwaysOn: ModuleKey[];
  notes: AccessNotes;
}) {
  const id = useId();
  const [own, setOwn] = useState(setting.modules !== null);
  const [selected, setSelected] = useState<ModuleKey[]>(setting.modules ?? roleDefault.modules);
  const [focus, setFocus] = useState<FocusChoice>(toChoice(setting.focusMode));
  const [companion, setCompanion] = useState(setting.companionEnabled);
  const [reviewing, setReviewing] = useState(false);
  const { busy, error, saved, setSaved, save } = useSave();

  const after: UserSettingInput = { modules: own ? sortModules([...selected, ...alwaysOn]) : null, focusMode: fromChoice(focus), companionEnabled: companion };
  const changes = userSettingChanges(setting, after, roleDefault);
  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    setSaved(false);
    fn(v);
  };
  const toggle = edit((k: ModuleKey) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : sortModules([...s, k]))));
  const resetChanges = userSettingChanges(setting, FOLLOW_ROLE, roleDefault);

  function resetToRole() {
    setSaved(false);
    setOwn(false);
    setSelected(roleDefault.modules);
    setFocus("role");
    setCompanion(false);
    if (resetChanges.length) setReviewing(true);
  }

  const onOff = (b: boolean) => (b ? "on" : "off");
  return (
    <div>
      <label htmlFor={`${id}-own`} className="flex items-start gap-3 mb-3">
        <input
          id={`${id}-own`}
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 accent-brand-500 ${focusRing}`}
          checked={own}
          disabled={reviewing}
          onChange={(e) => edit(setOwn)(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] font-semibold">Give {name} their own list of modules</span>
          <span className="block text-[12px] text-ink-mute">Leave this off to follow the {roleDefault.label} default.</span>
        </span>
      </label>
      <ModuleToggles
        legend={own ? `Modules ${name} sees` : `Modules from the ${roleDefault.label} default`}
        selected={own ? selected : roleDefault.modules}
        onToggle={toggle}
        disabled={!own || reviewing}
        alwaysOn={alwaysOn}
        notes={notes}
      />

      <fieldset disabled={reviewing} className="mt-6">
        <legend className="text-[13px] font-semibold mb-2">Focus mode</legend>
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {(
            [
              ["role", `Follow the ${roleDefault.label} default (${onOff(roleDefault.focusMode)})`],
              ["on", "On"],
              ["off", "Off"],
            ] as const
          ).map(([value, text]) => (
            <label key={value} htmlFor={`${id}-f-${value}`} className="flex items-center gap-2 text-[13px]">
              <input
                id={`${id}-f-${value}`}
                type="radio"
                name={`${id}-focus`}
                value={value}
                checked={focus === value}
                onChange={() => edit(setFocus)(value)}
                className={`h-4 w-4 accent-brand-500 ${focusRing}`}
              />
              {text}
            </label>
          ))}
        </div>
      </fieldset>

      <label htmlFor={`${id}-companion`} className="flex items-start gap-3 mt-6">
        <input
          id={`${id}-companion`}
          type="checkbox"
          className={`mt-0.5 h-4 w-4 shrink-0 accent-brand-500 ${focusRing}`}
          checked={companion}
          disabled={reviewing}
          onChange={(e) => edit(setCompanion)(e.target.checked)}
        />
        <span>
          <span className="block text-[13px] font-semibold">Allow the companion extension</span>
          <span className="block text-[12px] text-ink-mute">The read-only side panel that shows the next task&apos;s steps beside the portal.</span>
        </span>
      </label>

      {reviewing ? (
        <ConfirmChanges who={name} changes={changes} busy={busy} onBack={() => setReviewing(false)} onConfirm={() => save(`/api/firm-os/workspace/users/${encodeURIComponent(userId)}`, after, () => setReviewing(false))} />
      ) : (
        <div className="flex items-center gap-2 justify-end mt-6 flex-wrap">
          {saved && (
            <span role="status" className="text-[12px] text-emerald-800 mr-auto">
              Saved.
            </span>
          )}
          <button type="button" disabled={resetChanges.length === 0 && changes.length === 0} onClick={resetToRole} className={btnGhost}>
            Reset to role default
          </button>
          <button type="button" disabled={changes.length === 0} onClick={() => setReviewing(true)} className={btnPrimary}>
            Review changes
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className={`${errorText} mt-2 text-right`}>
          {error}
        </p>
      )}
    </div>
  );
}
