"use client";

import { useEffect } from "react";
import Link from "next/link";

type Props = {
  to: string;
};

export function WordSplitRedirectClient({ to }: Props) {
  useEffect(() => {
    const next = `${to}${window.location.search}`;
    window.location.replace(next);
  }, [to]);

  return (
    <div className="border theme-border rounded-md p-5 space-y-2">
      <p className="font-mono text-xs tracking-wide uppercase theme-muted">redirecting</p>
      <p className="font-serif text-lg leading-relaxed text-foreground">
        This page moved to the private vault route.
      </p>
      <Link href={to} className="font-mono text-xs underline">
        open private page
      </Link>
    </div>
  );
}
