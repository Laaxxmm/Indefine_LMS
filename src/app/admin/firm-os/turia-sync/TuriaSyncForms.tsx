"use client";

// Client controls for /admin/firm-os/turia-sync: Sync now, the people and client picks, and the
// rule form. Each calls one /api/firm-os/turia-sync route with call() (src/components/ui.ts), shows
// the route's sentence on failure and refreshes the page on success. Every save is audited there.
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/firm-os";
import { call, errorText, field, labelText } from "@/components/ui";

function useAction() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  async function run(url: string, body: unknown) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const r = await call(url, body);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    if (typeof r.data.notice === "string") setNotice(r.data.notice);
    router.refresh();
    return true;
  }
  return { busy, error, notice, run };
}

function Feedback({ error, notice }: { error: string | null; notice?: string | null }) {
  if (error)
    return (
      <p role="alert" className={`${errorText} mt-2`}>
        {error}
      </p>
    );
  return notice ? (
    <p role="status" className="text-[13px] leading-5 text-ink-mute mt-2">
      {notice}
    </p>
  ) : null;
}

export function SyncNowButton({ disabled }: { disabled: boolean }) {
  const { busy, error, notice, run } = useAction();
  return (
    <div className="flex flex-col items-end max-w-sm">
      <Button variant="primary" busy={busy} busyLabel="Reading Turia…" disabled={disabled} onClick={() => run("/api/firm-os/turia-sync/run", {})}>
        Sync now
      </Button>
      <Feedback error={error} notice={notice} />
    </div>
  );
}

export function PersonPick({ turiaUserId, turiaName, userId, users }: { turiaUserId: string; turiaName: string; userId: string | null; users: { id: string; name: string }[] }) {
  const id = useId();
  const { busy, error, run } = useAction();
  const [value, setValue] = useState(userId ?? "");
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Firm user for {turiaName}
        </label>
        <select id={id} className={`${field} w-56`} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Match automatically</option>
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <Button size="sm" busy={busy} onClick={() => run("/api/firm-os/turia-sync/people", { turiaUserId, userId: value || null })}>
          Save
        </Button>
      </div>
      <Feedback error={error} />
    </div>
  );
}

export function ClientPick({ clientKey, turiaName, lmsClientId, status, clients }: { clientKey: string; turiaName: string; lmsClientId: string | null; status: string; clients: { id: string; name: string }[] }) {
  const id = useId();
  const { busy, error, run } = useAction();
  const [value, setValue] = useState(status === "ignored" ? "ignore" : status === "manual" && lmsClientId ? lmsClientId : "");
  const save = () => {
    if (value === "ignore") return run("/api/firm-os/turia-sync/clients", { key: clientKey, action: "ignore" });
    if (!value) return run("/api/firm-os/turia-sync/clients", { key: clientKey, action: "auto" });
    return run("/api/firm-os/turia-sync/clients", { key: clientKey, action: "link", lmsClientId: value });
  };
  return (
    <div>
      <div className="flex items-center gap-2">
        <label htmlFor={id} className="sr-only">
          Client for {turiaName}
        </label>
        <select id={id} className={`${field} w-64`} value={value} onChange={(e) => setValue(e.target.value)}>
          <option value="">Match automatically</option>
          <option value="ignore">Ignore this Turia client</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <Button size="sm" busy={busy} onClick={save}>
          Save
        </Button>
      </div>
      <Feedback error={error} />
    </div>
  );
}

export type RuleFormValue = {
  id?: string;
  position: number;
  label: string;
  department: string | null;
  namePattern: string;
  service: string;
  title: string;
  frequency: string;
  useAgent: boolean;
  calendarRuleId: string | null;
  active: boolean;
};

export function RuleForm({ rule, services, frequencies }: { rule: RuleFormValue; services: { value: string; label: string }[]; frequencies: { value: string; label: string }[] }) {
  const uid = useId();
  const { busy, error, run } = useAction();
  const [f, setF] = useState(rule);
  const text = (k: "label" | "namePattern" | "title") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const nullable = (k: "department" | "calendarRuleId") => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value || null });
  const fieldId = (k: string) => `${uid}-${k}`;
  const save = () => run("/api/firm-os/turia-sync/rules", { ...f, position: Number(f.position) || 1 });
  return (
    <div className="grid gap-4 sm:grid-cols-2 mt-4">
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("label")} className={labelText}>
          Rule name
        </label>
        <input id={fieldId("label")} className={field} value={f.label} onChange={text("label")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("position")} className={labelText}>
          Order (lower numbers are checked first)
        </label>
        <input id={fieldId("position")} type="number" min={1} className={field} value={f.position} onChange={(e) => setF({ ...f, position: Number(e.target.value) })} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("name")} className={labelText}>
          Words in the Turia task name (| between choices, + for words that must all appear)
        </label>
        <input id={fieldId("name")} className={field} value={f.namePattern} onChange={text("namePattern")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("dept")} className={labelText}>
          Words in the Turia department (leave empty for any)
        </label>
        <input id={fieldId("dept")} className={field} value={f.department ?? ""} onChange={nullable("department")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("service")} className={labelText}>
          Firm OS service
        </label>
        <select id={fieldId("service")} className={field} value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>
          {services.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("title")} className={labelText}>
          Job title
        </label>
        <input id={fieldId("title")} className={field} value={f.title} onChange={text("title")} />
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("freq")} className={labelText}>
          How often
        </label>
        <select id={fieldId("freq")} className={field} value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })}>
          {frequencies.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor={fieldId("cal")} className={labelText}>
          Statutory calendar rule (for the statutory due date; optional)
        </label>
        <input id={fieldId("cal")} className={field} value={f.calendarRuleId ?? ""} onChange={nullable("calendarRuleId")} />
      </div>
      <div className="flex flex-wrap items-center gap-6 sm:col-span-2">
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.useAgent} onChange={(e) => setF({ ...f, useAgent: e.target.checked })} />
          Use the service&apos;s agent
        </label>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />
          Rule is on
        </label>
        <Button busy={busy} onClick={save}>
          {f.id ? "Save rule" : "Add rule"}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Feedback error={error} />
      </div>
    </div>
  );
}
