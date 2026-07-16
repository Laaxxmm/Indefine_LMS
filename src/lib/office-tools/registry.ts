// Single source of truth for the Office Tools suite — powers the landing grid,
// route slugs, and audit-log labels. Ported from the original dashboard's tool list.

export type ToolCategory = "Legal" | "Tax" | "Financial";
export type ToolFormat = "docx" | "xlsx";

export type ToolMeta = {
  id: string; // route slug + audit id
  title: string;
  category: ToolCategory;
  blurb: string;
  icon: string; // lucide-react icon name
  accent: string;
  format: ToolFormat;
  live: boolean; // false => shown as "Coming soon"
};

export const OFFICE_TOOLS: ToolMeta[] = [
  {
    id: "rental",
    title: "Rental Agreement",
    category: "Legal",
    blurb: "Generate a formatted rental / lease agreement with owner, tenant, rent, deposit and term details.",
    icon: "Home",
    accent: "#5B4BE6",
    format: "docx",
    live: true,
  },
  {
    id: "mou",
    title: "MOU Generator",
    category: "Legal",
    blurb: "Memorandum of Understanding between two parties — scope, roles, IP, governance and signatures.",
    icon: "Handshake",
    accent: "#5B4BE6",
    format: "docx",
    live: true,
  },
  {
    id: "partnership",
    title: "Partnership Deed",
    category: "Legal",
    blurb: "Partnership deed with partners, capital contribution and profit-sharing (must total 100%).",
    icon: "Users",
    accent: "#5B4BE6",
    format: "docx",
    live: true,
  },
  {
    id: "trust",
    title: "Trust Deed",
    category: "Legal",
    blurb: "Charitable trust deed — authors, trustees, objects and witnesses, on stamp paper.",
    icon: "Landmark",
    accent: "#5B4BE6",
    format: "docx",
    live: true,
  },
  {
    id: "llp",
    title: "LLP Agreement",
    category: "Legal",
    blurb: "Limited Liability Partnership agreement with partners, contribution and business terms.",
    icon: "Building2",
    accent: "#5B4BE6",
    format: "docx",
    live: true,
  },
  {
    id: "gstr3b",
    title: "GSTR-3B Processor",
    category: "Tax",
    blurb: "Upload GSTR-3B return PDFs and extract the figures into a consolidated Excel workbook.",
    icon: "FileSpreadsheet",
    accent: "#e84a8a",
    format: "xlsx",
    live: true,
  },
  {
    id: "tds-challan",
    title: "TDS Challan Processor",
    category: "Tax",
    blurb: "Upload TDS challan PDFs and extract them into an Excel sheet with a pivot summary.",
    icon: "Receipt",
    accent: "#e84a8a",
    format: "xlsx",
    live: true,
  },
  {
    id: "director-report",
    title: "Director's Report",
    category: "Financial",
    blurb: "Generate a company Director's Report — financials, directors, board meetings and committees.",
    icon: "ScrollText",
    accent: "#17b978",
    format: "docx",
    live: true,
  },
];

export const toolById = (id: string): ToolMeta | undefined => OFFICE_TOOLS.find((t) => t.id === id);
