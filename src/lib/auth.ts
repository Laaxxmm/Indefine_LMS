import NextAuth from "next-auth";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import { PrismaAdapter } from "@auth/prisma-adapter";
import { prisma } from "@/lib/prisma";

const adminEmails = (process.env.ADMIN_EMAILS ?? "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  providers: [
    MicrosoftEntraID({
      clientId: process.env.AUTH_MICROSOFT_ENTRA_ID_ID,
      clientSecret: process.env.AUTH_MICROSOFT_ENTRA_ID_SECRET,
      issuer: process.env.AUTH_MICROSOFT_ENTRA_ID_ISSUER,
      authorization: {
        params: {
          scope:
            "openid profile email offline_access User.Read Files.Read.All Files.ReadWrite.All Calendars.ReadWrite OnlineMeetings.ReadWrite OnlineMeetingTranscript.Read.All OnlineMeetingArtifact.Read.All",
        },
      },
      // Employees are pre-provisioned by the admin-triggered org sync
      // (users-sync.ts), which creates a User row with no linked Account
      // before that person ever signs in. Without this flag, NextAuth
      // refuses to link their first real sign-in to that row and throws
      // OAuthAccountNotLinked. Safe here because Microsoft Entra ID is the
      // ONLY provider and the only source of pre-created rows is this same
      // trusted tenant (via an admin-only sync) — there's no other provider
      // an attacker could use to plant a row with someone else's email first.
      allowDangerousEmailAccountLinking: true,
    }),
  ],
  pages: { signIn: "/" },
  callbacks: {
    async signIn({ user, account }) {
      // Promote configured admins on first login
      if (user.email && adminEmails.includes(user.email.toLowerCase())) {
        await prisma.user.update({
          where: { email: user.email },
          data: { role: "ADMIN" },
        }).catch(() => {});
      }
      // Keep the freshest Microsoft OAuth tokens on the Account row. Auth.js
      // only writes tokens when an account is FIRST linked, so without this a
      // re-login never refreshes the stored access/refresh token — meaning a
      // newly-granted Graph scope (or an expired token) never takes effect.
      // updateMany is a harmless no-op on the very first sign-in (the adapter
      // creates the row right after this callback) and refreshes the tokens on
      // every subsequent sign-in.
      if (account?.provider === "microsoft-entra-id") {
        await prisma.account
          .updateMany({
            where: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
            data: {
              access_token: account.access_token,
              refresh_token: account.refresh_token ?? undefined,
              expires_at:
                typeof account.expires_at === "number"
                  ? account.expires_at
                  : undefined,
              scope: account.scope,
              token_type: account.token_type,
              id_token: account.id_token,
            },
          })
          .catch(() => {});
      }
      return true;
    },
    async session({ session, user }) {
      if (session.user) {
        session.user.id = user.id;
        session.user.role = (user.role as "EMPLOYEE" | "ADMIN") ?? "EMPLOYEE";
        // `user` here is the full DB row (database session strategy); expose `active` and
        // `department` so the Tools access rules can gate on them (certificates/access.ts,
        // sop/access.ts — SOP editors are scoped to their own department).
        session.user.active = (user as { active?: boolean }).active ?? false;
        session.user.department = (user as { department?: string }).department ?? "GENERAL";
      }
      return session;
    },
  },
});
