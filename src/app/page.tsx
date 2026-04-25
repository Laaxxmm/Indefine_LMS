import { auth, signIn } from "@/lib/auth";
import { redirect } from "next/navigation";

export default async function Home() {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <main className="min-h-screen flex items-center justify-center px-6">
      <div className="max-w-md w-full bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur">
        <h1 className="text-3xl font-bold mb-2">Indefine LMS</h1>
        <p className="text-white/70 mb-8">
          Sign in with your Microsoft 365 account to access your learning modules.
        </p>
        <form
          action={async () => {
            "use server";
            await signIn("microsoft-entra-id", { redirectTo: "/dashboard" });
          }}
        >
          <button
            type="submit"
            className="w-full bg-brand-500 hover:bg-brand-600 transition rounded-lg py-3 font-semibold"
          >
            Sign in with Microsoft
          </button>
        </form>
      </div>
    </main>
  );
}
