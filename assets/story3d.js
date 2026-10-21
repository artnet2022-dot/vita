// VITA — the 3D story behind the first part of the page.
// One scene, eight chapters: the scroll position picks the chapter and every
// object moves between its places for each chapter, so scrolling back plays
// the story backwards. If anything here fails the page keeps its flat
// version (class "no3d" on <html>).
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const html = document.documentElement;
const canvas = document.getElementById('gl');
const story = document.getElementById('story');
const chapters = [...document.querySelectorAll('.chapter')];
const LAST = chapters.length - 1;


// ------------------------------------------------------------------ helpers
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (t) => t * t * (3 - 2 * t);

/** Values between keyframes [[s, {x,y,z,rx,ry,rz,sc,op}], …]. */
function keyed(frames, s) {
  if (s <= frames[0][0]) return frames[0][1];
  for (let i = 0; i < frames.length - 1; i++) {
    const [a, A] = frames[i];
    const [b, B] = frames[i + 1];
    if (s <= b) {
      const t = smooth(clamp((s - a) / (b - a)));
      const out = {};
      for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
        const from = A[k] ?? DEF[k];
        const to = B[k] ?? DEF[k];
        out[k] = lerp(from, to, t);
      }
      return out;
    }
  }
  return frames[frames.length - 1][1];
}
const DEF = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sc: 1, op: 1 };

function place(obj, v, bob = 0) {
  obj.position.set(v.x ?? 0, (v.y ?? 0) + bob, v.z ?? 0);
  obj.rotation.set(v.rx ?? 0, v.ry ?? 0, v.rz ?? 0);
  obj.scale.setScalar(Math.max(0.0001, v.sc ?? 1));
  fade(obj, v.op ?? 1);
}

function fade(obj, o) {
  obj.visible = o > 0.005;
  obj.traverse((m) => {
    if (!m.material) return;
    for (const mt of Array.isArray(m.material) ? m.material : [m.material]) {
      if (mt.userData.base === undefined) mt.userData.base = mt.opacity;
      mt.opacity = mt.userData.base * o;
    }
  });
}

const FONT = '"IBM Plex Sans Arabic", "Segoe UI", Tahoma, sans-serif';
const DISPLAY = '"Reem Kufi", "IBM Plex Sans Arabic", sans-serif';

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function write(x, s, X, Y, { size = 40, weight = 600, color = '#0A3432', align = 'right', font = FONT, dir = 'rtl' } = {}) {
  x.font = `${weight} ${size}px ${font}`;
  x.fillStyle = color;
  x.textAlign = align;
  x.direction = dir;
  x.textBaseline = 'alphabetic';
  x.fillText(s, X, Y);
}

function box(x, X, Y, W, H, R, fill) {
  x.beginPath();
  x.roundRect(X, Y, W, H, R);
  x.fillStyle = fill;
  x.fill();
}

function qr(x, X, Y, S) {
  let seed = 7;
  const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280;
  const n = 21;
  const c = S / n;
  const finder = (r, k) => {
    for (const [r0, k0] of [[0, 0], [0, 14], [14, 0]]) {
      if (r >= r0 && r < r0 + 7 && k >= k0 && k < k0 + 7) {
        const a = r - r0;
        const b = k - k0;
        return a === 0 || a === 6 || b === 0 || b === 6 || (a > 1 && a < 5 && b > 1 && b < 5);
      }
    }
    return null;
  };
  x.fillStyle = '#0A3432';
  for (let r = 0; r < n; r++) {
    for (let k = 0; k < n; k++) {
      const f = finder(r, k);
      if (f === true || (f === null && rnd() > 0.52)) x.fillRect(X + k * c, Y + r * c, c + 0.5, c + 0.5);
    }
  }
}

function loadImage(src) {
  return new Promise((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i);
    i.onerror = no;
    i.src = src;
  });
}

// ------------------------------------------------------------------- start
async function start() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) throw new Error('reduced motion');
  const probe = document.createElement('canvas');
  if (!probe.getContext('webgl2')) throw new Error('no webgl2');

  await Promise.race([
    Promise.all([
      document.fonts.load('700 120px "Reem Kufi"'),
      document.fonts.load('700 40px "IBM Plex Sans Arabic"'),
      document.fonts.load('600 40px "IBM Plex Sans Arabic"'),
      document.fonts.load('400 40px "IBM Plex Sans Arabic"'),
    ]),
    new Promise((r) => setTimeout(r, 2500)),
  ]);
  const shots = Object.fromEntries(
    await Promise.all(
      Object.entries({
        home: 'assets/screen-1-home.jpg',
        booking: 'assets/screen-3-booking.jpg',
        labs: 'assets/screen-4-labs.jpg',
        offers: 'assets/screen-5-home2.jpg',
      }).map(async ([k, src]) => [k, await loadImage(src)]),
    ),
  );

  const phoneSize = matchMedia('(max-width: 900px)');
  let small = phoneSize.matches;

  // ---------------------------------------------------------- renderer
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, small ? 1.5 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x041716);
  scene.fog = new THREE.Fog(0x041716, 10, 24);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
  camera.position.set(0, 0, 9);

  // A warm key light from above right and a teal rim from behind: the
  // objects stand in a pool of light like exhibits.
  const key = new THREE.DirectionalLight(0xfff1d6, 1.5);
  key.position.set(3, 5, 4);
  const rim = new THREE.DirectionalLight(0x2fd1be, 2.4);
  rim.position.set(-4, 2, -5);
  const fill = new THREE.AmbientLight(0x9fc9c2, 0.35);
  scene.add(key, rim, fill);

  // Everything of the story hangs from one group, set aside from the text.
  const world = new THREE.Group();
  scene.add(world);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.6, 0.5, 1.6);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // ------------------------------------------------------- backdrop
  // A soft glow on the "floor" under the objects.
  const glowTex = canvasTexture(512, 512, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(201,168,102,.55)');
    g.addColorStop(0.35, 'rgba(47,209,190,.16)');
    g.addColorStop(1, 'rgba(4,23,22,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);
  });
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(7, 7),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0.6 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -1.75;
  world.add(floor);

  // The big word behind each chapter.
  const WORDS = ['VITA', 'احجز', 'استقبل', 'افحص', 'حلّل', 'سدّد', 'اصرف', 'تذكّر'];
  const words = WORDS.map((wd, i) => {
    const t = canvasTexture(2048, 640, (x, w, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(20,120,112,.95)');
      g.addColorStop(1, 'rgba(10,52,50,.35)');
      x.font = `700 ${i === 0 ? 420 : 400}px ${DISPLAY}`;
      x.textAlign = 'center';
      x.direction = i === 0 ? 'ltr' : 'rtl';
      x.fillStyle = g;
      x.fillText(wd, w / 2, h * 0.74);
      x.lineWidth = 3;
      x.strokeStyle = 'rgba(201,168,102,.35)';
      x.strokeText(wd, w / 2, h * 0.74);
    });
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(10.5, 3.28),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0.55, fog: false }),
    );
    m.position.set(0, 0.35, -3.6);
    world.add(m);
    return m;
  });

  // ------------------------------------------------- the heartbeat line
  const beat = (u) => {
    const g = (m, s, a) => a * Math.exp(-((u - m) ** 2) / (2 * s * s));
    return g(0.18, 0.025, 0.12) - g(0.36, 0.009, 0.14) + g(0.4, 0.012, 1) - g(0.44, 0.01, 0.26) + g(0.68, 0.045, 0.28);
  };
  const ecgPoints = [];
  for (let x = -12; x <= 12.001; x += 0.025) {
    ecgPoints.push(new THREE.Vector3(x, beat((((x + 12) / 3.4) % 1 + 1) % 1) * 1.15, 0));
  }
  const ecgMat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uA: { value: new THREE.Color(0x2fd1be) },
      uB: { value: new THREE.Color(0xe6d3a6) },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `
      uniform float uTime; uniform float uOpacity; uniform vec3 uA; uniform vec3 uB; varying vec2 vUv;
      void main(){
        float head = fract(uTime * 0.075);
        float d = head - vUv.x; if (d < 0.0) d += 1.0;
        float trail = exp(-d * 22.0);
        float spark = exp(-d * 260.0);
        vec3 col = mix(uA, uB, spark);
        float a = 0.16 + trail * 1.4 + spark * 2.5;
        gl_FragColor = vec4(col * a, clamp(a, 0.0, 1.0) * uOpacity);
      }`,
  });
  const ecg = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ecgPoints), 2400, 0.016, 6, false),
    ecgMat,
  );
  ecg.position.set(0, -0.35, -2.2);
  scene.add(ecg);

  // ------------------------------------------------------------ dust
  const dustCount = small ? 220 : 520;
  const dustPos = new Float32Array(dustCount * 3);
  const dustSeed = new Float32Array(dustCount);
  for (let i = 0; i < dustCount; i++) {
    dustPos[i * 3] = (Math.random() - 0.5) * 22;
    dustPos[i * 3 + 1] = (Math.random() - 0.5) * 11;
    dustPos[i * 3 + 2] = -6 + Math.random() * 8;
    dustSeed[i] = Math.random() * 100;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dot = canvasTexture(64, 64, (x) => {
    const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,240,210,1)');
    g.addColorStop(1, 'rgba(255,240,210,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 64, 64);
  });
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ size: 0.05, map: dot, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xd9c08a }),
  );
  scene.add(dust);

  // ----------------------------------------------------------- cards
  const shadowTex = canvasTexture(256, 256, (x) => {
    x.shadowColor = 'rgba(0,0,0,.9)';
    x.shadowBlur = 40;
    box(x, 48, 48, 160, 160, 26, 'rgba(0,0,0,.85)');
  });
  const PAPER = '#EFEBE2';
  const PPU = small ? 360 : 460; // canvas pixels per scene unit

  function card(w, h, draw, { glow = false } = {}) {
    const t = canvasTexture(Math.round(w * PPU), Math.round(h * PPU), (x, W, H) => draw(x, W, H, PPU));
    const face = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: t, transparent: true, toneMapped: false, color: new THREE.Color(0.87, 0.87, 0.87) }),
    );
    const shade = new THREE.Mesh(
      new THREE.PlaneGeometry(w * 1.5, h * 1.5),
      new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }),
    );
    shade.position.set(0.06, -0.1, -0.03);
    const g = new THREE.Group();
    g.add(shade, face);
    if (glow) g.userData.glow = face;
    return g;
  }

  // The phone's screens, drawn with rounded corners.
  const SW = 600;
  const SH = 1263;
  const screenRadius = 66;
  const screenFrom = (draw) =>
    canvasTexture(SW, SH, (x) => {
      x.save();
      x.beginPath();
      x.roundRect(0, 0, SW, SH, screenRadius);
      x.clip();
      draw(x);
      x.restore();
    });
  const fromShot = (img) => screenFrom((x) => x.drawImage(img, 0, 0, SW, SH));

  const treatScreen = screenFrom((x) => {
    x.fillStyle = '#F6F3EC';
    x.fillRect(0, 0, SW, SH);
    write(x, 'علاجاتي', SW - 40, 150, { size: 46, weight: 700, font: DISPLAY });
    write(x, 'زينب كاظم، جرعات اليوم', SW - 40, 200, { size: 26, weight: 400, color: '#5C6D69' });
    const rows = [
      ['Amlodipine 5 mg', 'حبة صباحاً', '8:00 ص', '#0B6E69'],
      ['Metformin 850 mg', 'بعد الفطور وبعد العشاء', '8:30 ص', '#3466C0'],
      ['Atorvastatin 20 mg', 'حبة مساءً', '9:00 م', '#B23A5E'],
    ];
    rows.forEach(([m, u, t, c], i) => {
      const y = 260 + i * 210;
      box(x, 34, y, SW - 68, 180, 36, '#FFFFFF');
      box(x, SW - 120, y + 46, 62, 62, 18, c);
      write(x, m, SW - 150, y + 78, { size: 30, weight: 700, dir: 'ltr' });
      write(x, u, SW - 150, y + 126, { size: 24, weight: 400, color: '#5C6D69' });
      write(x, t, 70, y + 100, { size: 30, weight: 700, color: c, align: 'left' });
    });
    box(x, 34, 930, SW - 68, 130, 36, '#E2EFEB');
    write(x, 'التذكير مفعّل لكل جرعة', SW - 70, 1008, { size: 28, weight: 600, color: '#0B6E69' });
  });

  const lockScreen = screenFrom((x) => {
    const g = x.createRadialGradient(SW / 2, 0, 0, SW / 2, 0, SH);
    g.addColorStop(0, '#1B5C57');
    g.addColorStop(1, '#051716');
    x.fillStyle = g;
    x.fillRect(0, 0, SW, SH);
    write(x, '8:00', SW / 2, 300, { size: 150, weight: 600, color: '#FFFFFF', align: 'center', font: DISPLAY, dir: 'ltr' });
    write(x, 'السبت', SW / 2, 360, { size: 30, weight: 400, color: '#CFE3DE', align: 'center' });
    const n = [
      ['حان وقت جرعتك', 'حبة الضغط، بعد الفطور', '#0B6E69'],
      ['نتائج تحاليل جديدة', 'مختبر الشفاء', '#C0631F'],
    ];
    n.forEach(([a, b, c], i) => {
      const y = 470 + i * 170;
      box(x, 30, y, SW - 60, 145, 34, 'rgba(255,255,255,.16)');
      box(x, SW - 110, y + 36, 64, 64, 18, c);
      write(x, a, SW - 132, y + 66, { size: 29, weight: 700, color: '#FFFFFF' });
      write(x, b, SW - 132, y + 108, { size: 24, weight: 400, color: '#CFE3DE' });
    });
  });

  const screens = {
    home: fromShot(shots.home),
    booking: fromShot(shots.booking),
    labs: fromShot(shots.labs),
    offers: fromShot(shots.offers),
    treat: treatScreen,
    lock: lockScreen,
  };

  // --------------------------------------------------------- phone
  const phone = new THREE.Group();
  const body = new THREE.Mesh(
    new RoundedBoxGeometry(1.06, 2.14, 0.12, 8, 0.15),
    new THREE.MeshPhysicalMaterial({ color: 0x1d3330, metalness: 1, roughness: 0.26, clearcoat: 0.7, clearcoatRoughness: 0.2, transparent: true }),
  );
  const glass = new THREE.Mesh(
    new THREE.PlaneGeometry(1.0, 2.08),
    new THREE.MeshBasicMaterial({ color: 0x020909, transparent: true }),
  );
  glass.position.z = 0.0605;
  const screenGeo = new THREE.PlaneGeometry(0.95, 2.0);
  const screenA = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: screens.home, transparent: true, toneMapped: false, color: new THREE.Color(0.86, 0.86, 0.86) }));
  const screenB = new THREE.Mesh(screenGeo, new THREE.MeshBasicMaterial({ map: screens.home, transparent: true, toneMapped: false, opacity: 0, color: new THREE.Color(0.86, 0.86, 0.86) }));
  screenA.position.z = 0.062;
  screenB.position.z = 0.0625;
  const island = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.045, 0.13, 4, 12),
    new THREE.MeshBasicMaterial({ color: 0x010505, transparent: true }),
  );
  island.rotation.z = Math.PI / 2;
  island.position.set(0, 0.9, 0.064);
  phone.add(body, glass, screenA, screenB, island);
  world.add(phone);
  let screenKey = 'home';
  let screenFade = 1;

  // --------------------------------------------------------- the cards
  const C = {};
  C.ticket = card(1.5, 0.92, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.09 * p, PAPER);
    x.globalCompositeOperation = 'destination-out';
    for (const cx of [0, W]) {
      x.beginPath();
      x.arc(cx, H / 2, 0.07 * p, 0, Math.PI * 2);
      x.fill();
    }
    x.globalCompositeOperation = 'source-over';
    write(x, 'رقمك في الطابور', W - 0.1 * p, 0.2 * p, { size: 0.075 * p, weight: 400, color: '#5C6D69' });
    write(x, '4', W - 0.1 * p, 0.62 * p, { size: 0.42 * p, weight: 700, color: '#0B6E69', font: DISPLAY });
    write(x, 'د. حيدر داخل', W - 0.5 * p, 0.38 * p, { size: 0.085 * p, weight: 700 });
    write(x, 'باطنية، عيادة الشفاء', W - 0.5 * p, 0.5 * p, { size: 0.062 * p, weight: 400, color: '#5C6D69' });
    write(x, 'الوقت التقديري 4:45 م', W - 0.5 * p, 0.62 * p, { size: 0.062 * p, weight: 600, color: '#0A3432' });
    box(x, 0.1 * p, 0.7 * p, 0.62 * p, 0.14 * p, 0.07 * p, '#C9A866');
    write(x, 'خصم VITA 20%', 0.41 * p, 0.8 * p, { size: 0.062 * p, weight: 700, color: '#1E1708', align: 'center' });
  });

  const queueRows = [
    ['2', 'سعاد عبد الكريم', 'انتهت', '#DDF2E7', '#1E7A52'],
    ['3', 'علي حسن', 'عند الطبيب', '#E2EFEB', '#0B6E69'],
    ['4', 'زينب كاظم', 'مدفوع، خصم VITA', '#F6EBD3', '#8A5A1C'],
    ['5', 'مريم عباس', 'على الضمان', '#E3E9F4', '#2F5DA8'],
  ];
  C.queue = queueRows.map(([n, name, st, bg, fg]) =>
    card(1.7, 0.4, (x, W, H, p) => {
      box(x, 0, 0, W, H, 0.08 * p, PAPER);
      box(x, W - 0.36 * p, 0.07 * p, 0.26 * p, 0.26 * p, 0.06 * p, '#E2EFEB');
      write(x, n, W - 0.23 * p, 0.27 * p, { size: 0.13 * p, weight: 700, color: '#0B6E69', align: 'center', font: DISPLAY });
      write(x, name, W - 0.45 * p, 0.25 * p, { size: 0.085 * p, weight: 700 });
      x.font = `700 ${0.058 * p}px ${FONT}`;
      const tw = x.measureText(st).width + 0.12 * p;
      box(x, 0.08 * p, 0.12 * p, tw, 0.16 * p, 0.08 * p, bg);
      write(x, st, 0.08 * p + tw / 2, 0.225 * p, { size: 0.058 * p, weight: 700, color: fg, align: 'center' });
    }),
  );
  C.tv = card(1.05, 0.72, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, '#0B2C2A');
    write(x, 'الرقم الحالي', W / 2, 0.18 * p, { size: 0.07 * p, weight: 600, color: '#CFE3DE', align: 'center' });
    write(x, '3', W / 2, 0.58 * p, { size: 0.36 * p, weight: 700, color: '#E6D3A6', align: 'center', font: DISPLAY });
  });

  C.summary = card(1.75, 1.05, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, PAPER);
    write(x, 'زينب كاظم، 54 سنة', W - 0.1 * p, 0.17 * p, { size: 0.09 * p, weight: 700 });
    write(x, 'ارتفاع ضغط الدم، السكري النوع الثاني', W - 0.1 * p, 0.28 * p, { size: 0.058 * p, weight: 400, color: '#5C6D69' });
    const vit = [['134/84', 'الضغط'], ['142', 'السكر'], ['76', 'الوزن']];
    vit.forEach(([v, l], i) => {
      const X = W - 0.1 * p - (i + 1) * 0.5 * p + 0.04 * p;
      box(x, X, 0.36 * p, 0.46 * p, 0.27 * p, 0.05 * p, '#E6E1D5');
      write(x, v, X + 0.23 * p, 0.5 * p, { size: 0.08 * p, weight: 700, align: 'center', dir: 'ltr' });
      write(x, l, X + 0.23 * p, 0.59 * p, { size: 0.048 * p, weight: 400, color: '#5C6D69', align: 'center' });
    });
    // blood pressure over the last visits, coming down
    const pts = [[0.12, 0.74], [0.5, 0.8], [0.9, 0.86], [1.25, 0.9]];
    x.beginPath();
    pts.forEach(([a, b], i) => (i ? x.lineTo(a * p, b * p) : x.moveTo(a * p, b * p)));
    x.lineWidth = 0.018 * p;
    x.strokeStyle = '#0B6E69';
    x.stroke();
    pts.forEach(([a, b]) => {
      x.beginPath();
      x.arc(a * p, b * p, 0.022 * p, 0, Math.PI * 2);
      x.fillStyle = '#0B6E69';
      x.fill();
    });
    write(x, 'الضغط: 158 ثم 146 ثم 134', W - 0.1 * p, 0.98 * p, { size: 0.052 * p, weight: 600, color: '#0B6E69' });
  });
  C.rx = card(1.55, 1.05, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, '#FBFAF6');
    box(x, W - 0.06 * p, 0.12 * p, 0.022 * p, H - 0.24 * p, 0.01 * p, '#0B6E69');
    write(x, 'وصفة طبية', W - 0.14 * p, 0.17 * p, { size: 0.085 * p, weight: 700, font: DISPLAY });
    const l = [['Amlodipine 5 mg', 'حبة صباحاً'], ['Metformin 850 mg', 'بعد الفطور وبعد العشاء'], ['Atorvastatin 20 mg', 'حبة مساءً']];
    l.forEach(([m, u], i) => {
      const y = 0.34 * p + i * 0.22 * p;
      write(x, m, W - 0.14 * p, y, { size: 0.07 * p, weight: 700, dir: 'ltr' });
      write(x, u, W - 0.14 * p, y + 0.08 * p, { size: 0.052 * p, weight: 400, color: '#5C6D69' });
    });
    write(x, 'أُرسلت إلى الصيدلية', 0.1 * p, 0.96 * p, { size: 0.05 * p, weight: 600, color: '#0B6E69', align: 'left' });
  });
  C.alert = card(1.45, 0.34, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.17 * p, '#FBE3E1');
    write(x, 'تنبيه: Augmentin من البنسلينات، والمريضة تتحسس منها', W / 2, 0.21 * p, { size: 0.056 * p, weight: 700, color: '#B0372D', align: 'center' });
  });
  C.labReq = card(1.3, 0.48, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, PAPER);
    write(x, 'طلب تحاليل', W - 0.1 * p, 0.17 * p, { size: 0.058 * p, weight: 400, color: '#5C6D69' });
    write(x, 'باقة مرضى السكري', W - 0.1 * p, 0.34 * p, { size: 0.085 * p, weight: 700, color: '#C0631F' });
  });

  C.receipt = card(1.0, 1.62, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.03 * p, '#FBFAF6');
    write(x, 'مختبر الشفاء', W / 2, 0.16 * p, { size: 0.085 * p, weight: 700, align: 'center', font: DISPLAY });
    write(x, 'وصل L-5379828', W / 2, 0.25 * p, { size: 0.048 * p, weight: 400, color: '#5C6D69', align: 'center' });
    const l = [['HbA1c', '15,000'], ['Fasting Glucose', '6,500'], ['Lipid Profile', '22,500'], ['Urea', '6,500']];
    l.forEach(([a, b], i) => {
      const y = 0.4 * p + i * 0.1 * p;
      write(x, a, 0.08 * p, y, { size: 0.05 * p, weight: 400, align: 'left', dir: 'ltr' });
      write(x, b, W - 0.08 * p, y, { size: 0.05 * p, weight: 600, align: 'right', dir: 'ltr' });
    });
    x.strokeStyle = '#CFC6B5';
    x.setLineDash([0.02 * p, 0.015 * p]);
    x.beginPath();
    x.moveTo(0.06 * p, 0.82 * p);
    x.lineTo(W - 0.06 * p, 0.82 * p);
    x.stroke();
    write(x, 'المجموع', W - 0.08 * p, 0.92 * p, { size: 0.058 * p, weight: 700 });
    write(x, '50,000', 0.08 * p, 0.92 * p, { size: 0.058 * p, weight: 700, align: 'left', dir: 'ltr' });
    qr(x, W / 2 - 0.25 * p, 1.02 * p, 0.5 * p);
    write(x, 'النتائج جاهزة 4:30 م', W / 2, 1.6 * p - 0.06 * p, { size: 0.05 * p, weight: 600, align: 'center', color: '#0B6E69' });
  });

  const resultsDraw = (locked) => (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, '#FBFAF6');
    write(x, 'نتائج التحاليل', W - 0.1 * p, 0.17 * p, { size: 0.085 * p, weight: 700, font: DISPLAY });
    write(x, 'زينب كاظم، مختبر الشفاء', W - 0.1 * p, 0.26 * p, { size: 0.05 * p, weight: 400, color: '#5C6D69' });
    const rows = [['HbA1c', '7.1 %', true], ['Fasting Glucose', '128 mg/dL', true], ['Cholesterol', '196 mg/dL', false], ['LDL', '104 mg/dL', true]];
    rows.forEach(([a, b, hi], i) => {
      const y = 0.42 * p + i * 0.16 * p;
      write(x, a, 0.1 * p, y, { size: 0.058 * p, weight: 400, align: 'left', dir: 'ltr' });
      x.save();
      if (locked) x.filter = `blur(${0.025 * p}px)`;
      write(x, b, W - 0.1 * p, y, { size: 0.062 * p, weight: 700, align: 'right', dir: 'ltr', color: hi ? '#B0372D' : '#0A3432' });
      x.restore();
      x.fillStyle = '#E6E0D3';
      x.fillRect(0.1 * p, y + 0.045 * p, W - 0.2 * p, 0.004 * p);
    });
    if (locked) {
      box(x, W / 2 - 0.5 * p, 0.92 * p, p, 0.14 * p, 0.07 * p, '#FBE3E1');
      write(x, 'مقفلة حتى التسديد، المتبقي 15,000', W / 2, 1.01 * p, { size: 0.05 * p, weight: 700, color: '#B0372D', align: 'center' });
    } else {
      box(x, W / 2 - 0.5 * p, 0.92 * p, p, 0.14 * p, 0.07 * p, '#DDF2E7');
      write(x, 'سُدد المبلغ، فُتحت النتائج', W / 2, 1.01 * p, { size: 0.05 * p, weight: 700, color: '#1E7A52', align: 'center' });
    }
  };
  C.resLocked = card(1.6, 1.14, resultsDraw(true));
  C.resOpen = card(1.6, 1.14, resultsDraw(false));

  C.dispensed = card(1.45, 0.52, (x, W, H, p) => {
    box(x, 0, 0, W, H, 0.08 * p, PAPER);
    box(x, W - 0.4 * p, 0.1 * p, 0.32 * p, 0.32 * p, 0.09 * p, '#1E8A5F');
    x.strokeStyle = '#fff';
    x.lineWidth = 0.035 * p;
    x.lineCap = 'round';
    x.beginPath();
    x.moveTo(W - 0.33 * p, 0.27 * p);
    x.lineTo(W - 0.26 * p, 0.34 * p);
    x.lineTo(W - 0.15 * p, 0.19 * p);
    x.stroke();
    write(x, 'صُرفت الوصفة', W - 0.5 * p, 0.23 * p, { size: 0.08 * p, weight: 700 });
    write(x, '3 أدوية أُضيفت إلى «علاجاتي»', W - 0.5 * p, 0.36 * p, { size: 0.055 * p, weight: 400, color: '#5C6D69' });
  });

  const note = (title, body, color) =>
    card(1.75, 0.42, (x, W, H, p) => {
      box(x, 0, 0, W, H, 0.12 * p, '#0E3633');
      box(x, W - 0.38 * p, 0.08 * p, 0.26 * p, 0.26 * p, 0.07 * p, color);
      write(x, title, W - 0.48 * p, 0.19 * p, { size: 0.07 * p, weight: 700, color: '#FFFFFF' });
      write(x, body, W - 0.48 * p, 0.31 * p, { size: 0.055 * p, weight: 400, color: '#CFE3DE' });
    });
  C.n1 = note('حان وقت جرعتك', 'حبة الضغط، بعد الفطور', '#0B6E69');
  C.n2 = note('نتائج تحاليل جديدة', 'مختبر الشفاء', '#C0631F');
  C.n3 = note('موعد مراجعتك بعد شهر', 'د. حيدر داخل', '#3466C0');

  for (const k in C) {
    for (const g of [].concat(C[k])) world.add(g);
  }

  // --------------------------------------------------------- test tubes
  // Vacuum tubes as a lab really uses them: purple (blood count), red
  // (serum), grey (glucose).
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, transmission: 0.92, thickness: 0.06, roughness: 0.12, ior: 1.45, envMapIntensity: 0.5, transparent: true, side: THREE.DoubleSide,
  });
  const labelTex = canvasTexture(256, 512, (x, w, h) => {
    x.fillStyle = '#FBFAF6';
    x.fillRect(0, 0, w, h);
    x.fillStyle = '#0A3432';
    for (let i = 0; i < 26; i++) x.fillRect(20 + i * 8, 40, (i * 7) % 3 + 2, 120);
    x.save();
    x.translate(w / 2, 330);
    x.rotate(-Math.PI / 2);
    write(x, 'VITA', 0, 18, { size: 54, weight: 700, color: '#0B6E69', align: 'center', font: DISPLAY, dir: 'ltr' });
    x.restore();
  });
  const tube = (cap, liquid) => {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 1.12, 40, 1, true), glassMat);
    const bottom = new THREE.Mesh(new THREE.SphereGeometry(0.115, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), glassMat);
    bottom.position.y = -0.56;
    const liqMat = new THREE.MeshPhysicalMaterial({ color: liquid, roughness: 0.32, clearcoat: 0.4, envMapIntensity: 0.4, transparent: true });
    const liq = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.62, 40), liqMat);
    liq.position.y = -0.25;
    const liqBottom = new THREE.Mesh(new THREE.SphereGeometry(0.1, 40, 16, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), liqMat);
    liqBottom.position.y = -0.56;
    const capMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.135, 0.13, 0.24, 40),
      new THREE.MeshPhysicalMaterial({ color: cap, roughness: 0.45, clearcoat: 0.4, transparent: true }),
    );
    capMesh.position.y = 0.63;
    const label = new THREE.Mesh(
      new THREE.CylinderGeometry(0.117, 0.117, 0.46, 40, 1, true, -1.0, 2.0),
      new THREE.MeshStandardMaterial({ map: labelTex, roughness: 0.8, envMapIntensity: 0.4, color: new THREE.Color(0.8, 0.8, 0.8), transparent: true }),
    );
    label.position.y = 0.05;
    g.add(liq, liqBottom, wall, bottom, capMesh, label);
    return g;
  };
  const tubes = [tube(0x6b3fa0, 0x7a0d12), tube(0xb3262b, 0xc9a24a), tube(0x8a8f94, 0x8e1b1b)];
  tubes.forEach((t) => world.add(t));

  // --------------------------------------------------------- padlock
  const brass = new THREE.MeshPhysicalMaterial({ color: 0xc9a866, metalness: 1, roughness: 0.28, clearcoat: 0.5, transparent: true });
  const steel = new THREE.MeshPhysicalMaterial({ color: 0xdfe4e6, metalness: 1, roughness: 0.18, transparent: true });
  const lock = new THREE.Group();
  const lockBody = new THREE.Mesh(new RoundedBoxGeometry(0.66, 0.54, 0.24, 6, 0.07), brass);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.05, 24), new THREE.MeshBasicMaterial({ color: 0x1a1206, transparent: true }));
  hole.position.set(0, 0.03, 0.121);
  const slot = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.11), new THREE.MeshBasicMaterial({ color: 0x1a1206, transparent: true }));
  slot.position.set(0, -0.04, 0.121);
  const shackle = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.045, 16, 48, Math.PI), steel);
  arc.position.y = 0.36;
  const legL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.2, 20), steel);
  legL.position.set(-0.2, 0.27, 0);
  const legR = legL.clone();
  legR.position.x = 0.2;
  shackle.add(arc, legL, legR);
  // the shackle turns on its right leg when it opens
  const hinge = new THREE.Group();
  hinge.position.x = 0.2;
  shackle.position.x = -0.2;
  hinge.add(shackle);
  lock.add(lockBody, hole, slot, hinge);
  world.add(lock);

  // --------------------------------------------------------- capsules
  const PILLS = small ? 46 : 80;
  const pillGeo = new THREE.CapsuleGeometry(0.07, 0.17, 8, 18);
  const half = new Float32Array(pillGeo.attributes.position.count);
  for (let i = 0; i < half.length; i++) half[i] = pillGeo.attributes.position.getY(i) < 0 ? 1 : 0;
  pillGeo.setAttribute('aHalf', new THREE.BufferAttribute(half, 1));
  const pillMat = new THREE.MeshPhysicalMaterial({ roughness: 0.38, clearcoat: 0.45, clearcoatRoughness: 0.25, envMapIntensity: 0.55 });
  pillMat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aHalf;\nvarying float vHalf;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHalf = aHalf;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHalf;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(vec3(0.82, 0.81, 0.78), diffuseColor.rgb, vHalf);');
  };
  const pills = new THREE.InstancedMesh(pillGeo, pillMat, PILLS);
  const palette = [0x0b8f87, 0xc9a866, 0xd4507a, 0x3466c0, 0xe07b34];
  const pill = [];
  for (let i = 0; i < PILLS; i++) {
    pills.setColorAt(i, new THREE.Color(palette[i % palette.length]));
    pill.push({
      from: new THREE.Vector3((Math.random() - 0.5) * 3.4, 3.2 + Math.random() * 3.2, (Math.random() - 0.5) * 1.8),
      to: new THREE.Vector3((Math.random() - 0.5) * 0.7, -0.45 + Math.random() * 0.2, 0.15 + (Math.random() - 0.5) * 0.5),
      delay: Math.random() * 0.55,
      spin: new THREE.Vector3(Math.random() * 6, Math.random() * 6, Math.random() * 6),
      orbitR: 1.05 + Math.random() * 0.9,
      orbitY: (Math.random() - 0.5) * 1.9,
      orbitA: Math.random() * Math.PI * 2,
      orbitV: (0.12 + Math.random() * 0.18) * (Math.random() < 0.5 ? -1 : 1),
    });
  }
  world.add(pills);
  const tmp = new THREE.Object3D();

  // ------------------------------------------------------ choreography
  // [s, place]: s is the chapter (0…7), fractional between chapters.
  const OFF = { op: 0, sc: 0.6 };
  const T = {
    phone: [
      [0, { x: 0, y: 0.02, z: 0, rx: 0.06, ry: -0.45, rz: 0.05 }],
      [1, { x: 0.45, y: -0.05, z: -0.2, ry: 0.35, rz: -0.03 }],
      [2, { x: 0.85, y: -0.2, z: -1.8, rx: 0.05, ry: -0.55, sc: 0.9 }],
      [3, { x: 0.95, y: -0.15, z: -2.5, ry: -0.7, sc: 0.85 }],
      [4, { x: 1.0, y: -0.3, z: -3.1, ry: -0.8, sc: 0.8, op: 0.7 }],
      [5, { x: 1.0, y: -0.3, z: -3.1, ry: -0.8, sc: 0.8, op: 0.7 }],
      [6, { x: 0, y: -0.6, z: 0.1, rx: -1.0, sc: 1 }],
      [7, { x: 0, y: 0, z: 0.3, sc: 1.04 }],
    ],
    ticket: [
      [0.3, { x: -0.6, y: 0.1, z: -0.4, ry: 0.35, ...OFF }],
      [1, { x: -0.8, y: 0.5, z: 0.75, rx: -0.05, ry: 0.35, rz: 0.06 }],
      [1.6, { x: -1.4, y: 1.8, z: -0.4, ry: 0.5, rz: 0.2, op: 0, sc: 0.8 }],
    ],
    tv: [
      [1.4, { x: 0.9, y: 2.2, z: -0.2, ry: -0.2, op: 0 }],
      [2, { x: 0.85, y: 1.0, z: -0.15, ry: -0.2 }],
      [2.6, { x: 0.9, y: 2.4, z: -0.2, ry: -0.2, op: 0 }],
    ],
    summary: [
      [2.35, { x: -2.6, y: 0.6, z: 0.3, ry: 0.6, op: 0 }],
      [3, { x: -0.55, y: 0.62, z: 0.25, ry: 0.28, rz: 0.02 }],
      [3.6, { x: -0.9, y: 2.3, z: -0.3, ry: 0.3, op: 0 }],
    ],
    rx: [
      [2.5, { x: -0.3, y: -2.8, z: 0.7, ry: 0.22, rz: -0.3, op: 0 }],
      [3.1, { x: -0.38, y: -0.38, z: 0.62, ry: 0.22, rz: -0.03 }],
      [3.65, { x: 0.8, y: 0.2, z: -1.6, ry: -0.4, op: 0, sc: 0.5 }],
    ],
    alert: [
      [2.85, { x: -1.35, y: -1.0, z: 1.1, ry: 0.3, op: 0, sc: 0.5 }],
      [3.15, { x: -0.85, y: -0.98, z: 1.0, ry: 0.3 }],
      [3.55, { x: -1.4, y: -2.2, z: 1.0, ry: 0.3, op: 0 }],
    ],
    labReq: [
      [2.7, { x: 1.6, y: -1.0, z: 0.85, ry: -0.2, op: 0 }],
      [3.2, { x: 0.35, y: -1.05, z: 0.85, ry: 0.12 }],
      [3.7, { x: -0.6, y: -0.3, z: 0.4, ry: 0.2, op: 0, sc: 0.5 }],
    ],
    receipt: [
      [3.5, { x: 1.8, y: 0.2, z: 0.6, ry: -1.2, rz: 0.1, op: 0 }],
      [4, { x: 0.62, y: 0.12, z: 0.55, ry: -0.28, rz: 0.04 }],
      [4.6, { x: 1.6, y: 1.6, z: 0.2, ry: -0.6, op: 0 }],
    ],
    resLocked: [
      [4.35, { x: -0.35, y: 1.8, z: 0.2, ry: 0.25, op: 0 }],
      [4.85, { x: -0.38, y: 0.42, z: 0.2, ry: 0.25 }],
      [5.0, { x: -0.38, y: 0.42, z: 0.2, ry: 0.25 }],
      [5.15, { x: -0.38, y: 0.42, z: 0.2, ry: 0.25, op: 0 }],
    ],
    resOpen: [
      [4.95, { x: -0.38, y: 0.42, z: 0.21, ry: 0.25, op: 0 }],
      [5.15, { x: -0.38, y: 0.42, z: 0.21, ry: 0.25 }],
      [5.65, { x: -0.5, y: 2.0, z: 0.2, ry: 0.25, op: 0 }],
    ],
    lock: [
      [4.4, { x: -0.25, y: -2.4, z: 0.9, ry: 0.3, op: 0 }],
      [4.85, { x: -0.25, y: -0.42, z: 0.95, ry: 0.32 }],
      [5.3, { x: -0.25, y: -0.48, z: 0.95, ry: 0.32 }],
      [5.6, { x: -0.3, y: -2.2, z: 0.9, ry: 0.5, op: 0 }],
    ],
    dispensed: [
      [5.6, { x: -2.4, y: 0.9, z: 0.4, ry: 0.5, op: 0 }],
      [6.1, { x: -0.85, y: 0.95, z: 0.45, ry: 0.3, rz: 0.03 }],
      [6.6, { x: -1.6, y: 2.2, z: 0.2, ry: 0.4, op: 0 }],
    ],
    n1: [[6.5, { x: -1.6, y: 0.9, z: 0.9, ry: 0.3, op: 0 }], [7, { x: -0.8, y: 0.8, z: 0.8, ry: 0.3 }]],
    n2: [[6.6, { x: 1.6, y: 0.2, z: 0.6, ry: -0.3, op: 0 }], [7, { x: 0.95, y: 0.08, z: 0.7, ry: -0.3 }]],
    n3: [[6.7, { x: -1.5, y: -0.9, z: 0.6, ry: 0.25, op: 0 }], [7, { x: -0.75, y: -0.75, z: 0.65, ry: 0.25 }]],
  };
  // queue cards come in one after another, like a deck being dealt
  C.queue.forEach((_, j) => {
    T['q' + j] = [
      [1.3 + j * 0.08, { x: -0.4, y: -2.6, z: 0.6, ry: 0.25, op: 0 }],
      [1.9 + j * 0.05, { x: -0.62 + j * 0.06, y: 0.78 - j * 0.48, z: 0.35 + j * 0.13, rx: -0.04, ry: 0.26, rz: 0.01 }],
      [2.45 + j * 0.05, { x: -0.62 + j * 0.06, y: 0.78 - j * 0.48, z: 0.35 + j * 0.13, rx: -0.04, ry: 0.26, rz: 0.01 }],
      [2.85 + j * 0.05, { x: -1.4, y: 2.6, z: 0.2, ry: 0.4, op: 0 }],
    ];
  });
  tubes.forEach((_, j) => {
    T['t' + j] = [
      [3.35 + j * 0.1, { x: -1.05 + j * 0.4, y: -3.2, z: 0.25 + j * 0.15, rz: 0.2, op: 0 }],
      [3.95 + j * 0.06, { x: -1.05 + j * 0.4, y: -0.05 - j * 0.05, z: 0.25 + j * 0.15, rx: 0.08, ry: j * 0.4, rz: -0.1 + j * 0.1 }],
      [4.4, { x: -1.05 + j * 0.4, y: -0.05 - j * 0.05, z: 0.25 + j * 0.15, rx: 0.08, ry: j * 0.4, rz: -0.1 + j * 0.1 }],
      [4.7, { x: -1.4 + j * 0.3, y: -3.0, z: 0.2, rz: 0.4, op: 0 }],
    ];
  });

  const nodes = {
    phone, lock, ...Object.fromEntries(Object.entries(C).filter(([, v]) => !Array.isArray(v))),
    ...Object.fromEntries(C.queue.map((q, j) => ['q' + j, q])),
    ...Object.fromEntries(tubes.map((t, j) => ['t' + j, t])),
  };
  const seeds = Object.fromEntries(Object.keys(nodes).map((k, i) => [k, i * 1.7]));

  const CAM = [
    [0, { x: 0, y: 0.15, z: 9 }],
    [2, { x: 0.35, y: 0.35, z: 8.8 }],
    [3, { x: 0.6, y: 0.45, z: 8.6 }],
    [5, { x: -0.35, y: 0.1, z: 8.4 }],
    [6, { x: 0, y: 0.9, z: 8.4 }],
    [7, { x: 0, y: 0.3, z: 8.6 }],
  ];

  // ---------------------------------------------------------- layout
  let focus = new THREE.Vector3();
  let worldScale = 1;
  function resize() {
    small = phoneSize.matches;
    const w = innerWidth;
    const h = innerHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const viewH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 9;
    const viewW = viewH * camera.aspect;
    if (small || camera.aspect < 1) {
      worldScale = Math.min(0.7, viewW / 3.9);
      focus.set(0, viewH * 0.17, 0);
    } else {
      worldScale = 1.28;
      focus.set(-Math.min(viewW * 0.24, 2.9), -0.1, 0);
    }
    world.scale.setScalar(worldScale);
    world.position.copy(focus);
    bloom.strength = small ? 0.4 : 0.6;
  }
  addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------- scroll → s
  let centers = [];
  const measure = () => {
    centers = chapters.map((c) => {
      const r = c.getBoundingClientRect();
      return r.top + scrollY + r.height / 2;
    });
  };
  measure();
  addEventListener('resize', measure);
  new ResizeObserver(measure).observe(story);
  const target = () => {
    const mid = scrollY + innerHeight / 2;
    if (mid <= centers[0]) return 0;
    for (let i = 0; i < LAST; i++) {
      if (mid <= centers[i + 1]) return i + (mid - centers[i]) / (centers[i + 1] - centers[i]);
    }
    return LAST;
  };

  let pointerX = 0;
  let pointerY = 0;
  addEventListener('pointermove', (e) => {
    pointerX = (e.clientX / innerWidth - 0.5) * 2;
    pointerY = (e.clientY / innerHeight - 0.5) * 2;
  }, { passive: true });

  let running = true;
  new IntersectionObserver((es) => {
    running = es[0].isIntersecting;
    canvas.parentElement.classList.toggle('gone', !running);
  }, { rootMargin: '0px 0px 0px 0px' }).observe(story);
  document.addEventListener('visibilitychange', () => { last = performance.now(); });

  html.classList.add('has3d');

  // ------------------------------------------------------------ frame
  let s = target();
  let last = performance.now();
  let time = 0;
  let current = -1;
  const look = new THREE.Vector3();

  function screenFor(v) {
    if (v < 0.5) return 'home';
    if (v < 1.5) return 'booking';
    if (v < 5.5) return 'offers';
    if (v < 6.55) return 'treat';
    return 'lock';
  }

  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!running || document.hidden) return;
    time += dt;
    const goal = target();
    s += (goal - s) * (1 - Math.exp(-dt * 5.5));
    if (Math.abs(goal - s) < 0.0005) s = goal;

    // the chapter in view gets its text lit
    const near = Math.round(goal);
    if (near !== current) {
      current = near;
      chapters.forEach((c, i) => c.classList.toggle('on', i === near));
    }

    // objects
    for (const [name, obj] of Object.entries(nodes)) {
      const v = keyed(T[name], s);
      const bob = Math.sin(time * 1.1 + seeds[name]) * 0.025;
      place(obj, v, bob);
    }
    phone.rotation.y += Math.sin(time * 0.5) * 0.04;
    // the alert card throbs while it is up
    const a = C.alert;
    if (a.visible) a.scale.multiplyScalar(1 + Math.sin(time * 6) * 0.015);

    // the lock opens on payment
    const u = smooth(clamp((s - 4.92) / 0.22));
    shackle.position.y = 0.2 * u;
    hinge.rotation.y = -1.1 * smooth(clamp((s - 5.0) / 0.25));

    // screens
    const want = screenFor(s);
    if (want !== screenKey) {
      screenB.material.map = screens[want];
      screenB.material.needsUpdate = true;
      screenKey = want;
      screenFade = 0;
    }
    if (screenFade < 1) {
      screenFade = Math.min(1, screenFade + dt * 3);
      screenB.material.opacity = screenFade * phone.children[0].material.opacity;
      if (screenFade >= 1) {
        screenA.material.map = screens[screenKey];
        screenA.material.needsUpdate = true;
        screenB.material.opacity = 0;
      }
    } else {
      screenB.material.opacity = 0;
    }

    // capsules: a few drift round the phone at the start and end; all of
    // them pour into it at the pharmacy.
    const orbitW = Math.max(clamp(1 - s / 0.7), clamp((s - 6.55) / 0.45));
    const pourW = clamp((s - 5.35) * 0.9);
    for (let i = 0; i < PILLS; i++) {
      const p = pill[i];
      let sc = 0;
      if (orbitW > 0 && i < 14) {
        const ang = p.orbitA + time * p.orbitV;
        tmp.position.set(Math.cos(ang) * p.orbitR, p.orbitY + Math.sin(time + i) * 0.06, Math.sin(ang) * p.orbitR * 0.6);
        tmp.rotation.set(time * 0.4 + p.spin.x, time * 0.3 + p.spin.y, p.spin.z);
        sc = orbitW;
      }
      if (pourW > 0 && s < 6.7) {
        const k = clamp((pourW - p.delay) / 0.45);
        if (k > 0) {
          const e = k * k;
          tmp.position.lerpVectors(p.from, p.to, e);
          tmp.rotation.set(p.spin.x * (1 - e) * 2, p.spin.y * (1 - e) * 2, p.spin.z);
          sc = Math.max(sc, k < 0.92 ? 1 : (1 - k) / 0.08);
        }
      }
      tmp.scale.setScalar(sc);
      tmp.updateMatrix();
      pills.setMatrixAt(i, tmp.matrix);
    }
    pills.instanceMatrix.needsUpdate = true;

    // the big words
    words.forEach((m, i) => {
      const w = clamp(1 - Math.abs(s - i) * 1.7);
      m.material.opacity = 0.55 * w;
      m.visible = w > 0.01;
      m.position.x = (s - i) * -1.2;
    });

    // heartbeat and dust
    ecgMat.uniforms.uTime.value = time;
    ecgMat.uniforms.uOpacity.value = lerp(1, 0.4, clamp(s / 0.8));
    const dp = dust.geometry.attributes.position;
    for (let i = 0; i < dustCount; i++) {
      let y = dp.getY(i) + dt * 0.06;
      if (y > 5.5) y = -5.5;
      dp.setY(i, y);
      dp.setX(i, dp.getX(i) + Math.sin(time * 0.3 + dustSeed[i]) * dt * 0.02);
    }
    dp.needsUpdate = true;

    // camera
    const c = keyed(CAM, s);
    camera.position.set(c.x + pointerX * 0.25, c.y - pointerY * 0.18, c.z);
    look.set(focus.x * 0.3, focus.y * 0.4, 0);
    camera.lookAt(look);
    world.rotation.y = lerp(world.rotation.y, pointerX * 0.08, 0.05);

    composer.render(dt);
  }
  requestAnimationFrame(frame);
}

try {
  await start();
} catch (error) {
  console.warn('VITA 3D is off:', error);
  html.classList.add('no3d');
  html.classList.remove('has3d');
}
