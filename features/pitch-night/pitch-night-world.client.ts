import type { Group } from "three";

type ThreeModule = typeof import("three");

export interface PitchNightWorld {
  bottle: Group;
  celestial: Group;
  compact: boolean;
  group: Group;
  liquid: Group;
  orbitals: Group;
  dispose: () => void;
}

export function createPitchNightWorld(
  THREE: ThreeModule,
  canvas: HTMLCanvasElement,
  onResize: () => void,
): PitchNightWorld {
  const compact = matchMedia("(max-width: 767px)").matches;
  const finePointer = matchMedia("(pointer: fine)").matches;
  const styles = getComputedStyle(document.documentElement);
  const amber = styles.getPropertyValue("--pitch-night-amber").trim();
  const cream = styles.getPropertyValue("--pitch-night-cream").trim();
  const blue = styles.getPropertyValue("--pitch-night-blue").trim();
  const night = styles.getPropertyValue("--pitch-night-night").trim();
  const cognac = new THREE.Color(amber).lerp(new THREE.Color(night), 0.22);
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: !compact,
    powerPreference: compact ? "default" : "high-performance",
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.2 : 1.5));
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
  const liquid = new THREE.Group();
  const orbitals = new THREE.Group();
  scene.add(group);
  group.add(celestial);
  group.add(bottle);

  const core = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.55, compact ? 3 : 5),
    new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(amber),
      metalness: 0.08,
      roughness: 0.2,
      transmission: 0.24,
      thickness: 1.8,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    }),
  );
  celestial.add(core);
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

  const bottleProfile = [
    new THREE.Vector2(0, -2.08),
    new THREE.Vector2(0.72, -2.08),
    new THREE.Vector2(0.9, -1.84),
    new THREE.Vector2(1.02, -0.72),
    new THREE.Vector2(1.05, 0.34),
    new THREE.Vector2(0.92, 0.86),
    new THREE.Vector2(0.47, 1.48),
    new THREE.Vector2(0.36, 2.18),
    new THREE.Vector2(0, 2.18),
  ];
  const glassMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(amber),
    emissive: new THREE.Color(amber),
    emissiveIntensity: 0.04,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.86,
    thickness: 0.48,
    transparent: true,
    opacity: 0.24,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const glass = new THREE.Mesh(
    new THREE.LatheGeometry(bottleProfile, compact ? 32 : 56),
    glassMaterial,
  );
  bottle.add(glass);

  const liquidProfile = [
    new THREE.Vector2(0, -1.96),
    new THREE.Vector2(0.64, -1.96),
    new THREE.Vector2(0.8, -1.72),
    new THREE.Vector2(0.9, -0.7),
    new THREE.Vector2(0.92, 0.88),
    new THREE.Vector2(0, 0.88),
  ];
  const liquidMaterial = new THREE.MeshPhysicalMaterial({
    color: cognac,
    emissive: new THREE.Color(amber),
    emissiveIntensity: 0.12,
    roughness: 0.11,
    metalness: 0.04,
    transmission: 0.2,
    thickness: 1.4,
    transparent: true,
    opacity: 0.7,
    clearcoat: 1,
    clearcoatRoughness: 0.08,
    depthWrite: false,
  });
  const liquidBody = new THREE.Mesh(
    new THREE.LatheGeometry(liquidProfile, compact ? 32 : 56),
    liquidMaterial,
  );
  liquidBody.renderOrder = 1;
  liquid.add(liquidBody);
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
  label.position.set(0, -0.72, 1.08);
  label.renderOrder = 4;
  bottle.add(label);
  bottle.position.set(0, -0.18, 0.1);
  bottle.rotation.y = -0.18;
  bottle.scale.setScalar(0.001);

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
  const handleResize = () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(devicePixelRatio, compact ? 1.2 : 1.5));
    onResize();
  };
  if (finePointer) addEventListener("pointermove", handlePointer, { passive: true });
  addEventListener("resize", handleResize);

  let frame = 0;
  const render = () => {
    if (!document.hidden) {
      core.rotation.y += 0.0018;
      core.rotation.x += 0.0009;
      wire.rotation.y -= 0.0011;
      stars.rotation.y += 0.00012;
      group.rotation.y += (pointer.x * 0.25 - group.rotation.y) * 0.035;
      group.rotation.x += (-pointer.y * 0.18 - group.rotation.x) * 0.035;
      renderer.render(scene, camera);
    }
    frame = requestAnimationFrame(render);
  };
  render();
  const handleVisibility = () => {
    if (!document.hidden) renderer.render(scene, camera);
  };
  document.addEventListener("visibilitychange", handleVisibility);

  return {
    bottle,
    celestial,
    compact,
    group,
    liquid,
    orbitals,
    dispose: () => {
      cancelAnimationFrame(frame);
      if (finePointer) removeEventListener("pointermove", handlePointer);
      removeEventListener("resize", handleResize);
      document.removeEventListener("visibilitychange", handleVisibility);
      renderer.dispose();
      core.geometry.dispose();
      core.material.dispose();
      wire.geometry.dispose();
      wire.material.dispose();
      for (const ring of rings) ring.geometry.dispose();
      ringMaterial.dispose();
      glass.geometry.dispose();
      glassMaterial.dispose();
      liquidBody.geometry.dispose();
      liquidMaterial.dispose();
      rim.geometry.dispose();
      rimMaterial.dispose();
      neckBand.geometry.dispose();
      cork.geometry.dispose();
      corkMaterial.dispose();
      label.geometry.dispose();
      labelMaterial.dispose();
      labelTexture.dispose();
      stars.geometry.dispose();
      stars.material.dispose();
    },
  };
}
