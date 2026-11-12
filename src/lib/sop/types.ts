// Most sub-processes one SOP may have (each is its own AI call). Shared by server and client.
export const MAX_SUB_PROCESSES = 8;

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
  // The process map: the parts the work divides into, in order. Each is written out step by
  // step. Absent on briefs saved before the detailed format; the SOP is then one sub-process.
  subProcesses?: string[];
}

// Analyze step result — the guardrail. If not valid, `reason` explains why and no SOP is made.
export interface SopAnalysis {
  valid: boolean;
  reason?: string;
  brief?: SopBrief;
  // What the description leaves unsaid (which screen, who approves, what if it differs…).
  // The author answers before generating; the answers travel inside rawProcedure.
  questions?: string[];
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

// Detailed format: one physical action per step, with where it happens and what can differ.
export interface SopDetailStep {
  no: string; // "P01.3"
  role: string;
  action: string;
  system: string; // application / screen / menu path; "" for work done off-screen
  input: string;
  output: string;
  ifThen: string[]; // "If <what is different>, then <what to do>"
  control: string; // id in SopContent.controls ("C1" manual, "AC1" application) or ""
  screens?: SopScreen[]; // screenshots the author added under this step, in order
}
// A screenshot under a step: the SopImage row and the line printed under it.
export interface SopScreen {
  imageId: string;
  caption: string;
}
export interface SopSubProcess {
  code: string; // "P01"
  name: string;
  objective: string;
  owner: string;
  steps: SopDetailStep[];
}
export interface SopControl {
  id: string;
  type: "MANUAL" | "APPLICATION";
  description: string;
}
export interface SopRisk {
  risk: string;
  control: string;
  owner: string;
  frequency: string;
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
  // Detailed format (schemaVersion 2). Absent on older versions, which render from `procedure`.
  schemaVersion?: 2;
  preparedBy?: string;
  subProcesses?: SopSubProcess[];
  controls?: SopControl[];
  kpis?: string[];
  risks?: SopRisk[];
  openPoints?: string[]; // what the author still has to confirm
}
