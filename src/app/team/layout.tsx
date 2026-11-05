import { moduleLayout } from "@/app/workspace/ModuleLayout";

export const dynamic = "force-dynamic";

// /team belongs to the Leaderboard and Trajectory workspace module: signed in, and only while
// the module is on for the person. The pages keep their own guards.
export default moduleLayout("leaderboard");
