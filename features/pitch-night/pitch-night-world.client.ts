import type { Group } from "three";

type ThreeModule = typeof import("three");

export interface PitchNightWorld {
  bottle: Group;
  celestial: Group;
  compact: boolean;
  finaleSystem: Group;
  group: Group;
  liquid: Group;
  orbitals: Group;
  dispose: () => void;
}

const COMPACT_PIXEL_RATIO = 1;
const WIDE_PIXEL_RATIO = 1.5;

export function createPitchNightWorld(
  THREE: ThreeModule,
  canvas: HTMLCanvasElement,
  compact: boolean,
): PitchNightWorld {
  const finePointer = matchMedia("(pointer: fine)").matches;
  const styles = getComputedStyle(document.documentElement);
  const amber = styles.getPropertyValue("--pitch-night-amber").trim();
  const cream = styles.getPropertyValue("--pitch-night-cream").trim();
  const blue = styles.getPropertyValue("--pitch-night-blue").trim();
  const night = styles.getPropertyValue("--pitch-night-night").trim();
  const cognac = new THREE.Color(amber).lerp(new THREE.Color(night), 0.52);
  const planetGold = new THREE.Color(amber).lerp(new THREE.Color(cream), 0.48);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !compact,
    powerPreference: "high-performance",
    precision: compact ? "mediump" : "highp",
  });
  const pixelRatio = () =>
    Math.min(devicePixelRatio, compact ? COMPACT_PIXEL_RATIO : WIDE_PIXEL_RATIO);
  renderer.setPixelRatio(pixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 100);
  camera.position.set(0, 0, 8);
  const group = new THREE.Group();
  const celestial = new THREE.Group();
  const bottle = new THREE.Group();
  const finaleSystem = new THREE.Group();
  const liquid = new THREE.Group();
  const orbitals = new THREE.Group();
  scene.add(group);
  group.add(finaleSystem);
  group.add(celestial);
  group.add(bottle);

  const finaleResources: Array<{ dispose: () => void }> = [];
  const finaleOrbitSpinners: Array<{ group: Group; speed: number }> = [];
  const finaleMoonSpinners: Array<{ group: Group; speed: number }> = [];
  finaleSystem.position.set(0, 0.08, -0.72);
  finaleSystem.rotation.set(0.06, -0.08, -0.28);
  finaleSystem.scale.setScalar(0.001);
  finaleSystem.visible = false;

  const auraCanvas = document.createElement("canvas");
  auraCanvas.width = 256;
  auraCanvas.height = 256;
  const auraContext = auraCanvas.getContext("2d");
  if (auraContext) {
    const gradient = auraContext.createRadialGradient(128, 128, 0, 128, 128, 128);
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.92)");
    gradient.addColorStop(0.18, "rgba(255, 255, 255, 0.42)");
    gradient.addColorStop(0.58, "rgba(255, 255, 255, 0.08)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    auraContext.fillStyle = gradient;
    auraContext.fillRect(0, 0, 256, 256);
  }
  const auraTexture = new THREE.CanvasTexture(auraCanvas);
  const auraMaterial = new THREE.SpriteMaterial({
    map: auraTexture,
    color: new THREE.Color(amber),
    transparent: true,
    opacity: 0.16,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const aura = new THREE.Sprite(auraMaterial);
  aura.position.z = -0.32;
  aura.scale.set(7.8, 7.8, 1);
  finaleSystem.add(aura);
  finaleResources.push(auraTexture, auraMaterial);

  const finaleOrbitSpecs = [
    {
      radius: 1.72,
      tube: 0.014,
      tilt: [1.08, 0.18, 0.12] as const,
      planetSize: 0.12,
      color: cream,
      phase: 0.45,
      speed: 0.0024,
    },
    {
      radius: 2.48,
      tube: 0.018,
      tilt: [0.82, -0.12, -0.2] as const,
      planetSize: 0.17,
      color: amber,
      phase: 2.1,
      speed: -0.00165,
    },
    {
      radius: 3.34,
      tube: 0.013,
      tilt: [1.24, 0.28, 0.32] as const,
      planetSize: 0.14,
      color: blue,
      phase: 4.15,
      speed: 0.00115,
    },
    {
      radius: 4.24,
      tube: 0.022,
      tilt: [0.96, -0.2, 0.52] as const,
      planetSize: 0.2,
      color: planetGold,
      phase: 5.35,
      speed: -0.00082,
    },
  ];

  for (const [index, spec] of finaleOrbitSpecs.entries()) {
    const plane = new THREE.Group();
    plane.rotation.set(spec.tilt[0], spec.tilt[1], spec.tilt[2]);
    finaleSystem.add(plane);

    const orbitGeometry = new THREE.TorusGeometry(spec.radius, spec.tube, 6, compact ? 96 : 176);
    const orbitMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(index % 2 === 0 ? cream : blue).lerp(
        new THREE.Color(spec.color),
        0.42,
      ),
      transparent: true,
      opacity: 0.2 - index * 0.018,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    plane.add(new THREE.Mesh(orbitGeometry, orbitMaterial));
    finaleResources.push(orbitGeometry, orbitMaterial);

    const spinner = new THREE.Group();
    spinner.rotation.z = spec.phase;
    plane.add(spinner);
    finaleOrbitSpinners.push({ group: spinner, speed: spec.speed });

    const planetGeometry = new THREE.SphereGeometry(
      spec.planetSize,
      compact ? 12 : 20,
      compact ? 8 : 14,
    );
    const planetMaterial = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(spec.color),
      emissive: new THREE.Color(spec.color),
      emissiveIntensity: 0.28,
      metalness: index === 2 ? 0.42 : 0.12,
      roughness: 0.24,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
    });
    const planet = new THREE.Mesh(planetGeometry, planetMaterial);
    planet.position.x = spec.radius;
    spinner.add(planet);
    finaleResources.push(planetGeometry, planetMaterial);

    const glowGeometry = new THREE.SphereGeometry(spec.planetSize * 1.85, 12, 8);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: new THREE.Color(spec.color),
      transparent: true,
      opacity: 0.1,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const glow = new THREE.Mesh(glowGeometry, glowMaterial);
    glow.position.copy(planet.position);
    spinner.add(glow);
    finaleResources.push(glowGeometry, glowMaterial);

    if (index === 1 || index === 3) {
      const moonSpinner = new THREE.Group();
      moonSpinner.position.copy(planet.position);
      spinner.add(moonSpinner);
      finaleMoonSpinners.push({
        group: moonSpinner,
        speed: index === 1 ? 0.006 : -0.0042,
      });

      const moonGeometry = new THREE.SphereGeometry(spec.planetSize * 0.32, 10, 7);
      const moonMaterial = new THREE.MeshBasicMaterial({
        color: new THREE.Color(cream),
        transparent: true,
        opacity: 0.82,
      });
      const moon = new THREE.Mesh(moonGeometry, moonMaterial);
      moon.position.x = spec.planetSize * 2.15;
      moonSpinner.add(moon);
      finaleResources.push(moonGeometry, moonMaterial);
    }
  }

  const dustCount = compact ? 150 : 280;
  const dustPositions = new Float32Array(dustCount * 3);
  for (let index = 0; index < dustCount; index += 1) {
    const radius = 1.35 + Math.random() * 3.7;
    const angle = Math.random() * Math.PI * 2;
    dustPositions[index * 3] = Math.cos(angle) * radius;
    dustPositions[index * 3 + 1] = Math.sin(angle) * radius * (0.58 + Math.random() * 0.22);
    dustPositions[index * 3 + 2] = (Math.random() - 0.5) * 0.7;
  }
  const dustGeometry = new THREE.BufferGeometry().setAttribute(
    "position",
    new THREE.BufferAttribute(dustPositions, 3),
  );
  const dustMaterial = new THREE.PointsMaterial({
    color: new THREE.Color(cream).lerp(new THREE.Color(amber), 0.36),
    size: compact ? 0.035 : 0.028,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const finaleDust = new THREE.Points(dustGeometry, dustMaterial);
  finaleDust.rotation.set(0.82, 0.1, -0.18);
  finaleSystem.add(finaleDust);
  finaleResources.push(dustGeometry, dustMaterial);

  const coreMaterial = new THREE.MeshPhysicalMaterial({
    color: planetGold,
    emissive: new THREE.Color(amber),
    emissiveIntensity: 0.08,
    metalness: 0.04,
    roughness: 0.16,
    transmission: 0.12,
    thickness: 1.4,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(1.55, compact ? 3 : 5), coreMaterial);
  const planetHaloMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(blue).lerp(new THREE.Color(cream), 0.18),
    transparent: true,
    opacity: 0.34,
    wireframe: true,
  });
  const planetHalo = new THREE.Mesh(new THREE.IcosahedronGeometry(1.68, 2), planetHaloMaterial);
  const planetRingMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(blue).lerp(new THREE.Color(cream), 0.22),
    emissive: new THREE.Color(blue),
    emissiveIntensity: 0.08,
    metalness: 0.34,
    roughness: 0.38,
  });
  const planetRing = new THREE.Mesh(
    new THREE.TorusGeometry(1.92, 0.055, 10, compact ? 72 : 120),
    planetRingMaterial,
  );
  planetRing.rotation.set(1.12, 0.18, 0.38);
  celestial.add(core);
  celestial.add(planetHalo);
  celestial.add(planetRing);
  celestial.add(orbitals);

  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.05, 2),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(cream),
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    }),
  );
  orbitals.add(wire);

  const ringMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(blue),
    metalness: 0.82,
    roughness: 0.3,
  });
  const rings: Array<InstanceType<ThreeModule["Mesh"]>> = [];
  for (let index = 0; index < 3; index += 1) {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(2.7 + index * 0.55, 0.035 + index * 0.01, 10, compact ? 90 : 160),
      ringMaterial,
    );
    ring.rotation.set(index * 0.7 + 0.25, index * 0.55, index * 0.9);
    rings.push(ring);
    orbitals.add(ring);
  }

  const bottleShape = new THREE.Shape();
  bottleShape.moveTo(-0.72, -2.08);
  bottleShape.quadraticCurveTo(-0.94, -2.04, -0.98, -1.78);
  bottleShape.lineTo(-1.02, 0.52);
  bottleShape.quadraticCurveTo(-1.01, 0.9, -0.72, 1.18);
  bottleShape.quadraticCurveTo(-0.58, 1.34, -0.4, 1.5);
  bottleShape.lineTo(-0.34, 2.18);
  bottleShape.lineTo(0.34, 2.18);
  bottleShape.lineTo(0.4, 1.5);
  bottleShape.quadraticCurveTo(0.58, 1.34, 0.72, 1.18);
  bottleShape.quadraticCurveTo(1.01, 0.9, 1.02, 0.52);
  bottleShape.lineTo(0.98, -1.78);
  bottleShape.quadraticCurveTo(0.94, -2.04, 0.72, -2.08);
  bottleShape.closePath();

  const glassGeometry = new THREE.ExtrudeGeometry(bottleShape, {
    depth: 0.5,
    bevelEnabled: true,
    bevelSegments: compact ? 2 : 4,
    bevelSize: 0.09,
    bevelThickness: 0.08,
    curveSegments: compact ? 8 : 14,
  });
  glassGeometry.translate(0, 0, -0.25);
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(cream).lerp(new THREE.Color(amber), 0.12),
    emissive: new THREE.Color(amber),
    emissiveIntensity: 0.015,
    metalness: 0,
    roughness: 0.03,
    transmission: 0.94,
    thickness: 0.34,
    transparent: true,
    opacity: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(glassGeometry, glassMaterial);
  glass.renderOrder = 3;
  bottle.add(glass);

  const bottleEdgeMaterial = new THREE.LineBasicMaterial({
    color: new THREE.Color(amber).lerp(new THREE.Color(cream), 0.34),
    transparent: true,
    opacity: 0.38,
  });
  const bottleEdges = new THREE.LineSegments(
    new THREE.EdgesGeometry(glassGeometry, 24),
    bottleEdgeMaterial,
  );
  bottleEdges.renderOrder = 3;
  bottle.add(bottleEdges);

  const liquidShape = new THREE.Shape();
  liquidShape.moveTo(-0.66, 0);
  liquidShape.quadraticCurveTo(-0.84, 0.03, -0.86, 0.28);
  liquidShape.lineTo(-0.9, 1.98);
  liquidShape.lineTo(-0.89, 2.12);
  liquidShape.lineTo(0.89, 2.12);
  liquidShape.lineTo(0.9, 1.98);
  liquidShape.lineTo(0.86, 0.28);
  liquidShape.quadraticCurveTo(0.84, 0.03, 0.66, 0);
  liquidShape.closePath();
  const liquidGeometry = new THREE.ExtrudeGeometry(liquidShape, {
    depth: 0.38,
    bevelEnabled: true,
    bevelSegments: compact ? 1 : 2,
    bevelSize: 0.035,
    bevelThickness: 0.025,
    curveSegments: compact ? 6 : 10,
  });
  liquidGeometry.translate(0, 0, -0.19);
  const liquidMaterial = new THREE.MeshPhysicalMaterial({
    color: cognac,
    emissive: new THREE.Color(amber),
    emissiveIntensity: 0.06,
    roughness: 0.18,
    metalness: 0.02,
    transmission: 0.08,
    thickness: 1.1,
    transparent: true,
    opacity: 0.86,
    clearcoat: 1,
    clearcoatRoughness: 0.12,
    depthWrite: false,
  });
  const liquidBody = new THREE.Mesh(liquidGeometry, liquidMaterial);
  liquidBody.renderOrder = 1;
  liquid.add(liquidBody);
  const liquidSurfaceMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(amber).lerp(new THREE.Color(cream), 0.16),
    transparent: true,
    opacity: 0.58,
  });
  const liquidSurface = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.026, 0.4),
    liquidSurfaceMaterial,
  );
  liquidSurface.position.y = 2.12;
  liquidSurface.renderOrder = 2;
  liquid.add(liquidSurface);
  liquid.position.y = -1.96;
  liquid.scale.y = 0.08;
  bottle.add(liquid);

  const rimMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cream),
    metalness: 0.62,
    roughness: 0.24,
  });
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.045, 10, 48), rimMaterial);
  rim.position.y = 2.18;
  rim.rotation.x = Math.PI / 2;
  bottle.add(rim);
  const neckBand = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.055, 10, 48), rimMaterial);
  neckBand.position.y = 1.64;
  neckBand.rotation.x = Math.PI / 2;
  bottle.add(neckBand);

  const corkMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(amber),
    metalness: 0.08,
    roughness: 0.72,
  });
  const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.35, 0.44, 24), corkMaterial);
  cork.position.y = 2.43;
  bottle.add(cork);

  const labelCanvas = document.createElement("canvas");
  labelCanvas.width = 512;
  labelCanvas.height = 320;
  const labelContext = labelCanvas.getContext("2d");
  if (labelContext) {
    labelContext.fillStyle = cream;
    labelContext.fillRect(0, 0, labelCanvas.width, labelCanvas.height);
    labelContext.strokeStyle = amber;
    labelContext.lineWidth = 10;
    labelContext.strokeRect(18, 18, labelCanvas.width - 36, labelCanvas.height - 36);
    labelContext.fillStyle = night;
    labelContext.textAlign = "center";
    labelContext.font = "700 72px monospace";
    labelContext.fillText("HENNY", 256, 142);
    labelContext.fillStyle = amber;
    labelContext.font = "30px monospace";
    labelContext.fillText("AFTER DARK", 256, 205);
    labelContext.fillRect(182, 235, 148, 4);
  }
  const labelTexture = new THREE.CanvasTexture(labelCanvas);
  labelTexture.colorSpace = THREE.SRGBColorSpace;
  const labelMaterial = new THREE.MeshBasicMaterial({
    map: labelTexture,
    transparent: true,
    opacity: 0.96,
    depthTest: false,
    depthWrite: false,
  });
  const label = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.89), labelMaterial);
  label.position.set(0, -0.76, 0.36);
  label.renderOrder = 4;
  bottle.add(label);
  bottle.position.set(0, -0.18, 0.08);
  bottle.rotation.y = -0.12;
  bottle.scale.setScalar(0.001);
  bottle.visible = false;

  const starCount = compact ? 520 : 1_200;
  const starPositions = new Float32Array(starCount * 3);
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
      size: compact ? 0.032 : 0.025,
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
  const handlePointer = (event: PointerEvent) => {
    pointer.x = event.clientX / innerWidth - 0.5;
    pointer.y = event.clientY / innerHeight - 0.5;
  };
  let resizeFrame = 0;
  const handleResize = () => {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(pixelRatio());
      renderer.setSize(innerWidth, innerHeight);
    });
  };
  if (finePointer) addEventListener("pointermove", handlePointer, { passive: true });
  addEventListener("resize", handleResize);

  let lastFrameTime = performance.now();
  let frame = 0;
  const render = () => {
    if (!document.hidden) {
      const now = performance.now();
      const frameScale = Math.max(0, Math.min((now - lastFrameTime) / 1_000, 1 / 20)) * 60;
      lastFrameTime = now;
      core.rotation.y += 0.0018 * frameScale;
      core.rotation.x += 0.0009 * frameScale;
      wire.rotation.y -= 0.0011 * frameScale;
      if (finaleSystem.visible) {
        finaleSystem.rotation.z += 0.00016 * frameScale;
        finaleDust.rotation.z -= 0.00032 * frameScale;
        for (const orbiter of finaleOrbitSpinners) {
          orbiter.group.rotation.z += orbiter.speed * frameScale;
        }
        for (const moon of finaleMoonSpinners) moon.group.rotation.z += moon.speed * frameScale;
      }
      stars.rotation.y += 0.00012 * frameScale;
      group.rotation.y += (pointer.x * 0.25 - group.rotation.y) * 0.035;
      group.rotation.x += (-pointer.y * 0.18 - group.rotation.x) * 0.035;
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(render);
  };
  // Compile the finale's otherwise-hidden materials while the opening scene is idle. This avoids
  // a shader compilation hitch at the exact moment the bottle and orbit system enter together.
  finaleSystem.visible = true;
  const finishFinaleWarmup = () => {
    if (finaleSystem.scale.x <= 0.0011) finaleSystem.visible = false;
  };
  void renderer.compileAsync(scene, camera).then(finishFinaleWarmup, finishFinaleWarmup);
  render();
  const handleVisibility = () => {
    if (!document.hidden) {
      lastFrameTime = performance.now();
      renderer.render(scene, camera);
    }
  };
  document.addEventListener("visibilitychange", handleVisibility);

  return {
    bottle,
    celestial,
    compact,
    finaleSystem,
    group,
    liquid,
    orbitals,
    dispose: () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      if (finePointer) removeEventListener("pointermove", handlePointer);
      removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      renderer.dispose();
      core.geometry.dispose();
      core.material.dispose();
      planetHalo.geometry.dispose();
      planetHaloMaterial.dispose();
      planetRing.geometry.dispose();
      planetRingMaterial.dispose();
      wire.geometry.dispose();
      wire.material.dispose();
      for (const ring of rings) ring.geometry.dispose();
      ringMaterial.dispose();
      glass.geometry.dispose();
      glassMaterial.dispose();
      bottleEdges.geometry.dispose();
      bottleEdgeMaterial.dispose();
      liquidBody.geometry.dispose();
      liquidMaterial.dispose();
      liquidSurface.geometry.dispose();
      liquidSurfaceMaterial.dispose();
      rim.geometry.dispose();
      rimMaterial.dispose();
      neckBand.geometry.dispose();
      cork.geometry.dispose();
      corkMaterial.dispose();
      label.geometry.dispose();
      labelMaterial.dispose();
      labelTexture.dispose();
      for (const resource of finaleResources) resource.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
    },
  };
}
