// CA-firm taxonomy helpers — labels, ordering, grouping.

import type { EmployeeLevel, Department } from "@prisma/client";

// Canonical levels exposed to admins. Legacy values kept in DB but hidden
// in dropdowns. Order goes junior → senior.
export const ACTIVE_LEVELS: EmployeeLevel[] = [
  "ARTICLE",
  "EXECUTIVE",
  "SENIOR_EXECUTIVE",
  "ASSISTANT_MANAGER",
  "MANAGER",
  "SENIOR_MANAGER",
  "PARTNER",
];

// Friendly label for any level — including legacy ones that may still be
// stored against existing users.
export function levelLabel(level: EmployeeLevel): string {
  switch (level) {
    case "ARTICLE":
      return "Article";
    case "EXECUTIVE":
      return "Executive";
    case "SENIOR_EXECUTIVE":
      return "Senior Executive";
    case "ASSISTANT_MANAGER":
      return "Assistant Manager";
    case "MANAGER":
      return "Manager";
    case "SENIOR_MANAGER":
      return "Senior Manager";
    case "PARTNER":
      return "Partner";
    case "TRAINEE":
      return "Trainee (legacy)";
    case "ASSOCIATE":
      return "Associate (legacy)";
    case "SENIOR":
      return "Senior (legacy)";
    case "LEAD":
      return "Lead (legacy)";
  }
}

export const DEPARTMENTS: Department[] = [
  "AUDIT",
  "TAX",
  "ACCOUNTS",
  "ROC",
  "TECH",
  "ADMIN",
  "GENERAL",
];

export function departmentLabel(d: Department): string {
  switch (d) {
    case "AUDIT":
      return "Audit";
    case "TAX":
      return "Tax";
    case "ACCOUNTS":
      return "Accounts";
    case "ROC":
      return "ROC";
    case "TECH":
      return "Tech";
    case "ADMIN":
      return "Admin / Ops";
    case "GENERAL":
      return "General";
  }
}

export function departmentColor(d: Department): {
  bg: string;
  fg: string;
} {
  switch (d) {
    case "AUDIT":
      return { bg: "bg-brand-50", fg: "text-brand-700" };
    case "TAX":
      return { bg: "bg-emerald-50", fg: "text-emerald-700" };
    case "ACCOUNTS":
      return { bg: "bg-amber-50", fg: "text-amber-700" };
    case "ROC":
      return { bg: "bg-violet-50", fg: "text-violet-700" };
    case "TECH":
      return { bg: "bg-sky-50", fg: "text-sky-700" };
    case "ADMIN":
      return { bg: "bg-rose-50", fg: "text-rose-700" };
    case "GENERAL":
      return { bg: "bg-muted", fg: "text-ink-mute" };
  }
}
