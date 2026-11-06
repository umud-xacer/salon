// Chronix 3D sahnasi (v2): bitta canvas butun sahifa ortida.
// Har bir obyekt O'Z BO'LIMIGA bog'langan va scroll bilan boshqariladi (vaqt bo'yicha emas):
//   bo'lim ekranga kirganda obyekt bo'laklari turli tomondan uchib kelib yig'iladi,
//   chiqayotganda tarqab ketadi. Ko'rinish oynalari kesishmaydi — ikki obyekt hech qachon ustma-ust bo'lmaydi.
// Fon: aurora shader (rang bo'limga qarab almashadi) + bloom (faqat kompyuterda).
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

const TAU = Math.PI * 2;
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);

function dotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.6)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/**
 * @param canvas  fon canvas
 * @param opts.sections  [{ el, group, side, accent, dim }] — sahifa bo'limlari
 * @param opts.onFrame   har kadrda: { hero: {x, y, r, mix} } — DOM kartalarini obyektga bog'lash uchun
 */
export function createScene(canvas, { sections, reducedMotion = false, onFrame } = {}) {
  const mobile = () => window.innerWidth < 860;
  const lowPower = window.innerWidth < 860 || (navigator.hardwareConcurrency ?? 8) <= 4;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !lowPower, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, lowPower ? 1.5 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // ── Fon: aurora ──
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgU = {
    uTime: { value: 0 }, uAspect: { value: 1 }, uMouse: { value: new THREE.Vector2() },
    uBase: { value: new THREE.Color("#0a0a0b") }, uA: { value: new THREE.Color("#3a3a42") },
    uB: { value: new THREE.Color("#1a2a55") }, uPulse: { value: 0 },
  };
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bgU, depthTest: false, depthWrite: false,
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }",
    fragmentShader: `
      uniform float uTime, uAspect, uPulse; uniform vec2 uMouse; uniform vec3 uBase, uA, uB; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.-2.*f);
        return mix(mix(h(i), h(i+vec2(1,0)), u.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), u.x), u.y); }
      float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++){ v += a*n(p); p *= 2.03; a *= .5; } return v; }
      void main(){
        vec2 p = (vUv - .5) * vec2(uAspect, 1.);
        float t = uTime * .05;
        float q = fbm(p * 1.4 + vec2(t, -t * .6));
        float r = fbm(p * 2.2 + q * 1.6 - vec2(t * .5, t));
        vec2 m = uMouse * vec2(uAspect, 1.) * .5;
        vec2 ca = vec2(.38 * uAspect, .22) + vec2(sin(t * 4.) * .08, cos(t * 3.) * .06) + m * .12;
        vec2 cb = vec2(-.42 * uAspect, -.3) + vec2(cos(t * 3.4) * .1, sin(t * 2.6) * .08) - m * .08;
        float a = smoothstep(1.05, 0., length(p - ca)) ;
        float b = smoothstep(1.15, 0., length(p - cb));
        vec3 col = uBase;
        col += uA * a * (.13 + .26 * r) * (1. + uPulse * .5);
        col += uB * b * (.10 + .2 * q);
        // aurora tasmalari
        float band = smoothstep(.55, .8, fbm(vec2(p.x * 1.2 + t * 2., p.y * 5. + q * 2.)));
        col += mix(uA, vec3(.65, .9, 1.), .3) * band * .035;
        col *= 1. - .45 * length(vUv - .5);
        gl_FragColor = vec4(col, 1.);
        #include <colorspace_fragment>
      }`,
  })));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0, 9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0xffffff, 0.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(4, 6, 6);
  scene.add(key);
  const rimA = new THREE.PointLight(0x9fbfff, 40, 30);
  rimA.position.set(-5, 2, 3);
  const rimB = new THREE.PointLight(0xffffff, 18, 30);
  rimB.position.set(5, -3, 2);
  scene.add(rimA, rimB);

  // ── Kompozitor (bloom) ──
  let composer = null;
  let bloom = null;
  if (!lowPower && !reducedMotion) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(bgScene, bgCam));
    const main = new RenderPass(scene, camera);
    main.clear = false;
    main.clearDepth = true;
    composer.addPass(main);
    bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.42, 0.45, 0.92);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
  } else {
    renderer.autoClear = false;
  }

  const dot = dotTexture();

  // ── Yulduzlar: scroll tezligida cho'ziladi ──
  const COUNT = lowPower ? 700 : 1800;
  const pos = new Float32Array(COUNT * 3);
  const col = new Float32Array(COUNT * 3);
  const pal = ["#ffffff", "#c9c9cf", "#8e8e96", "#7fb0ff"].map((c) => new THREE.Color(c));
  for (let i = 0; i < COUNT; i++) {
    const r = 6 + Math.random() * 20;
    const th = Math.random() * TAU;
    const ph = Math.acos(2 * Math.random() - 1);
    pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.7, r * Math.cos(ph) - 8], i * 3);
    pal[i % 4].toArray(col, i * 3);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  const starMat = new THREE.PointsMaterial({
    map: dot, size: 0.09, vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  // ── Materiallar ──
  // Monoxrom palitra: xrom, oq keramika, grafit; yagona urg'u — Chronix ko'ki (faqat nurli detallar)
  const M = {
    brand: new THREE.MeshPhysicalMaterial({ color: "#2f6bff", metalness: 0.25, roughness: 0.14, clearcoat: 1, clearcoatRoughness: 0.05, emissive: "#0b2a8a", emissiveIntensity: 0.35 }),
    glow: new THREE.MeshStandardMaterial({ color: "#ffffff", emissive: "#ffffff", emissiveIntensity: 1.8 }),
    dark: new THREE.MeshPhysicalMaterial({ color: "#121214", roughness: 0.3, metalness: 0.5, clearcoat: 1 }),
    chrome: new THREE.MeshPhysicalMaterial({ color: "#dcdce0", metalness: 1, roughness: 0.12 }),
    pink: new THREE.MeshPhysicalMaterial({ color: "#e4e4e7", roughness: 0.22, clearcoat: 1, envMapIntensity: 0.8 }),
    violet: new THREE.MeshPhysicalMaterial({ color: "#2a2a2f", roughness: 0.32, metalness: 0.3, clearcoat: 1 }),
    enamel: new THREE.MeshPhysicalMaterial({ color: "#d6d6d9", envMapIntensity: 0.55, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 }),
    mint: new THREE.MeshPhysicalMaterial({ color: "#3d84ff", roughness: 0.12, clearcoat: 1, emissive: "#1d4ed8", emissiveIntensity: 0.5 }),
    blue: new THREE.MeshPhysicalMaterial({ color: "#d9d9dc", roughness: 0.2, clearcoat: 1, envMapIntensity: 0.75 }),
    waveGlow: new THREE.MeshStandardMaterial({ color: "#7fb0ff", emissive: "#5b9bff", emissiveIntensity: 2.2 }),
    stone: new THREE.MeshPhysicalMaterial({ color: "#1d1d21", roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    stoneLight: new THREE.MeshPhysicalMaterial({ color: "#8c8c92", envMapIntensity: 0.6, roughness: 0.5, clearcoat: 0.4 }),
    leaf: new THREE.MeshPhysicalMaterial({ color: "#3d84ff", roughness: 0.25, clearcoat: 1, side: THREE.DoubleSide, emissive: "#1d4ed8", emissiveIntensity: 0.35 }),
  };
  const additive = (color, opacity = 0.7) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending });

  // Har bir obyekt: bo'laklar ("parts") — har biri o'z yo'nalishidan uchib keladi
  const groups = {};
  function makeGroup(name, radius) {
    const inner = new THREE.Group();
    const holder = new THREE.Group();
    holder.add(inner);
    holder.visible = false;
    scene.add(holder);
    const parts = [];
    const tickers = [];
    const part = (obj, dir) => {
      const w = new THREE.Group();
      w.add(obj);
      inner.add(w);
      const d = dir ?? new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.6 + 0.2);
      parts.push({ w, dir: d.normalize(), spin: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(4), delay: parts.length * 0.06 });
      return obj;
    };
    groups[name] = { holder, inner, parts, tickers, radius, mix: 0, p: 0, side: 1, dim: 0, anchorY: 0 };
    return { inner, part, tick: (fn) => tickers.push(fn) };
  }

  // ══ HERO: Chronix "C" halqasi, soat, orbitadagi zarralar ══
  {
    const { part, tick } = makeGroup("hero", 2.1);
    const ring = part(new THREE.Mesh(new THREE.TorusGeometry(1.55, 0.46, 64, 220, TAU * 0.8), M.brand), new THREE.Vector3(0, 0, -1));
    ring.rotation.z = TAU * 0.1;
    const dial = new THREE.Group();
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.98, 0.98, 0.12, 64), M.dark);
    face.rotation.x = Math.PI / 2;
    dial.add(face);
    for (let i = 0; i < 12; i++) {
      const tk = new THREE.Mesh(new THREE.BoxGeometry(i % 3 ? 0.03 : 0.05, i % 3 ? 0.1 : 0.18, 0.04), M.glow);
      const a = (i / 12) * TAU;
      tk.position.set(Math.sin(a) * 0.8, Math.cos(a) * 0.8, 0.08);
      tk.rotation.z = -a;
      dial.add(tk);
    }
    const handGeo = (len, w) => { const b = new THREE.BoxGeometry(w, len, 0.04); b.translate(0, len / 2, 0); return b; };
    const hour = new THREE.Mesh(handGeo(0.48, 0.07), M.glow);
    const minute = new THREE.Mesh(handGeo(0.72, 0.05), M.glow);
    hour.position.z = 0.1; minute.position.z = 0.12;
    hour.rotation.z = -TAU * 0.33; minute.rotation.z = TAU * 0.17;
    const hub = new THREE.Mesh(new THREE.SphereGeometry(0.07, 24, 24), M.glow);
    hub.position.z = 0.14;
    dial.add(hour, minute, hub);
    part(dial, new THREE.Vector3(0, 0, 1));
    // orbitadagi chang (zarralar halqasi)
    const N = 420;
    const dust = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = Math.random() * TAU;
      const r = 2.25 + (Math.random() - 0.5) * 0.5;
      dust.set([Math.cos(a) * r, (Math.random() - 0.5) * 0.12, Math.sin(a) * r], i * 3);
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dust, 3));
    const dustPts = part(new THREE.Points(dg, new THREE.PointsMaterial({ map: dot, size: 0.06, color: "#e6e6ea", transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending })), new THREE.Vector3(1, 0.4, 0));
    dustPts.rotation.x = 0.42;
    const orbit = new THREE.Group();
    [M.pink, M.mint, M.violet, M.chrome].forEach((m, i) => {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 32, 32), m);
      const a = (i / 4) * TAU;
      s.position.set(Math.cos(a) * 2.25, 0, Math.sin(a) * 2.25);
      orbit.add(s);
    });
    orbit.rotation.x = 0.42;
    part(orbit, new THREE.Vector3(-1, 0.3, 0));
    tick((t, dt) => {
      minute.rotation.z -= dt * 0.9;
      hour.rotation.z -= dt * 0.075;
      orbit.rotation.y += dt * 0.35;
      dustPts.rotation.y -= dt * 0.08;
      ring.rotation.y = Math.sin(t * 0.6) * 0.18;
    });
  }

  // ══ SALON: qaychi, taroq, lak, uchqunlar ══
  {
    const { part, tick } = makeGroup("salon", 2.2);
    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, -0.09);
    bladeShape.quadraticCurveTo(1.4, -0.12, 2.3, 0);
    bladeShape.quadraticCurveTo(1.4, 0.14, 0, 0.11);
    bladeShape.lineTo(0, -0.09);
    const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.05, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 3 });
    bladeGeo.translate(0, 0, -0.025);
    const arm = (flip, m) => {
      const g = new THREE.Group();
      const blade = new THREE.Mesh(bladeGeo, M.chrome);
      if (flip) blade.scale.y = -1;
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.7, 16), M.chrome);
      stem.rotation.z = Math.PI / 2;
      stem.position.x = -0.35;
      const loop = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.08, 24, 64), m);
      loop.position.set(-0.98, flip ? -0.18 : 0.18, 0);
      g.add(blade, stem, loop);
      g.position.z = flip ? -0.05 : 0.05;
      return g;
    };
    const a = arm(false, M.pink);
    const b = arm(true, M.violet);
    const pivot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.24, 24), M.glow);
    pivot.rotation.x = Math.PI / 2;
    const scissors = new THREE.Group();
    scissors.add(a, b, pivot);
    scissors.position.set(-0.3, 0.35, 0);
    scissors.rotation.z = 0.5;
    part(scissors, new THREE.Vector3(-1, 0.5, 0.3));
    // taroq
    const comb = new THREE.Group();
    const spine = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.22, 0.08), M.violet);
    comb.add(spine);
    for (let i = 0; i < 16; i++) {
      const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.42, 0.06), M.violet);
      tooth.position.set(-0.9 + i * 0.12, -0.3, 0);
      comb.add(tooth);
    }
    comb.position.set(-0.6, -1.35, -0.4);
    comb.rotation.set(0.2, 0.3, -0.15);
    part(comb, new THREE.Vector3(-0.6, -1, 0));
    // lak flakoni
    const bottle = new THREE.Group();
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.36, 0.7, 48), M.pink);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.62, 32), M.dark);
    cap.position.y = 0.66;
    bottle.add(glass, cap);
    bottle.position.set(1.45, -0.9, 0.4);
    bottle.rotation.z = -0.25;
    part(bottle, new THREE.Vector3(1, -0.4, 0.2));
    const sparkles = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07 + Math.random() * 0.06), M.glow);
      s.position.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 3.4, (Math.random() - 0.5) * 1.5);
      sparkles.add(s);
    }
    part(sparkles, new THREE.Vector3(0, 1, 0));
    tick((t) => {
      const open = 0.2 + Math.sin(t * 2.4) * 0.17;
      a.rotation.z = open; b.rotation.z = -open;
      bottle.position.y = -0.9 + Math.sin(t * 1.3) * 0.12;
      comb.position.y = -1.35 + Math.sin(t * 1.1 + 1) * 0.08;
      sparkles.children.forEach((s, i) => { s.rotation.y = t * (1 + i * 0.2); s.scale.setScalar(0.6 + Math.abs(Math.sin(t * 2 + i)) * 0.6); });
    });
  }

  // ══ STOMATOLOGIYA: tish, halqalar, yaltirash ══
  {
    const { part, tick } = makeGroup("dental", 2.2);
    const geos = [];
    const crown = new THREE.SphereGeometry(1, 64, 48);
    crown.scale(1.12, 0.72, 0.95);
    geos.push(crown);
    [[-0.45, 0.32], [0.45, 0.32], [-0.45, -0.32], [0.45, -0.32]].forEach(([x, z]) => {
      const c = new THREE.SphereGeometry(0.4, 32, 24);
      c.scale(1, 0.8, 1);
      c.translate(x, 0.4, z);
      geos.push(c);
    });
    [[-0.5, 0.32], [0.5, -0.32]].forEach(([x, tilt]) => {
      const r = new THREE.CylinderGeometry(0.4, 0.1, 1.6, 32, 4);
      r.translate(0, -0.8, 0);
      r.rotateZ(tilt);
      r.translate(x, -0.2, 0);
      geos.push(r);
    });
    const tooth = new THREE.Mesh(mergeGeometries(geos.map((g) => g.toNonIndexed())), M.enamel);
    tooth.geometry.computeVertexNormals();
    tooth.position.y = 0.35;
    part(tooth, new THREE.Vector3(0, -1, 0.4));
    const halo = new THREE.Mesh(new THREE.TorusGeometry(1.9, 0.035, 16, 200), M.mint);
    halo.rotation.x = Math.PI / 2.3;
    part(halo, new THREE.Vector3(1, 0, 0));
    const halo2 = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.012, 16, 200), M.glow);
    halo2.rotation.x = Math.PI / 1.8;
    part(halo2, new THREE.Vector3(-1, 0, 0));
    const gems = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.IcosahedronGeometry(0.15, 0), M.mint);
      const a = (i / 6) * TAU;
      s.position.set(Math.cos(a) * 1.9, Math.sin(a * 2) * 0.25, Math.sin(a) * 1.9);
      gems.add(s);
    }
    gems.rotation.x = 0.25;
    part(gems, new THREE.Vector3(0, 1, 0));
    // yaltirash yulduzchasi
    const star = new THREE.Group();
    [0, Math.PI / 2].forEach((r) => {
      const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.32), M.glow);
      s.scale.set(0.12, 1, 0.12);
      s.rotation.z = r;
      star.add(s);
    });
    star.position.set(0.75, 1.05, 0.7);
    part(star, new THREE.Vector3(1, 1, 0));
    tick((t, dt) => {
      tooth.rotation.y += dt * 0.5;
      tooth.position.y = 0.35 + Math.sin(t * 1.4) * 0.1;
      halo.rotation.z += dt * 0.4;
      halo2.rotation.z -= dt * 0.25;
      gems.rotation.y += dt * 0.3;
      const glint = Math.pow(Math.max(0, Math.sin(t * 1.6)), 8);
      star.scale.setScalar(0.2 + glint * 1.1);
      star.rotation.z = t * 0.8;
    });
  }

  // ══ LOR: quloq spirali, tovush to'lqinlari, audiogramma ══
  {
    const { part, tick } = makeGroup("ent", 2.2);
    const pts = [];
    for (let i = 0; i <= 80; i++) {
      const u = i / 80;
      const a = -0.6 + u * TAU * 1.05;
      const r = 1.45 - u * 1.0;
      pts.push(new THREE.Vector3(Math.cos(a) * r * 0.85, Math.sin(a) * r * 1.2 + 0.1, Math.sin(u * Math.PI) * 0.35));
    }
    const earG = new THREE.Group();
    earG.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.22, 32, false), M.blue));
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(0.34, 32, 32), M.blue);
    lobe.position.copy(pts[0]);
    const canal = new THREE.Mesh(new THREE.SphereGeometry(0.2, 32, 32), M.glow);
    canal.position.copy(pts[80]).setZ(0.25);
    earG.add(lobe, canal);
    earG.position.x = -0.7;
    part(earG, new THREE.Vector3(-1, 0, 0.2));
    const waves = [];
    const waveG = new THREE.Group();
    for (let i = 0; i < 4; i++) {
      const w = new THREE.Mesh(new THREE.TorusGeometry(1, 0.025, 12, 120, Math.PI * 0.7), additive("#cfd8ff", 0.55));
      w.rotation.z = -Math.PI * 0.35;
      waveG.add(w);
      waves.push(w);
    }
    waveG.position.x = 0.1;
    part(waveG, new THREE.Vector3(1, 0, 0));
    // audiogramma: nurli nuqtalar to'lqini
    const D = 70;
    const dots = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 10, 10), M.waveGlow, D);
    const dm = new THREE.Object3D();
    part(dots, new THREE.Vector3(0, -1, 0));
    tick((t) => {
      waves.forEach((w, i) => {
        const p = (t * 0.45 + i / waves.length) % 1;
        w.scale.setScalar(0.6 + p * 2.4);
        w.material.opacity = (1 - p) * 0.75;
      });
      for (let i = 0; i < D; i++) {
        const x = -2 + (i / (D - 1)) * 4;
        const env = Math.sin((i / (D - 1)) * Math.PI);
        dm.position.set(x, -1.9 + Math.sin(x * 3.2 - t * 4) * 0.28 * env * (0.6 + 0.4 * Math.sin(t * 1.3)), 0.3);
        dm.scale.setScalar(0.6 + env * 0.8);
        dm.updateMatrix();
        dots.setMatrixAt(i, dm.matrix);
      }
      dots.instanceMatrix.needsUpdate = true;
      earG.rotation.y = Math.sin(t * 0.7) * 0.35;
      canal.material.emissiveIntensity = 1.8 + Math.sin(t * 4) * 0.8;
    });
  }

  // ══ SPA: zen toshlari, barglar, suv to'lqinlari, bug' ══
  {
    const { part, tick } = makeGroup("spa", 2.2);
    const sizes = [[1.15, 0.38], [0.92, 0.33], [0.72, 0.28], [0.5, 0.24]];
    let y = -1.3;
    const stones = [];
    sizes.forEach(([r, h], i) => {
      const geo = new THREE.SphereGeometry(1, 48, 32);
      geo.scale(r, h, r * 0.92);
      const s = new THREE.Mesh(geo, i % 2 ? M.stoneLight : M.stone);
      y += h * (i === 0 ? 1 : 1.75);
      s.position.y = y;
      s.rotation.y = i * 0.7;
      stones.push(part(s, new THREE.Vector3(i % 2 ? 1 : -1, 0.3 * i, 0.2)));
    });
    const top = y;
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.bezierCurveTo(0.5, 0.35, 0.9, 0.9, 0, 1.9);
    leafShape.bezierCurveTo(-0.9, 0.9, -0.5, 0.35, 0, 0);
    const leafGeo = new THREE.ExtrudeGeometry(leafShape, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, bevelSegments: 2 });
    const leaves = new THREE.Group();
    [[0.4, -0.6, 0.3], [-0.2, 0.5, 0.75]].forEach(([rz, rx, s], i) => {
      const l = new THREE.Mesh(leafGeo, M.leaf);
      l.scale.setScalar(s);
      l.rotation.set(rx, 0, rz);
      l.position.set(i ? -0.35 : 0.25, top + 0.15, 0);
      leaves.add(l);
    });
    part(leaves, new THREE.Vector3(0, 1, 0));
    const ripples = [];
    const rg = new THREE.Group();
    for (let i = 0; i < 3; i++) {
      const r = new THREE.Mesh(new THREE.TorusGeometry(1, 0.02, 8, 140), additive("#d8d8de", 0.6));
      r.rotation.x = Math.PI / 2;
      r.position.y = -1.35;
      rg.add(r);
      ripples.push(r);
    }
    part(rg, new THREE.Vector3(0, -1, 0));
    // bug' zarralari
    const S = 60;
    const steamPos = new Float32Array(S * 3);
    const seeds = [];
    for (let i = 0; i < S; i++) seeds.push({ x: (Math.random() - 0.5) * 1.4, z: (Math.random() - 0.5) * 0.8, o: Math.random() });
    const sg = new THREE.BufferGeometry();
    sg.setAttribute("position", new THREE.BufferAttribute(steamPos, 3));
    const steam = part(new THREE.Points(sg, new THREE.PointsMaterial({ map: dot, size: 0.28, color: "#ffffff", transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending })), new THREE.Vector3(0, 1, 0.3));
    tick((t) => {
      stones.forEach((s, i) => { s.rotation.y = i * 0.7 + Math.sin(t * 0.4 + i) * 0.15; });
      leaves.rotation.y = Math.sin(t * 0.9) * 0.25;
      leaves.position.y = Math.sin(t * 1.2) * 0.06;
      ripples.forEach((r, i) => {
        const p = (t * 0.3 + i / 3) % 1;
        r.scale.setScalar(1.2 + p * 1.8);
        r.material.opacity = (1 - p) * 0.8;
      });
      seeds.forEach((s, i) => {
        const p = (t * 0.12 + s.o) % 1;
        steamPos.set([s.x + Math.sin(t + i) * 0.15 * p, top + 0.6 + p * 2.2, s.z], i * 3);
      });
      sg.attributes.position.needsUpdate = true;
      steam.material.opacity = 0.35;
    });
  }

  // ── O'lcham ──
  let W = 1;
  let H = 1;
  function layout() {
    W = window.innerWidth;
    H = window.innerHeight;
    renderer.setSize(W, H, false);
    composer?.setSize(W, H);
    bloom?.resolution.set(W / 2, H / 2);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    bgU.uAspect.value = W / H;
  }
  layout();
  window.addEventListener("resize", layout);

  const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
  window.addEventListener("pointermove", (e) => {
    mouse.tx = (e.clientX / window.innerWidth) * 2 - 1;
    mouse.ty = (e.clientY / window.innerHeight) * 2 - 1;
  }, { passive: true });

  // ── Bo'limlar → har bir obyekt uchun ko'rinish (scroll bilan) ──
  const accentTarget = new THREE.Color();
  const tmpC = new THREE.Color();
  const baseAccent = new THREE.Color("#3a3a42");
  let lastScroll = window.scrollY;
  let vel = 0;

  function measure() {
    Object.values(groups).forEach((g) => { g.mix = 0; });
    accentTarget.set(0, 0, 0);
    let wsum = 0;
    for (const s of sections) {
      const r = s.el.getBoundingClientRect();
      if (r.bottom < -H || r.top > 2 * H) continue;
      const g = groups[s.group];
      let v;
      let p;
      if (mobile()) {
        // Mobil: obyekt bo'lim tepasiga yopishgan, u bilan birga scroll qiladi
        const ay = r.top + H * 0.23;
        p = (ay / H - 0.35) / 0.8;
        v = smooth(-0.32, 0.05, ay / H) * (1 - smooth(0.85, 1.12, ay / H));
        if (v > g.mix) { g.mix = v; g.p = p; g.side = 0; g.dim = s.dim ?? 0; g.anchorY = ay; }
      } else {
        // Kompyuter: bo'lim markazi ekran markaziga qanchalik yaqin. Oynalar kesishmaydi (0.22..0.46)
        p = (H / 2 - (r.top + r.height / 2)) / (r.height / 2 + H / 2);
        v = 1 - smooth(0.2, 0.46, Math.abs(p));
        if (v > g.mix) { g.mix = v; g.p = p; g.side = s.side; g.dim = s.dim ?? 0; }
      }
      if (v > 0) {
        accentTarget.add(tmpC.set(s.accent).multiplyScalar(v));
        wsum += v;
      }
    }
    if (wsum > 0) accentTarget.multiplyScalar(1 / Math.max(wsum, 1));
    accentTarget.lerp(baseAccent, 1 - Math.min(wsum, 1));
  }

  const clock = new THREE.Clock();
  const speed = reducedMotion ? 0.3 : 1;
  let running = true;
  let t = 0;
  const heroInfo = { x: 0, y: 0, r: 0, mix: 0 };
  const v3 = new THREE.Vector3();

  function frame() {
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.05) * speed;
    t += dt;
    measure();
    mouse.x += (mouse.tx - mouse.x) * 0.05;
    mouse.y += (mouse.ty - mouse.y) * 0.05;
    const sy = window.scrollY;
    vel += ((sy - lastScroll) - vel) * 0.15;
    lastScroll = sy;

    const isMob = mobile();
    const visH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.position.z;
    const visW = visH * camera.aspect;

    for (const [name, g] of Object.entries(groups)) {
      const m = g.mix;
      g.holder.visible = m > 0.003;
      if (!g.holder.visible) continue;
      g.tickers.forEach((fn) => fn(t, dt));
      const base = isMob ? Math.min(0.55, visW / 7.2) : Math.min(1, visW / 13);
      const sc = base * (1 - g.dim * 0.4);
      g.holder.scale.setScalar(sc * (0.75 + 0.25 * m));
      let x;
      let y;
      if (isMob) {
        x = 0;
        y = g.dim ? 0 : (0.5 - g.anchorY / H) * visH;
      } else {
        x = g.side * visW * 0.24;
        y = -g.p * visH * 0.18;             // parallaks: obyekt matndan sekinroq siljiydi
      }
      g.holder.position.set(x, y, 0);
      g.holder.rotation.set(mouse.y * 0.22 + g.p * 0.3, mouse.x * 0.35 + g.p * 1.4, 0);
      // Bo'laklar yig'iladi / tarqaladi
      g.parts.forEach((pt) => {
        const k = easeOut((m - pt.delay) / (1 - pt.delay));
        const off = (1 - k) * 4.2;
        pt.w.position.copy(pt.dir).multiplyScalar(off);
        pt.w.rotation.set(pt.spin.x * (1 - k), pt.spin.y * (1 - k), pt.spin.z * (1 - k));
        pt.w.scale.setScalar(Math.max(k, 0.0001));
      });
      if (name === "hero") {
        g.holder.updateMatrixWorld();
        v3.setFromMatrixPosition(g.holder.matrixWorld).project(camera);
        heroInfo.x = (v3.x * 0.5 + 0.5) * W;
        heroInfo.y = (-v3.y * 0.5 + 0.5) * H;
        heroInfo.r = ((g.radius * g.holder.scale.x) / visH) * H;
        heroInfo.mix = m;
      }
    }
    if (groups.hero.mix <= 0.003) heroInfo.mix = 0;

    bgU.uA.value.lerp(accentTarget, 0.06);
    rimA.color.lerp(accentTarget, 0.06);
    bgU.uTime.value = t;
    bgU.uMouse.value.set(mouse.x, -mouse.y);
    bgU.uPulse.value += (Math.min(Math.abs(vel) / 60, 1) - bgU.uPulse.value) * 0.1;

    stars.rotation.y = t * 0.012 + mouse.x * 0.05;
    stars.rotation.x = mouse.y * 0.03 + sy * 0.00012;
    starMat.size = 0.09 * (1 + Math.min(Math.abs(vel) / 40, 1.2));

    if (composer) composer.render();
    else {
      renderer.clear();
      renderer.render(bgScene, bgCam);
      renderer.clearDepth();
      renderer.render(scene, camera);
    }
    onFrame?.({ hero: heroInfo });
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) running = false;
    else if (!running) { running = true; clock.getDelta(); requestAnimationFrame(frame); }
  });
}
