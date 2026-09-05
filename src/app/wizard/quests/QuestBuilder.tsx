"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus, Trash2, Sparkles } from "lucide-react";

interface Milestone {
  quarter: number;
  title: string;
}
interface Quest {
  id?: string;
  title: string;
  why: string;
  description: string;
  weight: number;
  milestones: Milestone[];
}

const TEMPLATES: Quest[] = [
  {
    title: "Master the Audit Standards module",
    why: "Foundation for senior-level audit work",
    description: "",
    weight: 15,
    milestones: [
      { quarter: 1, title: "Finish SA-300 series videos" },
      { quarter: 2, title: "Pass all module quizzes 80%+" },
      { quarter: 3, title: "Apply on a live engagement" },
      { quarter: 4, title: "Share learnings in team session" },
    ],
  },
  {
    title: "Mentor 2 junior associates",
    why: "Build leadership skills and lift the team",
    description: "",
    weight: 10,
    milestones: [
      { quarter: 1, title: "Pair with first junior" },
      { quarter: 2, title: "Run weekly 1:1s" },
      { quarter: 3, title: "Take on second mentee" },
      { quarter: 4, title: "Manager feedback collected" },
    ],
  },
  {
    title: "Lead one cross-team initiative",
    why: "Stretch into ownership and influence",
    description: "",
    weight: 15,
    milestones: [
      { quarter: 1, title: "Pitch the idea, get buy-in" },
      { quarter: 2, title: "Form working group" },
      { quarter: 3, title: "First milestone shipped" },
      { quarter: 4, title: "Full initiative delivered" },
    ],
  },
];

const blankQuest = (): Quest => ({
  title: "",
  why: "",
  description: "",
  weight: 10,
  milestones: [
    { quarter: 1, title: "" },
    { quarter: 2, title: "" },
    { quarter: 3, title: "" },
    { quarter: 4, title: "" },
  ],
});

export default function QuestBuilder({
  initial,
  action,
}: {
  initial: Quest[];
  action: (formData: FormData) => Promise<void>;
}) {
  const [quests, setQuests] = useState<Quest[]>(
    initial.length > 0 ? initial : [blankQuest()]
  );

  const update = (i: number, q: Quest) =>
    setQuests((arr) => arr.map((x, idx) => (idx === i ? q : x)));
  const remove = (i: number) =>
    setQuests((arr) => arr.filter((_, idx) => idx !== i));
  const add = () =>
    setQuests((arr) => (arr.length >= 5 ? arr : [...arr, blankQuest()]));
  const applyTemplate = (t: Quest) =>
    setQuests((arr) => (arr.length >= 5 ? arr : [...arr, { ...t, milestones: t.milestones.map((m) => ({ ...m })) }]));

  const validCount = quests.filter((q) => q.title.trim()).length;

  return (
    <div>
      <div className="space-y-4 mb-6">
        {quests.map((q, i) => (
          <QuestCard
            key={i}
            quest={q}
            index={i}
            onChange={(qx) => update(i, qx)}
            onRemove={() => remove(i)}
            removable={quests.length > 1}
          />
        ))}
      </div>

      {quests.length < 5 && (
        <div className="rounded-2xl bg-white border border-dashed border-border p-5 mb-6">
          <p className="text-sm font-semibold mb-3">Add another quest</p>
          <div className="flex flex-wrap gap-2 mb-3">
            <button
              onClick={add}
              type="button"
              className="text-xs px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 font-medium inline-flex items-center gap-1.5 hover:bg-brand-100 transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Blank quest
            </button>
            {TEMPLATES.map((t) => (
              <button
                key={t.title}
                onClick={() => applyTemplate(t)}
                type="button"
                className="text-xs px-3 py-1.5 rounded-lg bg-white border border-border hover:border-brand-200 hover:bg-brand-50 inline-flex items-center gap-1.5 transition"
              >
                <Sparkles className="w-3.5 h-3.5 text-accent-gold" />
                {t.title}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-faint">Up to 5 quests · Templates pre-fill milestones for you</p>
        </div>
      )}

      <form action={action} className="flex justify-between items-center">
        <Link
          href="/wizard/aspiration"
          className="px-4 py-2.5 rounded-xl bg-white hover:bg-muted border border-border shadow-soft text-sm font-medium inline-flex items-center gap-2 transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <input type="hidden" name="quests" value={JSON.stringify(quests)} />
        <button
          type="submit"
          disabled={validCount === 0}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-brand-500 to-accent-violet text-white font-semibold shadow-pop hover:opacity-95 disabled:opacity-40 disabled:cursor-not-allowed transition"
        >
          Continue ({validCount} quest{validCount === 1 ? "" : "s"})
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}

function QuestCard({
  quest,
  index,
  onChange,
  onRemove,
  removable,
}: {
  quest: Quest;
  index: number;
  onChange: (q: Quest) => void;
  onRemove: () => void;
  removable: boolean;
}) {
  const set = <K extends keyof Quest>(k: K, v: Quest[K]) =>
    onChange({ ...quest, [k]: v });
  const setMilestone = (q: number, title: string) => {
    onChange({
      ...quest,
      milestones: quest.milestones.map((m) =>
        m.quarter === q ? { ...m, title } : m
      ),
    });
  };

  return (
    <div className="rounded-2xl bg-white border border-border shadow-soft p-5">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-brand-50 text-brand-700 flex items-center justify-center text-sm font-bold">
            {index + 1}
          </div>
          <p className="text-xs uppercase tracking-wider font-bold text-ink-faint">
            Quest {index + 1}
          </p>
        </div>
        {removable && (
          <button
            type="button"
            onClick={onRemove}
            className="text-ink-faint hover:text-rose-600 transition"
            title="Remove quest"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      <input
        value={quest.title}
        onChange={(e) => set("title", e.target.value)}
        placeholder="Quest title (e.g. Master the Audit Standards module)"
        className="w-full font-display font-bold text-lg bg-transparent border-0 border-b-2 border-border focus:border-brand-500 px-0 py-2 mb-3 focus:outline-none transition"
      />

      <input
        value={quest.why}
        onChange={(e) => set("why", e.target.value)}
        placeholder="Why this matters to you..."
        className="w-full text-sm bg-muted/50 border border-border rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-4 focus:ring-brand-500/15 focus:border-brand-500 transition"
      />

      <p className="text-xs uppercase tracking-wider font-bold text-ink-faint mb-2">
        Quarterly milestones
      </p>
      <div className="grid sm:grid-cols-2 gap-2 mb-4">
        {quest.milestones.map((m) => (
          <div key={m.quarter} className="flex items-center gap-2">
            <span className="text-[10px] font-bold w-7 h-7 rounded-md bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              Q{m.quarter}
            </span>
            <input
              value={m.title}
              onChange={(e) => setMilestone(m.quarter, e.target.value)}
              placeholder={`Q${m.quarter} milestone`}
              className="flex-1 text-sm bg-white border border-border rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500/15 focus:border-brand-500 transition"
            />
          </div>
        ))}
      </div>

      <div className="flex items-center gap-3">
        <label className="text-xs text-ink-mute font-medium">
          Weight: <span className="text-ink font-bold">{quest.weight}</span>
        </label>
        <input
          type="range"
          min={1}
          max={30}
          value={quest.weight}
          onChange={(e) => set("weight", Number(e.target.value))}
          className="flex-1 accent-brand-500"
        />
      </div>
    </div>
  );
}
