// Growth Wizard — constants and shared helpers.

export const STRENGTHS = [
  { id: "analytical", label: "Analytical thinking", emoji: "🧠" },
  { id: "audit-precision", label: "Audit precision", emoji: "🔬" },
  { id: "client-empathy", label: "Client empathy", emoji: "💗" },
  { id: "communication", label: "Communication", emoji: "💬" },
  { id: "creativity", label: "Creativity", emoji: "🎨" },
  { id: "critical-thinking", label: "Critical thinking", emoji: "🤔" },
  { id: "decision-making", label: "Decision making", emoji: "⚖️" },
  { id: "detail-oriented", label: "Detail-oriented", emoji: "🔍" },
  { id: "domain-expertise", label: "Domain expertise", emoji: "🎓" },
  { id: "writing", label: "Effective writing", emoji: "✍️" },
  { id: "focus", label: "Focus", emoji: "🎯" },
  { id: "initiative", label: "Initiative", emoji: "🚀" },
  { id: "integrity", label: "Integrity", emoji: "🛡️" },
  { id: "leadership", label: "Leadership", emoji: "🌟" },
  { id: "learning-agility", label: "Learning agility", emoji: "⚡" },
  { id: "mentoring", label: "Mentoring", emoji: "🤝" },
  { id: "negotiation", label: "Negotiation", emoji: "🎭" },
  { id: "operational", label: "Operational excellence", emoji: "⚙️" },
  { id: "patience", label: "Patience", emoji: "🌊" },
  { id: "presentation", label: "Presentation", emoji: "📊" },
  { id: "problem-solving", label: "Problem solving", emoji: "🧩" },
  { id: "relationship", label: "Relationship building", emoji: "🌐" },
  { id: "resilience", label: "Resilience", emoji: "💎" },
  { id: "teamwork", label: "Teamwork", emoji: "🫂" },
  { id: "technical-depth", label: "Technical depth", emoji: "🔧" },
  { id: "time-management", label: "Time management", emoji: "⏱️" },
] as const;

export const STRENGTH_PICK_COUNT = 5;

export type WizardStep =
  | "intro"
  | "strengths"
  | "aspiration"
  | "quests"
  | "initiative"
  | "review";

export const STEP_ORDER: WizardStep[] = [
  "intro",
  "strengths",
  "aspiration",
  "quests",
  "initiative",
  "review",
];

export const STEP_META: Record<WizardStep, { label: string; idx: number }> = {
  intro: { label: "Welcome", idx: 0 },
  strengths: { label: "Strengths", idx: 1 },
  aspiration: { label: "Aspiration", idx: 2 },
  quests: { label: "Quests", idx: 3 },
  initiative: { label: "Initiative", idx: 4 },
  review: { label: "Lock it in", idx: 5 },
};
