import Link from "next/link";

type PostListItemProps = {
  slug: string;
  title: string;
  date: string;
  subtitle?: string;
  readingTime: number;
  featured?: boolean;
};

/** Format a date string into "7 Feb 2026" */
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Shared post list item used on the homepage and blog page */
export function PostListItem({ slug, title, date, subtitle, readingTime, featured }: PostListItemProps) {
  return (
    <article
      className="group relative"
      {...(featured ? { "aria-label": "Featured post" } : {})}
    >
      {featured && (
        <span
          className="absolute -left-3 top-6 bottom-6 w-0.5 bg-amber-600/60 dark:bg-amber-500/50 rounded-full"
          aria-hidden
        />
      )}
      <Link
        href={`/blog/${slug}`}
        className="block py-6 border-b theme-border-faint hover:theme-border-strong transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1 sm:gap-4">
          <h2 className="font-serif text-xl sm:text-2xl text-foreground group-hover:opacity-70 transition-opacity leading-snug">
            {title}
          </h2>
          <span className="font-mono text-xs theme-muted shrink-0 tabular-nums whitespace-nowrap">
            {readingTime} min · {formatDate(date)}
          </span>
        </div>
        {subtitle && (
          <p className="mt-2 font-serif theme-subtle text-[0.95rem] leading-relaxed">
            {subtitle}
          </p>
        )}
      </Link>
    </article>
  );
}

export type { PostListItemProps };
