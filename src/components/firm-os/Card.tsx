// Card (padding 24), Section (a titled region, 32 below it) and SectionTitle (the shared h2).
import { card, cx, sectionGap, sectionTitle } from "@/components/ui";

type Tag = "div" | "section" | "article" | "aside" | "form";

export function Card({
  as: As = "div",
  className = "",
  children,
  ...rest
}: { as?: Tag; className?: string; children: React.ReactNode } & Omit<React.HTMLAttributes<HTMLElement>, "className" | "children">) {
  return (
    <As className={cx(card, className)} {...rest}>
      {children}
    </As>
  );
}

export function SectionTitle({ id, as: As = "h2", className = "", children }: { id?: string; as?: "h2" | "h3" | "dt"; className?: string; children: React.ReactNode }) {
  return (
    <As id={id} className={cx(sectionTitle, className)}>
      {children}
    </As>
  );
}

/**
 * A page region with its title: `<section aria-labelledby>` + SectionTitle. `card` frames it as a
 * card; otherwise it holds its own cards or a table. `last` drops the 32 px gap below it.
 */
export function Section({
  id,
  title,
  card: framed = false,
  last = false,
  className = "",
  children,
}: {
  id: string;
  title: React.ReactNode;
  card?: boolean;
  last?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={cx(framed && card, !last && sectionGap, className) || undefined}>
      <SectionTitle id={id}>{title}</SectionTitle>
      {children}
    </section>
  );
}
