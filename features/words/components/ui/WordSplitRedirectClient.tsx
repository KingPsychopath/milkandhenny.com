import { useEffect } from "react";
import { Link } from "@tanstack/react-router";

type Props = {
  slug: string;
};

export function WordSplitRedirectClient({ slug }: Props) {
  useEffect(() => {
    const next = `/vault/${encodeURIComponent(slug)}${window.location.search}`;
    window.location.replace(next);
  }, [slug]);

  return (
    <div className="border theme-border rounded-md p-5 space-y-2">
      <p className="font-mono text-xs tracking-wide uppercase theme-muted">redirecting</p>
      <p className="font-serif text-lg leading-relaxed text-foreground">
        This page moved to the private vault route.
      </p>
      <Link
        to="/vault/$slug"
        params={{ slug }}
        search={{ share: undefined }}
        className="font-mono text-xs underline"
      >
        open private page
      </Link>
    </div>
  );
}
