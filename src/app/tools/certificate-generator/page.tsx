import Link from "next/link";
import { History, FileText, ShieldCheck } from "lucide-react";
import { pickerTemplates } from "@/lib/certificates/registry";

export const dynamic = "force-dynamic";

export default function FormatPicker() {
  const isProd = process.env.NODE_ENV === "production";
  // In production show only enabled (verifier-passed + human-signed) templates (§3.2).
  const templates = pickerTemplates(isProd);

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-[10.5px] font-extrabold tracking-[0.14em] text-ink-faint uppercase">Tools · Certification generator</p>
          <h1 className="font-display font-extrabold text-3xl sm:text-[34px] tracking-[-0.03em] mt-1">Choose a format</h1>
          <p className="text-ink-mute text-[15px] mt-1.5 max-w-2xl">
            The 12 official ICAI illustrative formats. Pick one, fill the variable fields, preview, and download a Word document.
          </p>
        </div>
        <Link
          href="/tools/certificate-generator/history"
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-full border border-border bg-card text-sm font-semibold text-ink-soft hover:bg-muted transition"
        >
          <History className="w-4 h-4" />
          History
        </Link>
      </div>

      <div className="rounded-2xl bg-brand-50 border border-brand-100 px-4 py-3 mb-6 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-brand-600 mt-0.5 shrink-0" />
        <p className="text-[13px] text-brand-800 leading-relaxed">
          These are ICAI illustrative formats. The fixed legal wording is locked and verified verbatim against the ICAI
          guidebook — you fill only the variable fields. You remain professionally responsible for every certificate you issue.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {templates.map((t) => (
          <Link
            key={t.id}
            href={`/tools/certificate-generator/${t.id}`}
            className="group bg-card border border-border rounded-[18px] p-5 shadow-lift hover:-translate-y-0.5 transition block"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl bg-brand-50 text-brand-700 grid place-items-center font-display font-extrabold text-sm uppercase">
                {t.romanNo}
              </span>
              <FileText className="w-4 h-4 text-ink-faint group-hover:text-brand-500 transition ml-auto" />
            </div>
            <div className="font-semibold text-[15px] leading-snug text-ink">{t.title}</div>
            <div className="mt-3 text-[11px] font-bold text-ink-faint">v{t.version}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
