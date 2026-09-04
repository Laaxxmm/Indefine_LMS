import type { Session } from "next-auth";
import { auth } from "@/lib/auth";
import { canUseWork, isWorkLead, type Actor } from "./core";

/** The tracker identity behind a session, or null when signed out or not on the list. */
export function actorFrom(session: Session | null): Actor | null {
  const email = session?.user?.email;
  if (!session?.user || !email || !canUseWork(email)) return null;
  return { id: session.user.id, email: email.toLowerCase(), name: session.user.name ?? email, isLead: isWorkLead(email) };
}

export async function currentActor(): Promise<Actor | null> {
  return actorFrom(await auth());
}
