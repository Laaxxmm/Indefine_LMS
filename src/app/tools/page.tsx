import Link from "next/link";
import { FileBadge, ArrowRight, BookText, Wrench, LayoutDashboard, Users, CalendarClock, Newspaper, UserPlus } from "lucide-react";
import { auth } from "@/lib/auth";
import { canUseNeoCentra } from "@/lib/neo-centra/access";
import { isModuleEnabled } from "@/lib/workspace/settings";

// "Open" text in each card's accent, darkened where the accent itself is below AA on white (mint
// 2.6:1, pink 3.6:1, orange 2.8:1, sky 2.8:1 → the -700 shade, 5.2:1+). The bar and icon keep the accent.
const AA_TEXT: Record<string, string> = { "#17b978": "#047857", "#e84a8a": "#be185d", "#f97316": "#c2410c", "#0ea5e9": "#0369a1" };

// Partners and managers only, appended like NEO_CENTRA: Firm OS plain-English onboarding, while the
// onboard module is on for them (its role rule, the Firm OS master switch and the workspace settings).
const FIRM_OS_ONBOARD = {
  href: "/onboard",
  title: "Onboard client (Firm OS)",
  tag: "Firm OS · Partners and managers",
  blurb:
    "Describe a new client in one sentence. Answer only what is missing, review the plan, then create the client record, Turia checklist, SharePoint site and the year's jobs in one go.",
  icon: UserPlus,
  accent: "#5B4BE6",
};

export const dynamic = "force-dynamic";

// Directors-only cockpit — appended to the grid only for directors.
const NEO_CENTRA = {
  href: "/tools/neo-centra/incentives",
  title: "Neo Centra",
  tag: "Directors · Incentive race",
  blurb:
    "The directors' cockpit — the four-bucket incentive race scored live from Turia.",
  icon: LayoutDashboard,
  accent: "#6d4be6",
};

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
  {
    href: "/tools/statutory-updates",
    title: "Statutory updates",
    tag: "Income Tax · GST · MCA · Labour · ICAI",
    blurb:
      "Every notification, circular and advisory the statutory portals posted, summarised and tagged Action / For information, one tab per law. Collected daily.",
    icon: Newspaper,
    accent: "#f97316",
  },
  {
    href: "/tools/client-ops",
    title: "Client ops",
    tag: "Hosting · Domains · Renewals",
    blurb:
      "Hosting and domain renewals for web clients — what expires when, what we bill for it, and a drafted reminder to send. Registry and certificate dates refresh themselves nightly.",
    icon: CalendarClock,
    accent: "#0ea5e9",
  },
  {
    href: "/clients",
    title: "Client onboarding",
    tag: "Clients · Jobs · Documents",
    blurb:
      "Onboard a client, file their documents into SharePoint under the client's folder, track jobs by FY and handler, and report on the client base.",
    icon: Users,
    accent: "#0ea5e9",
  },
];

export default async function ToolsIndex() {
  const session = await auth();
  const tools = [
    ...TOOLS,
    ...((await isModuleEnabled(session?.user, "onboard")) ? [FIRM_OS_ONBOARD] : []),
    ...(canUseNeoCentra(session?.user) ? [NEO_CENTRA] : []),
  ];
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
        {tools.map((tool) => (
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
            <div className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold" style={{ color: AA_TEXT[tool.accent.toLowerCase()] ?? tool.accent }}>
              Open <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
