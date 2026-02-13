import Link from "next/link";

type Crumb = {
  label: string;
  href?: string;
};

type Props = {
  items: Crumb[];
};

/** Nav breadcrumbs. Last item is current page (no link). */
export function Breadcrumbs({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <nav aria-label="Breadcrumb" className="font-mono text-[11px] theme-muted tracking-wide">
      <ol className="flex flex-wrap items-center gap-x-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1;
          return (
            <li key={i} className="flex items-center gap-x-1.5">
              {i > 0 && <span className="theme-faint">/</span>}
              {isLast || !item.href ? (
                <span className={isLast ? "text-foreground" : ""}>{item.label}</span>
              ) : (
                <Link href={item.href} className="hover:text-foreground transition-colors">
                  {item.label}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
