import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { canUseOfficeTools } from "@/lib/office-tools/access";
import { OFFICE_TOOLS, type ToolCategory } from "@/lib/office-tools/registry";
import { Home, Handshake, Users, Landmark, Building2, FileSpreadsheet, Receipt, ScrollText, ArrowRight, Clock, History } from "lucide-react";

export const dynamic = "force-dynamic";

const ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  Home, Handshake, Users, Landmark, Building2, FileSpreadsheet, Receipt, ScrollText,
};

const CATEGORY_ORDER: ToolCategory[] = ["Legal", "Tax", "Financial"];
const CATEGORY_BADGE: Record<ToolCategory, string> = {
  Legal: "bg-brand-50 text-brand-700",
  Tax: "bg-rose-50 text-rose-600",
  Financial: "bg-emerald-50 text-emerald-700",
};

export default async function OfficeToolsIndex() {
  const session = await auth();
  if (!session?.user) redirect("/");
  if (!canUseOfficeTools(session.user)) redirect("/dashboard");

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-7">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Tools · Office Utilities</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Document &amp; Tax Tools</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
            Generate legal documents and process tax return PDFs. Each output downloads directly — nothing is stored — and every run is logged for audit.
          </p>
        </div>
        <Link href="/tools/office-tools/history" className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card text-sm font-semibold text-ink-soft hover:bg-muted transition shrink-0">
          <History className="w-4 h-4" /> History
        </Link>
      </div>

      {CATEGORY_ORDER.map((cat) => {
        const tools = OFFICE_TOOLS.filter((t) => t.category === cat);
        if (!tools.length) return null;
        return (
          <div key={cat} className="mb-8">
            <h2 className="text-[11px] font-extrabold tracking-[0.14em] text-ink-faint uppercase mb-3">{cat}</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {tools.map((tool) => {
                const Icon = ICONS[tool.icon] ?? Home;
                const inner = (
                  <>
                    <div className="h-1 -mx-5 -mt-5 mb-4 rounded-t-[20px]" style={{ background: tool.accent }} />
                    <div className="w-12 h-12 rounded-[14px] grid place-items-center mb-4" style={{ background: `${tool.accent}18`, color: tool.accent }}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-[9.5px] font-extrabold tracking-wide uppercase px-1.5 py-0.5 rounded-full ${CATEGORY_BADGE[tool.category]}`}>{tool.format.toUpperCase()}</span>
                      {!tool.live && <span className="inline-flex items-center gap-1 text-[9.5px] font-extrabold tracking-wide uppercase px-1.5 py-0.5 rounded-full bg-muted text-ink-faint"><Clock className="w-3 h-3" /> Soon</span>}
                    </div>
                    <div className="font-display font-bold text-lg leading-tight">{tool.title}</div>
                    <p className="text-[13px] text-ink-mute leading-relaxed mt-1.5">{tool.blurb}</p>
                    {tool.live && (
                      <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: tool.accent }}>
                        Open <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
                      </div>
                    )}
                  </>
                );
                return tool.live ? (
                  <Link key={tool.id} href={`/tools/office-tools/${tool.id}`} className="group bg-card border border-border rounded-[20px] p-5 shadow-lift hover:-translate-y-0.5 transition block">
                    {inner}
                  </Link>
                ) : (
                  <div key={tool.id} className="bg-card border border-border rounded-[20px] p-5 shadow-lift opacity-70">{inner}</div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
