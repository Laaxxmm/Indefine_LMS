import { firmOsLayout } from "@/app/workspace/ModuleLayout";

export const dynamic = "force-dynamic";

// /admin/firm-os/cycle-time is a Firm OS page: closed while FIRM_OS_ENABLED is off (the dashboard says
// why). Workspace settings stays open so the rollout can be prepared before the switch goes on.
export default firmOsLayout();
