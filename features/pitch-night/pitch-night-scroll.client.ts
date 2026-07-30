import type { PitchNightWorld } from "./pitch-night-world.client";

type Gsap = (typeof import("gsap"))["gsap"];
type ScrollTriggerPlugin = (typeof import("gsap/ScrollTrigger"))["ScrollTrigger"];

interface MotionContext {
  ScrollTrigger: ScrollTriggerPlugin;
  compact: boolean;
  gsap: Gsap;
  root: HTMLElement;
  world: PitchNightWorld;
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
  gsap.to("[data-hill='back']", {
    yPercent: -12,
    xPercent: -2,
    scale: 1.06,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-hero]",
      start: "top top",
      end: "bottom top",
      scrub: 1.6,
    },
  });
  gsap.to("[data-hill='front']", {
    yPercent: -6,
    xPercent: 3,
    scale: 1.03,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-hero]",
      start: "top top",
      end: "bottom top",
      scrub: 1.2,
    },
  });
  gsap.to("[data-mountain-mist]", {
    xPercent: -22,
    opacity: 0.18,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-hero]",
      start: "top top",
      end: "bottom top",
      scrub: 2,
    },
  });
  gsap.to("[data-valley-light]", {
    yPercent: -20,
    scale: 1.2,
    opacity: 0.86,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-hero]",
      start: "top top",
      end: "bottom top",
      scrub: 1.4,
    },
  });
  gsap.fromTo(
    "[data-microphone-moment]",
    { opacity: 0, y: 90, rotate: -18, scale: 0.72 },
    {
      opacity: 1,
      y: -34,
      rotate: 4,
      scale: 1,
      ease: "none",
      scrollTrigger: {
        trigger: "[data-prologue]",
        start: "top 75%",
        end: "bottom 30%",
        scrub: 1.1,
      },
    },
  );

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
  const supperWorld = {
    groupPosition: { x: compact ? 0.08 : -2.3, y: compact ? 0.42 : 0.48 },
    groupScale: {
      x: compact ? 0.72 : 0.66,
      y: compact ? 0.72 : 0.66,
      z: compact ? 0.72 : 0.66,
    },
    bottleScale: {
      x: compact ? 0.72 : 0.82,
      y: compact ? 0.72 : 0.82,
      z: compact ? 0.72 : 0.82,
    },
    celestialScale: { x: 0.16, y: 0.16, z: 0.16 },
    celestialPosition: { x: 0, y: 0.02, z: -0.2 },
  };

  const restoreOpeningWorld = () => {
    gsap.set(world.group.position, { x: 0, y: 0, z: 0 });
    gsap.set(world.group.scale, { x: 1, y: 1, z: 1 });
    gsap.set(world.bottle.scale, { x: 0.001, y: 0.001, z: 0.001 });
    gsap.set(world.bottle.rotation, { x: 0, y: -0.12, z: 0 });
    gsap.set(world.celestial.scale, { x: 1, y: 1, z: 1 });
    gsap.set(world.celestial.position, { x: 0, y: 0, z: 0 });
    gsap.set(world.orbitals.scale, { x: 1, y: 1, z: 1 });
    gsap.set(world.liquid.scale, { x: 1, y: 0.08, z: 1 });
  };

  gsap.to(world.bottle.position, {
    y: compact ? -0.08 : 0.08,
    duration: compact ? 3.6 : 3.2,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });

  gsap.to(world.celestial.rotation, {
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
  gsap.to(world.group.position, {
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
    world.group.scale,
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

  gsap
    .timeline({
      scrollTrigger: {
        trigger: "[data-supper-scene]",
        start: "top 86%",
        end: "center 42%",
        scrub: 1.15,
        onLeaveBack: restoreOpeningWorld,
      },
    })
    .to(
      world.group.position,
      {
        ...supperWorld.groupPosition,
        duration: 0.8,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.group.scale,
      {
        ...supperWorld.groupScale,
        duration: 0.8,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.celestial.scale,
      {
        ...supperWorld.celestialScale,
        duration: 0.64,
        ease: "power2.in",
      },
      0.02,
    )
    .to(
      world.celestial.position,
      {
        ...supperWorld.celestialPosition,
        duration: 0.72,
        ease: "power2.in",
      },
      0,
    )
    .to(
      world.bottle.scale,
      {
        ...supperWorld.bottleScale,
        duration: 0.72,
        ease: "back.out(1.15)",
      },
      0.14,
    )
    .to(
      world.liquid.scale,
      {
        y: 1,
        duration: 0.58,
        ease: "power2.out",
      },
      0.3,
    );

  gsap.to(world.bottle.rotation, {
    y: 0.2,
    x: -0.045,
    ease: "none",
    scrollTrigger: {
      trigger: "[data-supper-scene]",
      start: "center center",
      end: "bottom top",
      scrub: 1.4,
    },
  });

  const restoreSupperWorld = () => {
    gsap.set(world.group.position, supperWorld.groupPosition);
    gsap.set(world.group.scale, supperWorld.groupScale);
    gsap.set(world.bottle.scale, supperWorld.bottleScale);
    gsap.set(world.bottle.rotation, { x: -0.045, y: 0.2 });
    gsap.set(world.celestial.scale, supperWorld.celestialScale);
    gsap.set(world.celestial.position, supperWorld.celestialPosition);
    gsap.set(world.orbitals.scale, { x: 1, y: 1, z: 1 });
  };

  const restoreWorldBeforeFinale = () => {
    const supperScene = root.querySelector<HTMLElement>("[data-supper-scene]");
    if (!supperScene || supperScene.getBoundingClientRect().top > innerHeight * 0.86) {
      restoreOpeningWorld();
      return;
    }
    restoreSupperWorld();
  };

  gsap
    .timeline({
      scrollTrigger: {
        trigger: ".pitch-night-finale",
        start: "top 62%",
        end: "top -18%",
        scrub: 1.1,
        onLeaveBack: restoreWorldBeforeFinale,
      },
    })
    .to(
      world.group.position,
      {
        x: compact ? 0 : -2.65,
        y: compact ? 0 : 0.36,
        duration: 0.3,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.group.scale,
      {
        x: compact ? 0.62 : 0.61,
        y: compact ? 0.62 : 0.61,
        z: compact ? 0.62 : 0.61,
        duration: 0.3,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.bottle.scale,
      {
        x: compact ? 0.62 : 0.64,
        y: compact ? 0.62 : 0.64,
        z: compact ? 0.62 : 0.64,
        duration: 0.3,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.celestial.scale,
      {
        x: 0.24,
        y: 0.24,
        z: 0.24,
        duration: 0.28,
        ease: "back.out(1.2)",
      },
      0.08,
    )
    .to(
      world.celestial.position,
      {
        x: 0,
        y: 0.02,
        z: -0.24,
        duration: 0.3,
        ease: "power2.inOut",
      },
      0,
    )
    .to(
      world.orbitals.scale,
      {
        x: 0.32,
        y: 0.32,
        z: 0.32,
        duration: 0.28,
        ease: "power2.inOut",
      },
      0.08,
    )
    .to(
      world.bottle.rotation,
      {
        y: Math.PI * 2 + 0.2,
        x: -0.025,
        duration: 0.5,
        ease: "power2.inOut",
      },
      0.3,
    )
    .to(
      world.group.position,
      {
        y: compact ? 3.65 : 0.36,
        duration: 0.22,
        ease: "power2.in",
      },
      0.78,
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
    gsap
      .timeline({
        scrollTrigger: {
          trigger: "[data-slide-stack]",
          start: "top 92%",
          end: "center 46%",
          scrub: 0.85,
        },
      })
      .fromTo(
        pitchCards,
        {
          opacity: 0,
          x: (index) => (index % 2 === 0 ? -240 - index * 22 : 240 + index * 22),
          y: (index) => 150 + index * 26,
          rotate: (index) => (index % 2 === 0 ? -24 - index * 3 : 24 + index * 3),
          scale: 0.72,
        },
        {
          opacity: 1,
          x: 0,
          y: 0,
          rotate: 0,
          scale: 1,
          stagger: 0.07,
          duration: 0.7,
          ease: "power3.out",
        },
      )
      .to(
        pitchCards,
        {
          y: (index) => index * -3,
          rotate: (index) => (index - 2.5) * 1.15,
          stagger: 0.025,
          duration: 0.3,
          ease: "power2.out",
        },
        0.58,
      );
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

function animateBreath({ gsap }: MotionContext) {
  const words = gsap.utils.toArray<HTMLElement>("[data-breath-word]");
  gsap
    .timeline({
      scrollTrigger: {
        trigger: "[data-breath]",
        start: "top 82%",
        end: "bottom 38%",
        scrub: 0.85,
      },
    })
    .fromTo(
      words,
      {
        opacity: 0.08,
        yPercent: 80,
        rotate: 3,
        filter: "blur(10px)",
      },
      {
        opacity: 1,
        yPercent: 0,
        rotate: 0,
        filter: "blur(0px)",
        stagger: 0.16,
        duration: 0.65,
        ease: "power3.out",
      },
    )
    .to(
      "[data-breath-pulse]",
      {
        opacity: 0,
        scale: 2.8,
        duration: 0.8,
        ease: "power2.out",
      },
      0.12,
    );
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
  gsap.fromTo(
    "[data-supper-line]",
    {
      opacity: 0,
      yPercent: 118,
      rotate: 2,
      filter: "blur(14px)",
    },
    {
      opacity: 1,
      yPercent: 0,
      rotate: 0,
      filter: "blur(0px)",
      stagger: 0.16,
      duration: 1.05,
      ease: "power4.out",
      scrollTrigger: {
        trigger: "[data-supper-heading]",
        start: "top 84%",
        once: true,
      },
    },
  );
  gsap
    .timeline({
      scrollTrigger: {
        trigger: "[data-table-scene]",
        start: "top 92%",
        end: "center 48%",
        scrub: 0.9,
      },
    })
    .fromTo(
      "[data-table-top]",
      { opacity: 0, y: 130, rotateX: 72, scale: 0.86 },
      { opacity: 1, y: 0, rotateX: 62, scale: 1, duration: 0.72, ease: "power3.out" },
    )
    .fromTo(
      "[data-table-light]",
      { opacity: 0, scale: 0.45 },
      { opacity: 1, scale: 1, duration: 0.58, ease: "power2.out" },
      0.08,
    )
    .fromTo(
      "[data-supper-guest]",
      {
        opacity: 0,
        y: 90,
        scale: 0.76,
        rotate: (index) => (index % 2 ? 7 : -7),
      },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        rotate: 0,
        stagger: { each: 0.055, from: "center" },
        duration: 0.42,
        ease: "back.out(1.12)",
      },
      0.22,
    )
    .fromTo(
      "[data-table-place]",
      {
        opacity: 0,
        y: 70,
        x: (index) => (index - 2) * 32,
        rotate: (index) => (index - 2) * 8,
      },
      {
        opacity: 1,
        y: 0,
        x: 0,
        rotate: 0,
        stagger: 0.08,
        duration: 0.4,
        ease: "power3.out",
      },
      0.46,
    )
    .fromTo(
      "[data-table-centrepiece]",
      { opacity: 0, y: 40, scale: 0.6 },
      { opacity: 1, y: 0, scale: 1, duration: 0.52, ease: "back.out(1.4)" },
      0.6,
    )
    .fromTo(
      "[data-table-food]",
      { opacity: 0, scale: 0.3, rotate: -12 },
      {
        opacity: 1,
        scale: 1,
        rotate: 0,
        stagger: 0.045,
        duration: 0.34,
        ease: "back.out(1.6)",
      },
      0.66,
    )
    .fromTo(
      "[data-table-drink]",
      { opacity: 0, y: 30, scale: 0.45 },
      {
        opacity: 1,
        y: 0,
        scale: 1,
        stagger: 0.055,
        duration: 0.34,
        ease: "back.out(1.5)",
      },
      0.84,
    );
  gsap
    .timeline({
      scrollTrigger: {
        trigger: ".pitch-night-finale",
        start: "top 30%",
        end: "top -18%",
        scrub: 0.8,
      },
    })
    .fromTo(
      "[data-finale-flyby]",
      { opacity: 0, x: "-44vw", y: 34, rotate: -5, scale: 0.78 },
      {
        opacity: 0.72,
        x: "-5vw",
        y: 0,
        rotate: 1,
        scale: 1,
        duration: 0.42,
        ease: "power2.out",
      },
    )
    .to("[data-finale-flyby]", {
      opacity: 0,
      x: "43vw",
      y: -22,
      rotate: 4,
      duration: 0.58,
      ease: "power2.in",
    });
  gsap.to("[data-final-logo]", {
    y: -18,
    rotate: 2,
    duration: 3.5,
    repeat: -1,
    yoyo: true,
    ease: "sine.inOut",
  });
  gsap.fromTo(
    "[data-final-logo]",
    { opacity: 0, filter: "blur(8px)" },
    {
      opacity: 1,
      filter: "blur(0px)",
      ease: "none",
      scrollTrigger: {
        trigger: ".pitch-night-final-question",
        start: "top 94%",
        end: "top 76%",
        scrub: 0.6,
      },
    },
  );
}

export function createPitchNightScrollMotion(context: MotionContext) {
  let cleanMedia = () => {};
  const motion = context.gsap.context(() => {
    animateOpening(context);
    animateWorld(context);
    cleanMedia = animatePitchAndSpelling(context);
    animateBreath(context);
    animateLaterScenes(context);
  }, context.root);

  return () => {
    cleanMedia();
    motion.revert();
  };
}
