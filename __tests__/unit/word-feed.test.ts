import { describe, expect, it } from "vitest";
import { renderWordFeed } from "@/features/words/feed";

describe("word RSS feed", () => {
  it("escapes editorial text and URLs without allowing CDATA to break the document", () => {
    const feed = renderWordFeed({
      baseUrl: "https://example.com/?a=1&b=2",
      siteBrand: "Milk & Henny <Words>",
      posts: [
        {
          slug: "hello-world",
          title: "A ]]> title & more",
          subtitle: '<script>alert("no")</script>',
          updatedAt: "2026-08-30T12:00:00.000Z",
        },
      ],
    });

    expect(feed).not.toContain("<![CDATA[");
    expect(feed).toContain("A ]]&gt; title &amp; more");
    expect(feed).toContain("&lt;script&gt;alert(&quot;no&quot;)&lt;/script&gt;");
    expect(feed).toContain("https://example.com/?a=1&amp;b=2/feed.xml");
  });

  it("omits an invalid publication date instead of emitting Invalid Date", () => {
    const feed = renderWordFeed({
      baseUrl: "https://example.com",
      siteBrand: "Words",
      posts: [{ slug: "bad-date", title: "Bad date", updatedAt: "not-a-date" }],
    });

    expect(feed).not.toContain("Invalid Date");
    expect(feed).not.toContain("<pubDate>");
  });
});
