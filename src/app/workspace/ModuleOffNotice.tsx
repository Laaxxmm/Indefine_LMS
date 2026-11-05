// The dashboard's explanation after requireModule() sent someone back from a switched-off module
// (/dashboard?module-off=<key>). Server component; renders nothing for a missing or unknown key.
// Wire-up (dashboard page): <ModuleOffNotice param={(await searchParams)["module-off"]} />
import { Alert } from "@/components/firm-os";
import { moduleOffNotice } from "@/lib/workspace/guard";

export function ModuleOffNotice({ param, className = "" }: { param: string | string[] | null | undefined; className?: string }) {
  const message = moduleOffNotice(param);
  if (!message) return null;
  return (
    <Alert tone="warning" className={className}>
      {message}
    </Alert>
  );
}
