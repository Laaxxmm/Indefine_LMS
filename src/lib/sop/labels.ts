// Pure helpers safe to import from client components (no docx / node deps).
export function departmentLabel(dept: string): string {
  const map: Record<string, string> = { AUDIT: "Audit", TAX: "Tax", ACCOUNTS: "Accounts", ROC: "ROC", TECH: "Technology", ADMIN: "Admin", GENERAL: "General" };
  return map[dept] ?? dept;
}
