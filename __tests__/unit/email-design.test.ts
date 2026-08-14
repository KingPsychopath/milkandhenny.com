import { describe, expect, it } from "vitest";

import { renderBrandedEmail } from "@/lib/shared/email-design";

describe("branded email design", () => {
  it("uses one accessible, email-safe layout", () => {
    const html = renderBrandedEmail({
      origin: "https://milkandhenny.com/",
      label: "private working copy",
      title: "Your pitch is ready",
      meta: "Saved just now",
      contentHtml: "<p>Keep editing.</p>",
      action: { label: "open your pitch", url: "https://milkandhenny.com/things/pitches/one" },
      note: "Keep this link private.",
    });

    expect(html).toContain('role="presentation"');
    expect(html).toContain('src="https://milkandhenny.com/email-logo.png?v=2"');
    expect(html).toContain('width="112" height="112"');
    expect(html).toContain('alt="milk &amp; henny"');
    expect(html).toContain("open your pitch →");
    expect(html).not.toContain(".svg");
  });

  it("escapes customer-controlled headings and links", () => {
    const html = renderBrandedEmail({
      origin: "https://milkandhenny.com",
      label: "event <update>",
      title: 'Doors "open" & ready',
      contentHtml: "<p>Trusted template content.</p>",
      action: { label: "open", url: 'https://example.com/?a=1&b="2"' },
    });

    expect(html).toContain("event &lt;update&gt;");
    expect(html).toContain("Doors &quot;open&quot; &amp; ready");
    expect(html).toContain('href="https://example.com/?a=1&amp;b=&quot;2&quot;"');
  });
});
