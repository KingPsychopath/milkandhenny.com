import type { Group } from "three";

type ThreeModule = typeof import("three");

export interface PitchNightWorld {
  compact: boolean;
  group: Group;
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
  scene.add(group);

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
  group.add(core);

  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(2.05, 2),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(cream),
      wireframe: true,
      transparent: true,
      opacity: 0.12,
    }),
  );
  group.add(wire);

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
    group.add(ring);
  }

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
    compact,
    group,
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
      stars.geometry.dispose();
      stars.material.dispose();
    },
  };
}
