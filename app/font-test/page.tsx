import {
  Lora,
  Newsreader,
  Literata,
  Crimson_Pro,
  Fraunces,
  Source_Serif_4,
  Libre_Baskerville,
  Vollkorn,
  Alegreya,
  Cormorant_Garamond,
  Bitter,
} from "next/font/google";
import Link from "next/link";

const lora = Lora({ subsets: ["latin"], style: ["normal", "italic"] });
const newsreader = Newsreader({ subsets: ["latin"], style: ["normal", "italic"] });
const literata = Literata({ subsets: ["latin"], style: ["normal", "italic"] });
const sourceSerif = Source_Serif_4({ subsets: ["latin"], style: ["normal", "italic"] });
const crimsonPro = Crimson_Pro({ subsets: ["latin"], style: ["normal", "italic"] });
const fraunces = Fraunces({ subsets: ["latin"] });
const libreBaskerville = Libre_Baskerville({ subsets: ["latin"], weight: ["400", "700"], style: ["normal", "italic"] });
const vollkorn = Vollkorn({ subsets: ["latin"], style: ["normal", "italic"] });
const alegreya = Alegreya({ subsets: ["latin"], style: ["normal", "italic"] });
const cormorantGaramond = Cormorant_Garamond({ subsets: ["latin"], weight: ["400", "500", "600", "700"], style: ["normal", "italic"] });
const bitter = Bitter({ subsets: ["latin"], style: ["normal", "italic"] });

const SAMPLE_PROSE = `There's a particular hour in the evening — right after the sun dips but before the streetlights decide to care — when everything turns amber. That's the hour I write best. Not because inspiration strikes, but because the world finally shuts up long enough for me to hear my own thoughts.

I used to think good writing meant big words and bigger ideas. Turns out it's the opposite. The best sentences are the ones that feel like someone sitting across from you, saying something true over a warm drink. No performance. Just presence.

My grandmother had a phrase for it: *"Don't season what's already sweet."* She was talking about her pound cake, but she was also talking about everything else. The best things — the truest things — don't need decoration. They just need to be said clearly, by someone who means it.

So that's what this space is. No manifestos, no hot takes aged past their expiry. Just thoughts that kept me up, stories that stuck around, and the occasional recipe I refuse to let die with me.`;

const fonts = [
  {
    name: "Lora",
    tag: "current font — control",
    description: "Your current serif. Solid, readable, slightly academic.",
    font: lora,
  },
  {
    name: "Newsreader",
    tag: "editorial column",
    description: "Warm, old-school editorial quality. Like a thoughtful Sunday magazine column.",
    font: newsreader,
  },
  {
    name: "Literata",
    tag: "cozy reading nook",
    description: "Modern serif with soft, rounded details. Designed for long-form screen reading.",
    font: literata,
  },
  {
    name: "Source Serif 4",
    tag: "quiet confidence",
    description: "Clean, journalistic, warm. Like a well-designed independent magazine.",
    font: sourceSerif,
  },
  {
    name: "Crimson Pro",
    tag: "literary warmth",
    description: "Classic proportions with a gentle, inviting weight. Like a beautifully typeset essay.",
    font: crimsonPro,
  },
  {
    name: "Fraunces",
    tag: "milk & henny signature",
    description: "Soft, wonky, artisanal. The most personality — could feel like *your* font.",
    font: fraunces,
  },
  {
    name: "Libre Baskerville",
    tag: "classic british editorial",
    description: "A faithful Baskerville revival. Dignified, warm, deeply readable. The font equivalent of a leather armchair.",
    font: libreBaskerville,
  },
  {
    name: "Vollkorn",
    tag: "full-bodied",
    description: "German for 'wholegrain'. Sturdy, warm, slightly quirky serifs. Designed for bread-and-butter body text.",
    font: vollkorn,
  },
  {
    name: "Alegreya",
    tag: "the storyteller",
    description: "Dynamic, calligraphic energy. Designed for long literary texts. Has rhythm — your eyes want to keep moving.",
    font: alegreya,
  },
  {
    name: "Cormorant Garamond",
    tag: "elegant whisper",
    description: "Tall, graceful Garamond with delicate thin strokes. Beautiful but light — whispers rather than speaks.",
    font: cormorantGaramond,
  },
  {
    name: "Bitter",
    tag: "screen-native slab",
    description: "Slab serif built specifically for screens. Friendly, unpretentious, excellent at small sizes. The workhorse option.",
    font: bitter,
  },
] as const;

export default function FontTestPage() {
  return (
    <main className="min-h-screen py-16 px-6">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <header className="mb-16">
          <Link
            href="/"
            className="font-mono text-sm tracking-tight opacity-60 hover:opacity-100 transition-opacity duration-300"
          >
            &larr; back home
          </Link>
          <h1 className="font-mono text-2xl font-bold tracking-tighter mt-6 mb-3">
            font tasting
          </h1>
          <p className="font-mono text-sm tracking-tight opacity-60 leading-relaxed max-w-lg">
            same prose, eleven fonts. scroll through and pick the one that feels
            like home. the first one is your current font for reference.
          </p>
        </header>

        {/* Font samples */}
        <div className="space-y-20">
          {fonts.map(({ name, tag, description, font }, i) => (
            <section key={name}>
              {/* Label */}
              <div className="mb-6 pb-4 border-b" style={{ borderColor: "var(--stone-200)" }}>
                <div className="flex items-baseline gap-3 flex-wrap">
                  <span className="font-mono text-xs tracking-wide uppercase opacity-40">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <h2 className="font-mono text-lg font-bold tracking-tighter">
                    {name.toLowerCase()}
                  </h2>
                  <span
                    className="font-mono text-xs tracking-tight px-2 py-0.5 rounded-full"
                    style={{
                      background: i === 0 ? "var(--prose-hashtag)" : "var(--stone-200)",
                      color: i === 0 ? "var(--background)" : "var(--foreground)",
                      opacity: i === 0 ? 1 : 0.7,
                    }}
                  >
                    {tag}
                  </span>
                </div>
                <p className="font-mono text-xs tracking-tight opacity-50 mt-2">
                  {description}
                </p>
              </div>

              {/* Title sample */}
              <h3
                className={`${font.className} text-2xl font-bold mb-6`}
                style={{ color: "var(--prose-heading)", lineHeight: 1.3 }}
              >
                Don&rsquo;t Season What&rsquo;s Already Sweet
              </h3>

              {/* Prose sample */}
              <div
                className={font.className}
                style={{
                  fontSize: "1.125rem",
                  lineHeight: 1.8,
                  color: "var(--prose-body)",
                }}
              >
                {SAMPLE_PROSE.split("\n\n").map((paragraph, pi) => (
                  <p key={pi} style={{ marginBottom: "1.5em" }}>
                    {paragraph.split(/(\*[^*]+\*)/).map((segment, si) =>
                      segment.startsWith("*") && segment.endsWith("*") ? (
                        <em key={si}>{segment.slice(1, -1)}</em>
                      ) : (
                        <span key={si}>{segment}</span>
                      )
                    )}
                  </p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <footer className="mt-20 pt-8 border-t" style={{ borderColor: "var(--stone-200)" }}>
          <p className="font-mono text-xs tracking-tight opacity-40 text-center">
            pick your favourite and let me know — i&rsquo;ll swap it in everywhere
          </p>
        </footer>
      </div>
    </main>
  );
}
