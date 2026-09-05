"use client";

import { useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { Video, Users, Check } from "lucide-react";

interface UserLite {
  id: string;
  name: string | null;
  email: string;
}

const NEW_FOLDER = "__new__";

export default function ScheduleLiveForm({
  users,
  organizers,
  currentUserId,
  existingFolders,
  action,
  defaultStart,
}: {
  users: UserLite[];
  /** Users who connected Microsoft 365 at /connect (hold a refresh token) — the only valid hosts. */
  organizers: UserLite[];
  currentUserId: string;
  /** Course folders already present under the L&D root. */
  existingFolders: string[];
  action: (formData: FormData) => Promise<void>;
  defaultStart: string;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const allOn = users.length > 0 && selected.size === users.length;
  // When folders exist, default to picking one; otherwise straight to free text.
  const [folderChoice, setFolderChoice] = useState<string>(
    existingFolders.length > 0 ? existingFolders[0] : NEW_FOLDER
  );
  const creatingFolder = folderChoice === NEW_FOLDER;
  const [repeat, setRepeat] = useState<string>("none");

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () =>
    setSelected(allOn ? new Set() : new Set(users.map((u) => u.id)));

  return (
    <form action={action} className="space-y-5">
      {/* Selected attendees travel with the form as repeated hidden fields. */}
      {[...selected].map((id) => (
        <input key={id} type="hidden" name="attendeeIds" value={id} />
      ))}

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
            Session title
          </span>
          <input
            name="title"
            required
            placeholder="e.g. GST amendments — live walkthrough"
            className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
            Course / folder name
          </span>
          {existingFolders.length > 0 && (
            <select
              value={folderChoice}
              onChange={(e) => setFolderChoice(e.target.value)}
              // The select carries courseTitle when an existing folder is
              // picked; the text input takes over for a new folder.
              name={creatingFolder ? undefined : "courseTitle"}
              className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
            >
              {existingFolders.map((f) => (
                <option key={f} value={f}>
                  📁 {f}
                </option>
              ))}
              <option value={NEW_FOLDER}>➕ New folder…</option>
            </select>
          )}
          {creatingFolder && (
            <input
              name="courseTitle"
              required
              placeholder="e.g. GST 2026"
              className={`w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition ${
                existingFolders.length > 0 ? "mt-2" : ""
              }`}
            />
          )}
          <span className="block text-xs text-ink-faint mt-1">
            The recording is saved to a folder with this name under L&amp;D.
          </span>
        </label>
      </div>

      <label className="block sm:max-w-sm">
        <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
          Parent folder{" "}
          <span className="text-ink-faint font-semibold normal-case tracking-normal">(optional)</span>
        </span>
        <input
          name="folderParent"
          list="ld-parent-folders"
          placeholder="e.g. Accounting"
          className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
        />
        <datalist id="ld-parent-folders">
          {existingFolders.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <span className="block text-xs text-ink-faint mt-1">
          Nest the session folder inside this one: L&amp;D / {"{parent}"} / {"{course}"}. Leave blank for the L&amp;D root.
        </span>
      </label>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
          Description <span className="text-ink-faint font-semibold normal-case tracking-normal">(optional)</span>
        </span>
        <textarea
          name="description"
          rows={2}
          placeholder="What will you cover? Shown in the calendar invite."
          className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
            Starts (IST)
          </span>
          <input
            type="datetime-local"
            name="startLocal"
            required
            defaultValue={defaultStart}
            className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          />
        </label>

        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
            Duration
          </span>
          <select
            name="durationMin"
            defaultValue="60"
            className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          >
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
            <option value="120">2 hours</option>
          </select>
        </label>
      </div>

      <label className="block">
        <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
          Organizer (host)
        </span>
        <select
          name="organizerId"
          defaultValue={currentUserId}
          className="w-full sm:max-w-sm bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
        >
          {organizers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
              {u.id === currentUserId ? " (you)" : ""}
            </option>
          ))}
        </select>
        <span className="block text-xs text-ink-faint mt-1">
          The meeting is created on their calendar — they host it, can end it
          for everyone, and the recording is saved (and pulled) via their
          account. Only people who&apos;ve signed in to the LMS can be picked.
        </span>
      </label>

      {/* Recurrence */}
      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
            Repeat
          </span>
          <select
            name="repeat"
            defaultValue={repeat}
            onChange={(e) => setRepeat(e.target.value)}
            className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
          >
            <option value="none">Doesn&apos;t repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </label>
        {repeat !== "none" && (
          <label className="block">
            <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
              Number of sessions
            </span>
            <input
              type="number"
              name="occurrences"
              min={1}
              max={12}
              defaultValue={4}
              className="w-full bg-white border border-border rounded-xl px-3 py-2.5 text-base font-medium focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
            />
            <span className="block text-xs text-ink-faint mt-1">
              Creates this many separate sessions, each {repeat === "weekly" ? "a week" : "a day"} apart.
            </span>
          </label>
        )}
      </div>

      {/* Materials */}
      <label className="block">
        <span className="block text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute mb-1.5">
          Materials{" "}
          <span className="text-ink-faint font-semibold normal-case tracking-normal">
            (optional — PDF / slides / docs)
          </span>
        </span>
        <input
          type="file"
          name="materials"
          multiple
          accept=".pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.txt,.png,.jpg,.jpeg"
          className="w-full text-sm file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:bg-brand-50 file:text-brand-700 file:font-semibold file:cursor-pointer border border-border rounded-xl px-3 py-2 bg-white"
        />
        <span className="block text-xs text-ink-faint mt-1">
          Uploaded into the L&amp;D / {"{"}folder{"}"} folder in OneDrive alongside the recording.
        </span>
      </label>

      {/* Attendees */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] uppercase tracking-[0.12em] font-extrabold text-ink-mute inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            Attendees
            <span className="text-ink-faint font-bold normal-case tracking-normal">
              · {selected.size} selected
            </span>
          </span>
          <button
            type="button"
            onClick={toggleAll}
            className="text-xs font-bold text-brand-600 hover:text-brand-700 transition"
          >
            {allOn ? "Clear all" : "Select everyone"}
          </button>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {users.map((u) => {
            const on = selected.has(u.id);
            return (
              <button
                type="button"
                key={u.id}
                onClick={() => toggle(u.id)}
                className={`flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition ${
                  on
                    ? "border-brand-500 bg-brand-50"
                    : "border-border bg-white hover:bg-muted/50"
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-md grid place-items-center shrink-0 border transition ${
                    on ? "bg-brand-500 border-brand-500 text-white" : "border-ink-faint"
                  }`}
                >
                  {on && <Check className="w-3.5 h-3.5" />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold truncate">
                    {u.name ?? u.email}
                  </span>
                  <span className="block text-[11px] text-ink-faint truncate">
                    {u.email}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3 pt-1">
        <SubmitButton
          savingLabel="Scheduling…"
          savedLabel="Scheduled"
          className="px-6 py-3 rounded-xl bg-brand-500 hover:bg-brand-600 text-white font-bold shadow-pop"
        >
          <Video className="w-4 h-4" />
          Schedule Teams session
        </SubmitButton>
        <span className="text-xs text-ink-faint">
          Attendees get the Teams invite by email.
        </span>
      </div>
    </form>
  );
}
