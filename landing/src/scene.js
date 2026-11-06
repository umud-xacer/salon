// Chronix 3D sahnasi: bitta canvas butun sahifa ortida. Scroll qilinganda bo'limga mos obyekt
// (Chronix soat-halqasi, qaychi, tish, Lor tovush to'lqinlari, spa toshlari) silliq almashadi.
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import gsap from "gsap";

const TAU = Math.PI * 2;

export function createScene(canvas, { reducedMotion = false } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 9);

  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0x6f8cff, 0.35));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 6);
  scene.add(key);
  const rimA = new THREE.PointLight(0x38bdf8, 40, 30);
  rimA.position.set(-5, 2, 3);
  const rimB = new THREE.PointLight(0x7c3aed, 30, 30);
  rimB.position.set(5, -3, 2);
  scene.add(rimA, rimB);

  // ── Yulduzli zarralar ──
  const small = window.innerWidth < 700;
  const COUNT = small ? 700 : 1600;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const palette = [new THREE.Color("#5b9bff"), new THREE.Color("#38bdf8"), new THREE.Color("#a5f3fc"), new THREE.Color("#ffffff")];
  for (let i = 0; i < COUNT; i++) {
    const r = 6 + Math.random() * 18;
    const t = Math.random() * TAU;
    const p = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(p) * Math.cos(t), r * Math.sin(p) * Math.sin(t) * 0.7, r * Math.cos(p) - 6], i * 3);
    palette[i % 4].toArray(col, i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const dotCanvas = document.createElement("canvas");
  dotCanvas.width = dotCanvas.height = 64;
  const dc = dotCanvas.getContext("2d");
  const grd = dc.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  dc.fillStyle = grd;
  dc.fillRect(0, 0, 64, 64);
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({
    map: new THREE.CanvasTexture(dotCanvas), alphaTest: 0.01,
    size: 0.09, vertexColors: true, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  scene.add(stars);

  // ── Materiallar ──
  const mat = {
    brand: new THREE.MeshPhysicalMaterial({ color: "#1f6bff", metalness: 0.2, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, emissive: "#0a2a99", emissiveIntensity: 0.35, iridescence: 0.4 }),
    glow: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#a5f3fc", emissiveIntensity: 1.4 }),
    dark: new THREE.MeshPhysicalMaterial({ color: "#061344", roughness: 0.35, metalness: 0.4, clearcoat: 1 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: "#e6ecff", metalness: 1, roughness: 0.12 }),
    pink: new THREE.MeshPhysicalMaterial({ color: "#ff5fb4", metalness: 0.1, roughness: 0.2, clearcoat: 1, emissive: "#6b0f45", emissiveIntensity: 0.4 }),
    violet: new THREE.MeshPhysicalMaterial({ color: "#a78bfa", roughness: 0.25, clearcoat: 1 }),
    enamel: new THREE.MeshPhysicalMaterial({ color: "#f7fbff", roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.6, sheenColor: "#bff3ff" }),
    mint: new THREE.MeshPhysicalMaterial({ color: "#5eead4", roughness: 0.15, transmission: 0.6, thickness: 0.6, clearcoat: 1, transparent: true }),
    blue: new THREE.MeshPhysicalMaterial({ color: "#60a5fa", roughness: 0.2, clearcoat: 1, emissive: "#1d4ed8", emissiveIntensity: 0.35 }),
    wave: new THREE.MeshBasicMaterial({ color: "#7dd3fc", transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending }),
    stone: new THREE.MeshPhysicalMaterial({ color: "#2b3350", roughness: 0.55, clearcoat: 0.6, clearcoatRoughness: 0.3 }),
    stoneLight: new THREE.MeshPhysicalMaterial({ color: "#cfd6e6", roughness: 0.6, clearcoat: 0.4 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: "#4ade80", roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide, emissive: "#14532d", emissiveIntensity: 0.4 }),
    water: new THREE.MeshPhysicalMaterial({ color: "#86efac", transmission: 0.8, roughness: 0.05, thickness: 0.3, transparent: true, opacity: 0.8 }),
  };

  const groups = {};
  const tickers = [];

  // ══ HERO: Chronix "C" halqasi va soat ══
  {
    const g = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.46, 64, 200, TAU * 0.8), mat.brand);
    ring.rotation.z = TAU * 0.1;                       // ochiq tomoni o'ngda — "C"
    g.add(ring);
    const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.12, 64), mat.dark);
    dial.rotation.x = Math.PI / 2;
    g.add(dial);
    for (let i = 0; i < 12; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(i % 3 ? 0.03 : 0.05, i % 3 ? 0.1 : 0.18, 0.04), mat.glow);
      const a = (i / 12) * TAU;
      tick.position.set(Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0.08);
      tick.rotation.z = -a;
      g.add(tick);
    }
    const handGeo = (len, w) => { const b = new THREE.BoxGeometry(w, len, 0.04); b.translate(0, len / 2, 0); return b; };
    const hour = new THREE.Mesh(handGeo(0.48, 0.07), mat.glow);
    const minute = new THREE.Mesh(handGeo(0.72, 0.05), mat.glow);
    hour.position.z = 0.1; minute.position.z = 0.12;
    hour.rotation.z = -TAU * 0.33; minute.rotation.z = TAU * 0.17;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 24), mat.glow);
    hub.position.z = 0.14;
    g.add(hour, minute, hub);
    // orbitadagi bronlar
    const orbit = new THREE.Group();
    const dotMats = [mat.pink, mat.mint, mat.blue, mat.leaf];
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 32), dotMats[i]);
      const a = (i / 4) * TAU;
      s.position.set(Math.cos(a) * 2.6, Math.sin(a) * 0.9, Math.sin(a) * 1.4);
      orbit.add(s);
    }
    orbit.rotation.x = 0.35;
    g.add(orbit);
    tickers.push((t, dt) => {
      minute.rotation.z -= dt * 0.9;
      hour.rotation.z -= dt * 0.075;
      orbit.rotation.y += dt * 0.35;
      ring.rotation.y = Math.sin(t * 0.6) * 0.18;
    });
    groups.hero = g;
  }

  // ══ SALON: qaychi + lak flakoni ══
  {
    const g = new THREE.Group();
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, -0.09);
    bladeShape.quadraticCurveTo(1.4, -0.12, 2.3, 0);
    bladeShape.quadraticCurveTo(1.4, 0.14, 0, 0.11);
    bladeShape.lineTo(0, -0.09);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 });
    bladeGeo.translate(0, 0, -0.025);
    const makeArm = (flip, m) => {
      const arm = new THREE.Group();
      const blade = new THREE.Mesh(bladeGeo, mat.chrome);
      if (flip) blade.scale.y = -1;
      arm.add(blade);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 16), mat.chrome);
      stem.rotation.z = Math.PI / 2;
      stem.position.x = -0.35;
      arm.add(stem);
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 24, 64), m);
      loop.position.set(-0.98, flip ? -0.18 : 0.18, 0);
      arm.add(loop);
      arm.position.z = flip ? -0.05 : 0.05;
      return arm;
    };
    const a = makeArm(false, mat.pink);
    const b = makeArm(true, mat.violet);
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 24), mat.glow);
    pivot.rotation.x = Math.PI / 2;
    const scissors = new THREE.Group();
    scissors.add(a, b, pivot);
    scissors.position.x = -0.2;
    scissors.rotation.z = 0.5;
    g.add(scissors);
    // lak flakoni
    const bottle = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.7, 48), mat.pink);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.62, 32), mat.dark);
    cap.position.y = 0.66;
    bottle.add(glass, cap);
    bottle.position.set(1.3, -1.45, 0.4);
    bottle.rotation.z = -0.25;
    g.add(bottle);
    const sparkles = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.08 + Math.random() * 0.06), mat.glow);
      s.position.set((Math.random() - 0.5) * 3.6, (Math.random() - 0.5) * 3, (Math.random() - 0.5) * 1.5);
      sparkles.add(s);
    }
    g.add(sparkles);
    tickers.push((t) => {
      const open = 0.18 + Math.sin(t * 2.2) * 0.16;
      a.rotation.z = open; b.rotation.z = -open;
      bottle.position.y = -1.45 + Math.sin(t * 1.3) * 0.12;
      sparkles.children.forEach((s, i) => { s.rotation.y = t * (1 + i * 0.2); s.scale.setScalar(0.7 + Math.sin(t * 3 + i) * 0.3); });
    });
    groups.salon = g;
  }

  // ══ STOMATOLOGIYA: tish ══
  {
    const g = new THREE.Group();
    const parts = [];
    const crown = new THREE.SphereGeometry(1, 64, 48);
    crown.scale(1.12, 0.72, 0.95);
    parts.push(crown);
    [[-0.45, 0.32], [0.45, 0.32], [-0.45, -0.32], [0.45, -0.32]].forEach(([x, z]) => {
      const cusp = new THREE.SphereGeometry(0.4, 32, 24);
      cusp.scale(1, 0.8, 1);
      cusp.translate(x, 0.4, z);
      parts.push(cusp);
    });
    [[-0.5, 0.32], [0.5, -0.32]].forEach(([x, tilt]) => {
      const root = new THREE.CylinderGeometry(0.4, 0.1, 1.6, 32, 4);
      root.translate(0, -0.8, 0);
      root.rotateZ(tilt);
      root.translate(x, -0.2, 0);
      parts.push(root);
    });
    const tooth = new THREE.Mesh(mergeGeometries(parts.map((p) => p.toNonIndexed())), mat.enamel);
    tooth.geometry.computeVertexNormals();
    tooth.position.y = 0.35;
    g.add(tooth);
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.03, 16, 160), mat.mint);
    halo.rotation.x = Math.PI / 2.3;
    g.add(halo);
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.015, 16, 160), mat.glow);
    halo2.rotation.x = Math.PI / 1.8;
    g.add(halo2);
    const gems = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), mat.mint);
      const a = (i / 5) * TAU;
      s.position.set(Math.cos(a) * 1.9, Math.sin(a * 2) * 0.3, Math.sin(a) * 1.9);
      gems.add(s);
    }
    halo.add(gems);
    gems.rotation.x = -Math.PI / 2.3;
    tickers.push((t, dt) => {
      tooth.rotation.y += dt * 0.5;
      tooth.position.y = 0.35 + Math.sin(t * 1.4) * 0.1;
      halo.rotation.z += dt * 0.4;
      halo2.rotation.z -= dt * 0.25;
    });
    groups.dental = g;
  }

  // ══ LOR: quloq spirali va tovush to'lqinlari ══
  {
    const g = new THREE.Group();
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const a = -0.6 + u * TAU * 1.05;
      const r = 1.45 - u * 1.0;
      pts.push(new THREE.Vector3(Math.cos(a) * r * 0.85, Math.sin(a) * r * 1.2 + 0.1, Math.sin(u * Math.PI) * 0.35));
    }
    const ear = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.22, 32, false), mat.blue);
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), mat.blue);
    lobe.position.copy(pts[0]);
    const canal = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), mat.glow);
    canal.position.copy(pts[80]).setZ(0.25);
    const earG = new THREE.Group();
    earG.add(ear, lobe, canal);
    earG.position.x = -0.6;
    g.add(earG);
    const waves = [];
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 12, 120, Math.PI * 0.7), mat.wave.clone());
      w.rotation.z = -Math.PI * 0.35;
      w.position.x = 0.2;
      g.add(w);
      waves.push(w);
    }
    tickers.push((t) => {
      waves.forEach((w, i) => {
        const p = (t * 0.45 + i / waves.length) % 1;
        w.scale.setScalar(0.6 + p * 2.4);
        w.material.opacity = (1 - p) * 0.75;
      });
      earG.rotation.y = Math.sin(t * 0.7) * 0.35;
      canal.material.emissiveIntensity = 1.2 + Math.sin(t * 4) * 0.5;
    });
    groups.ent = g;
  }

  // ══ SPA: zen toshlari, barg va suv ══
  {
    const g = new THREE.Group();
    const stones = new THREE.Group();
    const sizes = [[1.15, 0.38], [0.92, 0.33], [0.72, 0.28], [0.5, 0.24]];
    let y = -1.3;
    sizes.forEach(([r, h], i) => {
      const geo = new THREE.SphereGeometry(1, 48, 32);
      geo.scale(r, h, r * 0.92);
      const s = new THREE.Mesh(geo, i % 2 ? mat.stoneLight : mat.stone);
      y += h * (i === 0 ? 1 : 1.75);
      s.position.y = y;
      s.rotation.y = i * 0.7;
      s.rotation.z = (i % 2 ? -1 : 1) * 0.05;
      stones.add(s);
    });
    g.add(stones);
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.5, 0.35, 0.9, 0.9, 0, 1.9);
    leafShape.bezierCurveTo(-0.9, 0.9, -0.5, 0.35, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    const leaves = new THREE.Group();
    [[0.4, -0.6, 0.3], [-0.2, 0.5, 0.75]].forEach(([rz, rx, s], i) => {
      const l = new THREE.Mesh(leafGeo, mat.leaf);
      l.scale.setScalar(s);
      l.rotation.set(rx, 0, rz);
      l.position.set(i ? -0.35 : 0.25, y + 0.15, 0);
      leaves.add(l);
    });
    g.add(leaves);
    const ripples = [];
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 120), mat.water.clone());
      r.rotation.x = Math.PI / 2;
      r.position.y = -1.35;
      g.add(r);
      ripples.push(r);
    }
    tickers.push((t) => {
      stones.rotation.y = Math.sin(t * 0.4) * 0.3;
      leaves.rotation.y = Math.sin(t * 0.9) * 0.25;
      leaves.position.y = Math.sin(t * 1.2) * 0.06;
      ripples.forEach((r, i) => {
        const p = (t * 0.3 + i / 3) % 1;
        r.scale.setScalar(1.2 + p * 1.8);
        r.material.opacity = (1 - p) * 0.8;
      });
    });
    groups.spa = g;
  }

  // Bo'lim → obyekt; "features" va "cta" uchun Chronix halqasi qaytadi
  const alias = { features: "hero", cta: "hero" };
  const state = {};
  Object.entries(groups).forEach(([name, g]) => {
    const holder = new THREE.Group();
    holder.add(g);
    holder.visible = false;
    scene.add(holder);
    state[name] = { holder, inner: g, mix: 0, side: 1, dim: 0 };
  });

  let current = null;
  let side = 1;
  let dim = 0;
  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  let scrollSpin = 0;

  let anchor = null;      // mobil: obyekt shu bo'lim bilan birga scroll qiladi
  function show(name, opts = {}) {
    anchor = opts.el ?? null;
    const target = name ? alias[name] ?? name : null;
    if (!target) {
      if (current) gsap.to(state[current], { mix: 0, duration: 0.7, ease: "power2.in" });
      current = null;
      return;
    }
    side = opts.side ?? side;
    dim = opts.dim ?? 0;
    if (target === current) {
      gsap.to(state[target], { side, dim, duration: 1.1, ease: "power3.inOut" });
      return;
    }
    if (current) gsap.to(state[current], { mix: 0, duration: 0.7, ease: "power2.in" });
    current = target;
    const s = state[target];
    s.side = side;
    gsap.to(s, { mix: 1, dim, duration: 1.3, ease: "expo.out", delay: 0.15 });
  }

  function layout() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  layout();
  window.addEventListener("resize", layout);
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  const clock = new THREE.Clock();
  const speed = reducedMotion ? 0.25 : 1;
  let running = true;
  let t = 0;

  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05) * speed;
    t += dt;
    tickers.forEach((fn) => fn(t, dt));
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;

    const mobile = window.innerWidth < 860;
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const visW = visH * camera.aspect;
    let mobileY = 1.6;
    if (mobile && anchor) {
      const py = anchor.getBoundingClientRect().top + window.innerHeight * 0.23;
      mobileY = (0.5 - py / window.innerHeight) * visH;
    }
    Object.values(state).forEach((s) => {
      s.holder.visible = s.mix > 0.002;
      if (!s.holder.visible) return;
      const base = mobile ? Math.min(0.55, visW / 7) : Math.min(1, visW / 13);
      const sc = base * (0.6 + 0.4 * s.mix) * (1 - s.dim * 0.35);
      s.holder.scale.setScalar(Math.max(sc * s.mix, 0.0001));
      const x = mobile ? 0 : s.side * visW * 0.24;
      const y = mobile ? (s.dim ? 0 : mobileY) : 0;
      s.holder.position.set(x, y + (1 - s.mix) * -1.2, (1 - s.mix) * -3);
      s.holder.rotation.set(mouse.y * 0.25, mouse.x * 0.4 + (1 - s.mix) * 1.6 + scrollSpin, 0);
    });
    stars.rotation.y = t * 0.012 + mouse.x * 0.05;
    stars.rotation.x = mouse.y * 0.03;
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener("visibilitychange", () => {
    const hidden = document.hidden;
    if (hidden) running = false;
    else if (!running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
  });

  return {
    show,
    setSpin: (v) => { scrollSpin = v; },
    setStarsDrift: (v) => { stars.position.y = v; },
  };
}
