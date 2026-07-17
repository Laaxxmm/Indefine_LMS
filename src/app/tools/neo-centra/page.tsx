import { redirect } from "next/navigation";

// Neo Centra's home is the Incentives race — that's what directors track.
export default function NeoCentraHome() {
  redirect("/tools/neo-centra/incentives");
}
