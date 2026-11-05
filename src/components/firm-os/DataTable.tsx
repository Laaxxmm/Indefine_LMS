// A data table: rounded card that scrolls sideways on its own (never the page), a caption for
// screen readers, column heads with scope="col", 44 px rows (ui.ts tr / td / tdNum). `sticky` keeps
// the head in view while a long table scrolls inside a 70vh box.
import { table, tableWrap, th, thead } from "@/components/ui";

export type Column = {
  label: React.ReactNode;
  /** Numbers and actions sit on the right. */
  align?: "left" | "right";
  /** A head that is only for screen readers (e.g. "Action"). */
  srOnly?: boolean;
  className?: string;
};

export function DataTable({
  caption,
  columns,
  sticky = false,
  className = "",
  children,
}: {
  caption: string;
  columns: Column[];
  sticky?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`${tableWrap} ${sticky ? "max-h-[70vh] overflow-y-auto" : ""} ${className}`}>
      <table className={table}>
        <caption className="sr-only">{caption}</caption>
        <thead className={thead}>
          <tr>
            {columns.map((c, i) => (
              <th key={i} scope="col" className={`${th} ${c.align === "right" ? "text-right" : ""} ${sticky ? "sticky top-0 z-10 bg-card" : ""} ${c.className ?? ""}`}>
                {c.srOnly ? <span className="sr-only">{c.label}</span> : c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
