import { Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import type { Mesh } from "three";

import "./PitchNightExperience.css";

const CHAPTERS = [
  {
    number: "01",
    eyebrow: "The Pitch Night",
    title: "Six slides. One unreasonable conviction.",
    body: "Make the deck here, then stand up and make us care. Pitch a product, a theory, a tiny revolution, or a plan that should never have left the group chat.",
    aside: "The room is kind. The timer is not.",
  },
  {
    number: "02",
    eyebrow: "The Spelling Bee",
    title: "Confidence meets the English language.",
    body: "Hear the word. Find the letters. Discover what pressure does to a perfectly ordinary vowel.",
    aside: "No autocorrect. No appeals to the audience.",
  },
  {
    number: "03",
    eyebrow: "The Board Games",
    title: "Low stakes. Deeply personal rivalries.",
    body: "Tables become little worlds. Learn something new, teach your favourite, or quietly reveal an alarming strategic side.",
    aside: "House rules are still rules.",
  },
  {
    number: "04",
    eyebrow: "The Apartment Life DJ Set",
    title: "We groove in the background.",
    body: "A live set for the part of the night where the chairs stop making sense. You better dance or else.",
    aside: "Apartment life, turned all the way up.",
  },
] as const;

export function PitchNightExperience({ ticketHref }: { ticketHref: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let disposed = false;
    let frame = 0;
    let cleanScroll: () => void = () => {};
    let cleanPointer: () => void = () => {};
    let cleanVisibility: () => void = () => {};

    void (async () => {
      try {
        const [THREE, gsapModule, scrollModule] = await Promise.all([
          import("three"),
          import("gsap"),
          import("gsap/ScrollTrigger"),
        ]);
        if (disposed) return;
        const gsap = gsapModule.gsap;
        const ScrollTrigger = scrollModule.ScrollTrigger;
        gsap.registerPlugin(ScrollTrigger);

        const styles = getComputedStyle(document.documentElement);
        const amber = styles.getPropertyValue("--pitch-night-amber").trim();
        const cream = styles.getPropertyValue("--pitch-night-cream").trim();
        const blue = styles.getPropertyValue("--pitch-night-blue").trim();
        const renderer = new THREE.WebGLRenderer({
          canvas,
          alpha: true,
          antialias: true,
          powerPreference: "high-performance",
        });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        renderer.setSize(innerWidth, innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.15;

        const scene = new THREE.Scene();
        const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
        camera.position.set(0, 0, 8);
        const world = new THREE.Group();
        scene.add(world);

        const core = new THREE.Mesh(
          new THREE.IcosahedronGeometry(1.55, 5),
          new THREE.MeshPhysicalMaterial({
            color: new THREE.Color(amber),
            metalness: 0.12,
            roughness: 0.16,
            transmission: 0.28,
            thickness: 1.8,
            clearcoat: 1,
            clearcoatRoughness: 0.08,
          }),
        );
        world.add(core);

        const wire = new THREE.Mesh(
          new THREE.IcosahedronGeometry(2.05, 2),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(cream),
            wireframe: true,
            transparent: true,
            opacity: 0.12,
          }),
        );
        world.add(wire);

        const ringMaterial = new THREE.MeshStandardMaterial({
          color: new THREE.Color(blue),
          metalness: 0.85,
          roughness: 0.28,
        });
        const rings: Mesh[] = [];
        for (let index = 0; index < 3; index += 1) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(2.7 + index * 0.55, 0.035 + index * 0.01, 12, 160),
            ringMaterial,
          );
          ring.rotation.set(index * 0.7 + 0.25, index * 0.55, index * 0.9);
          rings.push(ring);
          world.add(ring);
        }

        const starPositions = new Float32Array(1_200 * 3);
        for (let index = 0; index < starPositions.length; index += 3) {
          const radius = 4 + Math.random() * 9;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.acos(2 * Math.random() - 1);
          starPositions[index] = radius * Math.sin(phi) * Math.cos(theta);
          starPositions[index + 1] = radius * Math.sin(phi) * Math.sin(theta);
          starPositions[index + 2] = radius * Math.cos(phi);
        }
        const stars = new THREE.Points(
          new THREE.BufferGeometry().setAttribute(
            "position",
            new THREE.BufferAttribute(starPositions, 3),
          ),
          new THREE.PointsMaterial({
            color: new THREE.Color(cream),
            size: 0.025,
            transparent: true,
            opacity: 0.65,
          }),
        );
        scene.add(stars);
        scene.add(new THREE.AmbientLight(new THREE.Color(cream), 1.2));
        const key = new THREE.PointLight(new THREE.Color(amber), 55, 18);
        key.position.set(3, 4, 5);
        scene.add(key);
        const edge = new THREE.PointLight(new THREE.Color(blue), 40, 16);
        edge.position.set(-4, -2, 3);
        scene.add(edge);

        const pointer = { x: 0, y: 0 };
        const onPointer = (event: PointerEvent) => {
          pointer.x = event.clientX / innerWidth - 0.5;
          pointer.y = event.clientY / innerHeight - 0.5;
        };
        const onResize = () => {
          camera.aspect = innerWidth / innerHeight;
          camera.updateProjectionMatrix();
          renderer.setSize(innerWidth, innerHeight);
          renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        };
        addEventListener("pointermove", onPointer, { passive: true });
        addEventListener("resize", onResize);
        cleanPointer = () => {
          removeEventListener("pointermove", onPointer);
          removeEventListener("resize", onResize);
        };

        const tick = () => {
          if (!document.hidden) {
            core.rotation.y += 0.0018;
            core.rotation.x += 0.0009;
            wire.rotation.y -= 0.0011;
            stars.rotation.y += 0.00012;
            world.rotation.y += (pointer.x * 0.25 - world.rotation.y) * 0.035;
            world.rotation.x += (-pointer.y * 0.18 - world.rotation.x) * 0.035;
            renderer.render(scene, camera);
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
        const onVisibility = () => {
          if (!document.hidden) renderer.render(scene, camera);
        };
        document.addEventListener("visibilitychange", onVisibility);
        cleanVisibility = () => document.removeEventListener("visibilitychange", onVisibility);

        const context = gsap.context(() => {
          gsap.from("[data-pitch-logo]", {
            opacity: 0,
            scale: 0.7,
            rotate: -5,
            duration: 1.8,
            ease: "expo.out",
          });
          gsap.utils.toArray<HTMLElement>("[data-pitch-reveal]").forEach((element) => {
            gsap.from(element, {
              opacity: 0,
              y: 70,
              duration: 1.1,
              ease: "power3.out",
              scrollTrigger: { trigger: element, start: "top 82%", once: true },
            });
          });
          gsap.to(world.rotation, {
            z: Math.PI * 1.5,
            y: Math.PI * 2,
            ease: "none",
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "bottom bottom",
              scrub: 1.2,
            },
          });
          gsap.to(world.position, {
            x: -2.6,
            y: -0.4,
            ease: "none",
            scrollTrigger: {
              trigger: root,
              start: "top top",
              end: "45% center",
              scrub: 1,
            },
          });
        }, root);
        cleanScroll = () => context.revert();

        const originalDispose = cleanScroll;
        cleanScroll = () => {
          originalDispose();
          cancelAnimationFrame(frame);
          renderer.dispose();
          core.geometry.dispose();
          core.material.dispose();
          wire.geometry.dispose();
          wire.material.dispose();
          for (const ring of rings) ring.geometry.dispose();
          ringMaterial.dispose();
          stars.geometry.dispose();
          stars.material.dispose();
        };
      } catch {
        // The complete story remains legible when WebGL or animation setup fails.
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      cleanScroll();
      cleanPointer();
      cleanVisibility();
    };
  }, []);

  return (
    <main id="main" ref={rootRef} className="pitch-night">
      <canvas ref={canvasRef} className="pitch-night-canvas" aria-hidden="true" />
      <div className="pitch-night-grain" aria-hidden="true" />

      <nav className="fixed inset-x-0 top-0 z-30 flex items-center justify-between px-5 py-4 sm:px-8">
        <Link
          to="/"
          className="font-mono text-micro uppercase tracking-[0.14em] opacity-65 hover:opacity-100"
        >
          milk & henny
        </Link>
        <div className="flex items-center gap-4">
          <a
            href="#night"
            className="hidden font-mono text-micro uppercase tracking-[0.14em] opacity-65 hover:opacity-100 sm:block"
          >
            what happens
          </a>
          <a
            href={ticketHref}
            className="border border-current px-4 py-2 font-mono text-micro uppercase tracking-[0.14em] hover:opacity-70"
          >
            get tickets
          </a>
        </div>
      </nav>

      <section className="pitch-night-section">
        <div className="mx-auto w-full max-w-6xl">
          <div data-pitch-logo className="relative aspect-[4/1] w-full max-w-4xl overflow-hidden">
            <img
              src="/MAHtext.svg"
              alt="milk and henny"
              className="absolute left-0 top-1/2 w-full -translate-y-1/2"
            />
          </div>
          <h1 className="mt-10 max-w-2xl font-serif text-2xl leading-relaxed sm:text-4xl">
            An evening for impossible ideas, difficult words, excellent games, loud records, and the
            people you want beside you for all of it.
          </h1>
          <div className="mt-12 flex flex-wrap gap-4">
            <Link
              to="/things/pitches/new"
              className="inline-flex min-h-13 items-center bg-[var(--pitch-night-cream)] px-6 font-mono text-sm text-[var(--pitch-night-night)] hover:opacity-80"
            >
              make your pitch →
            </Link>
            <a
              href="#night"
              className="inline-flex min-h-13 items-center border-b border-current px-3 font-mono text-sm opacity-75 hover:opacity-100"
            >
              see the night ↓
            </a>
          </div>
        </div>
      </section>

      <div className="pitch-night-marquee-frame relative z-10 overflow-hidden border-y py-4 font-mono text-xs uppercase tracking-[0.2em] opacity-70">
        <div className="pitch-night-marquee">
          Pitch night · spelling bee · board games · apartment life DJ set · catering · free parking
          · Pitch night · spelling bee · board games · apartment life DJ set · catering · free
          parking ·
        </div>
      </div>

      <div id="night">
        {CHAPTERS.map((chapter, index) => (
          <section key={chapter.number} className="pitch-night-section">
            <div
              data-pitch-reveal
              className={`mx-auto w-full max-w-6xl ${index % 2 ? "md:pl-[38%]" : "md:pr-[38%]"}`}
            >
              <div className="pitch-night-card pt-6">
                <div className="flex items-baseline justify-between gap-4 font-mono text-micro uppercase tracking-[0.18em] opacity-65">
                  <span>{chapter.number}</span>
                  <span>{chapter.eyebrow}</span>
                </div>
                <h2 className="pitch-night-word mt-10 font-serif text-5xl leading-[0.98] sm:text-7xl lg:text-8xl">
                  {chapter.title}
                </h2>
                <p className="mt-8 max-w-2xl font-serif text-xl leading-relaxed opacity-80 sm:text-2xl">
                  {chapter.body}
                </p>
                <p className="mt-8 font-mono text-xs uppercase tracking-[0.16em] text-[var(--pitch-night-gold)]">
                  {chapter.aside}
                </p>
              </div>
            </div>
          </section>
        ))}
      </div>

      <section className="pitch-night-section">
        <div data-pitch-reveal className="mx-auto grid w-full max-w-6xl gap-10 md:grid-cols-2">
          <div className="pitch-night-card pt-6">
            <p className="font-mono text-micro uppercase tracking-[0.18em] opacity-65">
              05 · Catering
            </p>
            <h2 className="mt-8 font-serif text-6xl sm:text-7xl">Nobody pitches hungry.</h2>
            <p className="mt-6 max-w-xl font-serif text-xl leading-relaxed opacity-80">
              Food is part of the architecture. Arrive, settle in, eat properly, then go make a very
              persuasive mistake.
            </p>
          </div>
          <div className="pitch-night-card pt-6">
            <p className="font-mono text-micro uppercase tracking-[0.18em] opacity-65">
              06 · Free parking
            </p>
            <h2 className="mt-8 font-serif text-6xl sm:text-7xl">Even the car gets invited.</h2>
            <p className="mt-6 max-w-xl font-serif text-xl leading-relaxed opacity-80">
              Free parking, because the most cinematic night of the month should not end with a
              payment machine.
            </p>
          </div>
        </div>
      </section>

      <section className="pitch-night-section">
        <div data-pitch-reveal className="mx-auto w-full max-w-5xl text-center">
          <img src="/MAHLogo.svg" alt="" className="mx-auto w-52 sm:w-72" />
          <p className="mt-10 font-mono text-micro uppercase tracking-[0.22em] text-[var(--pitch-night-gold)]">
            involve me
          </p>
          <h2 className="pitch-night-word mt-5 font-serif text-6xl leading-none sm:text-8xl">
            Come with an idea. Leave with a story.
          </h2>
          <div className="mt-12 flex flex-wrap justify-center gap-4">
            <a
              href={ticketHref}
              className="inline-flex min-h-14 items-center bg-[var(--pitch-night-cream)] px-8 font-mono text-sm text-[var(--pitch-night-night)] hover:opacity-80"
            >
              get your ticket →
            </a>
            <Link
              to="/things/pitches/new"
              className="inline-flex min-h-14 items-center border border-current px-8 font-mono text-sm hover:opacity-70"
            >
              build the six slides
            </Link>
          </div>
          <p className="mt-16 font-mono text-micro uppercase tracking-[0.16em] opacity-45">
            no cart · one decision · Stripe checkout
          </p>
        </div>
      </section>
    </main>
  );
}
