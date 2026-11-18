import { moduleLayout } from "@/app/workspace/ModuleLayout";

export const dynamic = "force-dynamic";

// /quiz belongs to the Learning workspace module: signed in, and only while
// the module is on for the person. The pages keep their own guards.
export default moduleLayout("learning");
