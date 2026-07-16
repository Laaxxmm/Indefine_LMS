import Link from "next/link";
import { FileBadge, ArrowRight, BookText, Wrench } from "lucide-react";

export const dynamic = "force-dynamic";

// Tools index — card grid.
const TOOLS = [
  {
    href: "/tools/certificate-generator",
    title: "Certification generator",
    tag: "ICAI · Chartered Accountants",
    blurb:
      "Produce ICAI certificates from the 12 official illustrative formats — guided form, live preview, and a Word download with a full audit trail.",
    icon: FileBadge,
    accent: "#5B4BE6",
  },
  {
    href: "/tools/sop-builder",
    title: "SOP Builder",
    tag: "AI-assisted · Standard Operating Procedures",
    blurb:
      "Turn a plain description into a polished, department-tagged SOP. AI refines your input into a brief you confirm, then generates a Word document saved to the L&D drive.",
    icon: BookText,
    accent: "#17b978",
  },
  {
    href: "/tools/office-tools",
    title: "Document & Tax Tools",
    tag: "Legal · Tax · Financial",
    blurb:
      "Generate rental agreements, MOUs, partnership, trust and LLP deeds as Word files, and extract GSTR-3B / TDS challan PDFs into Excel. Direct download, full audit trail.",
    icon: Wrench,
    accent: "#e84a8a",
  },
];

export default function ToolsIndex() {
  return (
    <div>
      <div className="mb-7">
        <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Workspace</p>
        <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Tools</h1>
        <p className="text-ink-mute text-[15px] mt-1.5 max-w-xl">
          Internal utilities for the team. More tools will appear here over time.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {TOOLS.map((tool) => (
          <Link
            key={tool.href}
            href={tool.href}
            className="group bg-card border border-border rounded-[20px] p-5 shadow-lift hover:-translate-y-0.5 transition block"
          >
            <div className="h-1 -mx-5 -mt-5 mb-4 rounded-t-[20px]" style={{ background: tool.accent }} />
            <div
              className="w-12 h-12 rounded-[14px] grid place-items-center mb-4"
              style={{ background: `${tool.accent}18`, color: tool.accent }}
            >
              <tool.icon className="w-6 h-6" />
            </div>
            <div className="text-[10.5px] font-extrabold tracking-[0.1em] text-ink-faint uppercase">{tool.tag}</div>
            <div className="font-display font-bold text-xl mt-0.5 mb-2 leading-tight">{tool.title}</div>
            <p className="text-[13.5px] text-ink-mute leading-relaxed">{tool.blurb}</p>
            <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: tool.accent }}>
              Open <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
