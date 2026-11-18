// The page header every Firm OS page opens with: an optional back link to the parent page, the
// eyebrow (where you are), the title, an optional lead sentence and meta line, and one slot on the
// right for the page's single primary action (or its status chips). Type and spacing from ui.ts.
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cx, eyebrow as eyebrowText, focusRing, headerGap, lead as leadText, pageTitle } from "@/components/ui";

/** Back link to the parent page (arrow + the parent's own title, top left). */
export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className={`inline-flex items-center gap-2 text-sm font-semibold text-ink-mute hover:text-ink transition mb-4 rounded ${focusRing}`}>
      <ArrowLeft className="w-4 h-4" aria-hidden="true" /> {children}
    </Link>
  );
}

export function PageHeader({
  back,
  eyebrow,
  title,
  lead,
  meta,
  action,
  titleId,
  className = "",
}: {
  /** An id on the title, for a region of the page that the title names (aria-labelledby). */
  titleId?: string;
  back?: { href: string; label: React.ReactNode };
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** One or two sentences under the title: what the page is for. */
  lead?: React.ReactNode;
  /** A line of facts under the title (service · period · dates), tabular numerals. */
  meta?: React.ReactNode;
  /** The page's one primary action, or its status chips. Wraps under the title on a phone. */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <>
      {back && <BackLink href={back.href}>{back.label}</BackLink>}
      <div className={cx(headerGap, "flex items-start justify-between gap-4 flex-wrap", className)}>
        <div className="min-w-0 max-w-full">
          {eyebrow && <p className={`${eyebrowText} mb-2`}>{eyebrow}</p>}
          <h1 id={titleId} className={`${pageTitle} break-words`}>
            {title}
          </h1>
          {lead && <p className={`${leadText} mt-2`}>{lead}</p>}
          {meta && <p className="text-[13px] leading-5 text-ink-mute mt-2 tabular-nums">{meta}</p>}
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
    </>
  );
}
