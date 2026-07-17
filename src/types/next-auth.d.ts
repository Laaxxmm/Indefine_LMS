import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: "EMPLOYEE" | "ADMIN";
      active: boolean;
      department: string;
      level: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: "EMPLOYEE" | "ADMIN";
    active?: boolean;
  }
}
