"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Users, Check } from "lucide-react";

interface UserLite {
  id: string;
  name: string | null;
  email: string;
}

const NEW_FOLDER = "__new__";

// For a session that happened WITHOUT being scheduled in the LMS: record it
// after the fact and pull in the recording from its Teams/SharePoint link. No
// Teams meeting is created and no invite goes out — this only files the
// recording and allots it to the people who attended.
export default function AddPastSessionForm({
  users,
  existingFolders,
  action,
  defaultDate,
}: {
  users: UserLite[];
  existingFolders: string[];
  action: (formData: FormData) => Promise<void>;
  defaultDate: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allOn = users.length > 0 && selected.size === users.length;
  const [folderChoice, setFolderChoice] = useState<string>(
    existingFolders.length > 0 ? existingFolders[0] : NEW_FOLDER
  );
  const creatingFolder = folderChoice === NEW_FOLDER;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected(allOn ? new Set() : new Set(users.map((u) => u.id)));

  const label =
    "block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5";
  const input =
    "w-full px-3 py-2 rounded-xl border border-border bg-white text-sm";

  return (
    <form action={action} className="space-y-5">
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="attendeeIds" value={id} />
      ))}

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block sm:col-span-2">
          <span className={label}>Session title</span>
          <input name="title" required className={input} placeholder="e.g. GST Annual Return walkthrough" />
        </label>

        <label className="block">
          <span className={label}>Folder</span>
          <select
            className={input}
            value={folderChoice}
            onChange={(e) => setFolderChoice(e.target.value)}
          >
            {existingFolders.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
            <option value={NEW_FOLDER}>+ New folder…</option>
          </select>
          {!creatingFolder && <input type="hidden" name="courseTitle" value={folderChoice} />}
        </label>

        <label className="block">
          <span className={label}>{creatingFolder ? "New folder name" : "Parent folder (optional)"}</span>
          {creatingFolder ? (
            <input name="courseTitle" required className={input} placeholder="e.g. GST Training 2026" />
          ) : (
            <input name="folderParent" className={input} placeholder="e.g. Accounting" />
          )}
        </label>

        <label className="block">
          <span className={label}>Date held</span>
          <input type="date" name="heldOn" required defaultValue={defaultDate} className={input} />
        </label>

        <label className="block">
          <span className={label}>Duration (min)</span>
          <input type="number" name="durationMin" min={1} defaultValue={60} className={input} />
        </label>

        <label className="block sm:col-span-2">
          <span className={label}>Recording link</span>
          <input name="url" required className={input} placeholder="Paste the Teams recording / share link" />
          <span className="block text-[11px] text-ink-faint mt-1">
            Open the recording in Teams or SharePoint and copy its link — it carries the file id we need.
          </span>
        </label>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className={label + " mb-0"}>
            <Users className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
            Allot to ({selected.size})
          </span>
          <button type="button" onClick={toggleAll} className="text-xs font-bold text-brand-600 hover:underline">
            {allOn ? "Clear all" : "Select all"}
          </button>
        </div>
        <div className="rounded-xl border border-border divide-y divide-border max-h-56 overflow-y-auto">
          {users.map((u) => {
            const on = selected.has(u.id);
            return (
              <button
                type="button"
                key={u.id}
                onClick={() => toggle(u.id)}
                className="w-full px-3 py-2 flex items-center gap-2.5 text-left hover:bg-muted transition"
              >
                <span
                  className={`w-4 h-4 rounded border grid place-items-center shrink-0 ${
                    on ? "bg-brand-500 border-brand-500 text-white" : "border-border bg-white"
                  }`}
                >
                  {on && <Check className="w-3 h-3" />}
                </span>
                <span className="text-sm font-semibold truncate">{u.name ?? u.email}</span>
              </button>
            );
          })}
        </div>
      </div>

      <SubmitButton
        savingLabel="Uploading…"
        className="px-5 py-2.5 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold text-sm transition"
      >
        Add session &amp; pull recording
      </SubmitButton>
    </form>
  );
}
