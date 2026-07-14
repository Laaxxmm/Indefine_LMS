// The refined brief produced by the analyze/guardrail step and confirmed by the user.
export interface SopBrief {
  title: string;
  department: string; // Department enum value
  workCategory: string;
  objective: string;
  scope: string;
  keySteps: string[];
  rolesInvolved: string[];
  references: string[];
}

// Analyze step result — the guardrail. If not valid, `reason` explains why and no SOP is made.
export interface SopAnalysis {
  valid: boolean;
  reason?: string;
  brief?: SopBrief;
}

// The structured, generated SOP (stored as SopVersion.content Json and rendered to
// both the on-screen view and the .docx — no freeform HTML, so output stays controlled).
export interface SopDefinition {
  term: string;
  meaning: string;
}
export interface SopResponsibility {
  role: string;
  duty: string;
}
export interface SopStep {
  step: number;
  action: string;
  responsibility: string;
}
export interface SopContent {
  title: string;
  department: string;
  workCategory: string;
  effectiveDate: string; // DD/MM/YYYY
  revision: string; // "1.0"
  purpose: string;
  scope: string;
  definitions: SopDefinition[];
  responsibilities: SopResponsibility[];
  flowchart: string[]; // vertical flowchart step labels
  procedure: SopStep[];
  references: string[];
}
