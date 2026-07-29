import type { Group } from "three";

type Gsap = (typeof import("gsap"))["gsap"];
type ScrollTriggerPlugin = (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];

interface MotionContext {
  ScrollTrigger: ScrollTriggerPlugin;
  compact: boolean;
  gsap: Gsap;
  root: HTMLElement;
  world: Group;
}

function animateOpening({ gsap, root }: MotionContext) {
  gsap.set("[data-hero-line]", { yPercent: 112, rotate: 2 });
  gsap.set("[data-hero-kicker], [data-hero-actions], [data-hero-whisper]", {
    opacity: 0,
    y: 18,
  });
  gsap
    .timeline({ defaults: { ease: "power4.out" } })
    .from("[data-pitch-logo]", {
      opacity: 0,
      scale: 0.72,
      rotate: -4,
      duration: 1.55,
    })
    .to("[data-hero-kicker]", { opacity: 1, y: 0, duration: 0.8 }, "-=0.95")
    .to("[data-hero-line]", { yPercent: 0, rotate: 0, duration: 1.25, stagger: 0.12 }, "-=0.55")
    .to("[data-hero-actions]", { opacity: 1, y: 0, duration: 0.75 }, "-=0.6")
    .to("[data-hero-whisper]", { opacity: 0.62, y: 0, duration: 0.7 }, "-=0.45");

  gsap.to("[data-progress]", {
    scaleX: 1,
    ease: "none",
    transformOrigin: "left center",
    scrollTrigger: {
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: 0.2,
    },
  });
  gsap.to("[data-pitch-logo]", {
    yPercent: -32,
    scale: 0.82,
    opacity: 0.28,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-hero]",
      start: "top top",
      end: "bottom top",
      scrub: 1,
    },
  });
  gsap.to("[data-cloud='near']", {
    xPercent: 18,
    ease: "none",
    scrollTrigger: {
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: 2,
    },
  });
  gsap.to("[data-cloud='far']", {
    xPercent: -12,
    ease: "none",
    scrollTrigger: {
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: 2.5,
    },
  });

  gsap.utils.toArray<HTMLElement>("[data-copy-line]").forEach((line) => {
    gsap.from(line, {
      yPercent: 108,
      rotate: 1.5,
      duration: 1.05,
      ease: "power4.out",
      scrollTrigger: {
        trigger: line,
        start: "top 88%",
        once: true,
      },
    });
  });
  gsap.utils.toArray<HTMLElement>("[data-soft-reveal]").forEach((element) => {
    gsap.from(element, {
      opacity: 0,
      y: 38,
      filter: "blur(12px)",
      duration: 1.15,
      ease: "power3.out",
      scrollTrigger: {
        trigger: element,
        start: "top 88%",
        once: true,
      },
    });
  });
}

function animateWorld({ compact, gsap, root, world }: MotionContext) {
  gsap.to(world.rotation, {
    z: Math.PI * 1.7,
    y: Math.PI * 2.3,
    ease: "none",
    scrollTrigger: {
      trigger: root,
      start: "top top",
      end: "bottom bottom",
      scrub: 1.4,
    },
  });
  gsap.to(world.position, {
    x: compact ? -0.8 : -2.6,
    y: compact ? -0.6 : -0.3,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-prologue]",
      start: "top bottom",
      end: "bottom top",
      scrub: 1,
    },
  });
  gsap.fromTo(
    world.scale,
    { x: 1, y: 1, z: 1 },
    {
      x: compact ? 0.72 : 0.56,
      y: compact ? 0.72 : 0.56,
      z: compact ? 0.72 : 0.56,
      ease: "none",
      scrollTrigger: {
        trigger: "[data-pitch-scene]",
        start: "top bottom",
        end: "center center",
        scrub: 1.2,
      },
    },
  );
}

function animatePitchAndSpelling({ gsap }: MotionContext) {
  const media = gsap.matchMedia();
  const pitchCards = gsap.utils.toArray<HTMLElement>("[data-slide-card]");
  const quoteWords = gsap.utils.toArray<HTMLElement>("[data-quote-word]");

  media.add("(min-width: 768px)", () => {
    gsap
      .timeline({
        scrollTrigger: {
          trigger: "[data-pitch-scene]",
          start: "top top",
          end: "bottom bottom",
          scrub: 1,
        },
      })
      .fromTo(
        pitchCards,
        { opacity: 0, y: 160, x: 90, rotate: 14, scale: 0.82 },
        {
          opacity: 1,
          y: 0,
          x: 0,
          rotate: 0,
          scale: 1,
          stagger: 0.08,
          duration: 0.48,
          ease: "power3.out",
        },
      )
      .fromTo(
        quoteWords,
        { opacity: 0.12, y: 22, filter: "blur(7px)" },
        {
          opacity: 1,
          y: 0,
          filter: "blur(0px)",
          stagger: 0.035,
          duration: 0.65,
        },
        0.14,
      )
      .to(
        pitchCards,
        {
          y: (index) => index * -4,
          rotate: (index) => (index - 2.5) * 1.8,
          stagger: 0.025,
          duration: 0.34,
        },
        0.66,
      );
  });
  media.add("(max-width: 767px)", () => {
    gsap.from(pitchCards, {
      opacity: 0,
      y: 70,
      rotate: 8,
      stagger: 0.08,
      duration: 0.85,
      ease: "power3.out",
      scrollTrigger: {
        trigger: "[data-slide-stack]",
        start: "top 84%",
        once: true,
      },
    });
    gsap.from(quoteWords, {
      opacity: 0.15,
      y: 14,
      stagger: 0.025,
      duration: 0.65,
      ease: "power3.out",
      scrollTrigger: {
        trigger: "[data-pitch-quote]",
        start: "top 86%",
        once: true,
      },
    });
  });

  const letters = gsap.utils.toArray<HTMLElement>("[data-spelling-letter]");
  gsap.fromTo(
    letters,
    {
      opacity: 0,
      x: (index) => (index % 2 ? 90 : -90),
      y: (index) => ((index % 3) - 1) * 80,
      rotate: (index) => (index % 2 ? 28 : -24),
      scale: 1.8,
    },
    {
      opacity: 1,
      x: 0,
      y: 0,
      rotate: 0,
      scale: 1,
      stagger: 0.08,
      ease: "power3.out",
      scrollTrigger: {
        trigger: "[data-spelling-word]",
        start: "top 90%",
        end: "center 48%",
        scrub: 0.8,
      },
    },
  );

  return () => media.revert();
}

function animateLaterScenes({ gsap }: MotionContext) {
  gsap.utils.toArray<HTMLElement>("[data-game-token]").forEach((token, index) => {
    gsap.fromTo(
      token,
      {
        xPercent: index % 2 ? 110 : -120,
        yPercent: index % 3 ? 40 : -40,
        rotate: index % 2 ? 70 : -65,
      },
      {
        xPercent: index % 2 ? -30 : 38,
        yPercent: index % 3 ? -18 : 24,
        rotate: index % 2 ? -28 : 32,
        ease: "none",
        scrollTrigger: {
          trigger: "[data-games-scene]",
          start: "top bottom",
          end: "bottom top",
          scrub: 1.2,
        },
      },
    );
  });

  gsap.to("[data-vinyl]", {
    rotate: 560,
    scale: 1.08,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-dj-scene]",
      start: "top bottom",
      end: "bottom top",
      scrub: 1,
    },
  });
  gsap.from("[data-eq-bar]", {
    scaleY: 0.08,
    transformOrigin: "center bottom",
    stagger: { each: 0.035, from: "center" },
    ease: "power2.out",
    scrollTrigger: {
      trigger: "[data-equalizer]",
      start: "top 82%",
      end: "bottom 38%",
      scrub: 0.6,
    },
  });
  gsap.from("[data-lantern]", {
    opacity: 0,
    y: 80,
    scale: 0.5,
    stagger: 0.12,
    ease: "back.out(1.4)",
    scrollTrigger: {
      trigger: "[data-supper-scene]",
      start: "top 78%",
      once: true,
    },
  });
  gsap.to("[data-final-logo]", {
    y: -18,
    rotate: 2,
    duration: 3.5,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });
}

export function createPitchNightScrollMotion(context: MotionContext) {
  let cleanMedia = () => {};
  const motion = context.gsap.context(() => {
    animateOpening(context);
    animateWorld(context);
    cleanMedia = animatePitchAndSpelling(context);
    animateLaterScenes(context);
  }, context.root);

  return () => {
    cleanMedia();
    motion.revert();
  };
}
