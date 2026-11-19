import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Line2 } from "three/addons/lines/Line2.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";

const meta = await (await fetch("data/scene.json")).json();
const EX = meta.exag;
const T = meta.terrain;
const D2R = Math.PI / 180;

// ---- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd8cfb4, 45000, 190000);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 50, 400000);
scene.add(new THREE.AmbientLight(0xffffff, 1.55));
const sun = new THREE.DirectionalLight(0xfff2dc, 1.25);
sun.position.set(-0.663, 0.643, 0.383).multiplyScalar(1000);   // 西南方斜照（同 Blender）
scene.add(sun);

// ---- terrain
const hbuf = new Uint16Array(await (await fetch("data/height.bin")).arrayBuffer());
const { nx, ny } = T;
const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2);
const z13 = T.z13;
for (let r = 0; r < ny; r++) {
  const Y11 = T.z11y0 + (T.j0 + r * T.step + 0.5) / 256;
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * Y11 / 2048))) / D2R;
  const y = (lat - meta.lat0) * meta.ky;
  for (let c = 0; c < nx; c++) {
    const X11 = T.z11x0 + (T.i0 + c * T.step + 0.5) / 256;
    const lon = X11 / 2048 * 360 - 180;
    const k = r * nx + c;
    pos[k * 3] = (lon - meta.lon0) * meta.kx;
    pos[k * 3 + 1] = hbuf[k] / 10 * EX;
    pos[k * 3 + 2] = -y;
    uv[k * 2] = (X11 * 4 - z13.x0) / z13.nx;
    uv[k * 2 + 1] = 1 - (Y11 * 4 - z13.y0) / z13.ny;
  }
}
const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
let q = 0;
for (let r = 0; r < ny - 1; r++) for (let c = 0; c < nx - 1; c++) {
  const a = r * nx + c, b = a + 1, d = a + nx, e = d + 1;
  idx.set([a, d, b, b, d, e], q); q += 6;
}
const tg = new THREE.BufferGeometry();
tg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
tg.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
tg.setIndex(new THREE.BufferAttribute(idx, 1));
tg.computeVertexNormals();
const loader = new THREE.TextureLoader();
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function prep(t) { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; }
const tex4k = prep(await loader.loadAsync("data/tex_4k.jpg"));
const tmat = new THREE.MeshLambertMaterial({ map: tex4k });
scene.add(new THREE.Mesh(tg, tmat));

// ---- 廠房方塊
const wall = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.42, 0.36, 0.26) });
const roofs = [[0.12, 0.13, 0.14], [0.20, 0.16, 0.12], [0.28, 0.10, 0.07]].map(c => new THREE.MeshLambertMaterial({ color: new THREE.Color(...c) }));
const ink = new THREE.LineBasicMaterial({ color: 0x2a211a });
meta.boxes.forEach((b, i) => {
  const g = new THREE.BoxGeometry(b.w, b.h, b.d);
  const m = new THREE.Mesh(g, [wall, wall, roofs[i % 3], wall, wall, wall]);
  m.position.set(b.x, b.z * EX + b.h / 2, -b.y);
  m.rotation.y = b.rot;
  m.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), ink));
  scene.add(m);
});

// ---- 85 大樓（直立面板，轉向相機）
const tw = meta.tower;
const towerTex = prep(await loader.loadAsync(tw.img));
const tower = new THREE.Mesh(new THREE.PlaneGeometry(tw.h * tw.aspect, tw.h).translate(0, tw.h / 2, 0),
  new THREE.MeshBasicMaterial({ map: towerTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, fog: true }));
tower.position.set(tw.pos[0], tw.pos[2] * EX, -tw.pos[1]);
scene.add(tower);

// ---- 路線
const routes = new THREE.Group();
const lineMats = [];
for (const r of meta.routes) {
  const p = [];
  for (const [x, y, z] of r.pts) p.push(x, z * EX + 45, -y);
  const g = new LineGeometry(); g.setPositions(p);
  const m = new LineMaterial({ color: r.color, linewidth: r.kind === "國道" ? 2.6 : 3.2, dashed: r.dash, dashSize: 260, gapSize: 170, worldUnits: false });
  if (r.dash) m.defines.USE_DASH = "";
  lineMats.push(m);
  const l = new Line2(g, m); l.computeLineDistances();
  routes.add(l);
}
scene.add(routes);

// ---- 名牌：2D 疊層，每格依螢幕位置排，互相避開（園區優先；其他放不下就先不顯示）
const ov = document.createElement("canvas");
ov.style.pointerEvents = "none"; ov.style.zIndex = 1;
document.body.insertBefore(ov, document.getElementById("panel"));
const ctx = ov.getContext("2d");
const labels = { visible: true };
const PRI = { park: 0, landmark: 1, river: 2, town: 3, mount: 3 };
const LBL = await Promise.all(meta.labels.map(L => new Promise(res => {
  const im = new Image(); im.onload = () => res({ ...L, im, p: new THREE.Vector3(L.pos[0], L.pos[2] * EX + 20, -L.pos[1]) }); im.src = L.img;
})));
LBL.sort((a, b) => PRI[a.kind] - PRI[b.kind]);
const v = new THREE.Vector3();
function drawLabels() {
  const dpr = renderer.getPixelRatio();
  if (ov.width !== innerWidth * dpr || ov.height !== innerHeight * dpr) {
    ov.width = innerWidth * dpr; ov.height = innerHeight * dpr;
    ov.style.width = innerWidth + "px"; ov.style.height = innerHeight + "px";
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  if (!labels.visible) return;
  const S = innerWidth < 700 ? 0.62 : 0.85;
  const placed = [], panel = document.getElementById("panel").getBoundingClientRect();
  const hit = r => placed.some(o => r[0] < o[2] + 3 && o[0] < r[2] + 3 && r[1] < o[3] + 3 && o[1] < r[3] + 3);
  const out = [];
  for (const L of LBL) {
    v.copy(L.p).project(camera);
    if (v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1) continue;
    const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const w = L.w * S, h = L.h * S;
    let best = null;
    for (const lift of [14, 44, 80, 120, 170]) for (const dx of [0, -(w + 6), w + 6, -2 * (w + 6), 2 * (w + 6)]) {
      if (best) break;
      const r = [x + dx - w / 2, y - lift - h, x + dx + w / 2, y - lift];
      if (r[1] > 0 && !hit(r) && !(r[0] < panel.right && r[1] < panel.bottom)) best = r;
    }
    if (!best && L.kind === "park") best = [x - w / 2, y - 14 - h, x + w / 2, y - 14];
    if (!best) continue;
    placed.push(best, [x - 5, y - 5, x + 5, y + 5]);
    out.push([L, x, y, best]);
  }
  for (const [L, x, y, r] of out) {          // 引線與朱點
    const ex = Math.min(Math.max(x, r[0] + 2), r[2] - 6), ey = r[3] - 4;
    ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(239,228,198,.55)"; ctx.lineWidth = 3.6; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x, y); ctx.stroke();
    ctx.strokeStyle = "rgba(42,33,26,.9)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x, y); ctx.stroke();
  }
  for (const [L, x, y, r] of out) {
    ctx.drawImage(L.im, r[0], r[1], r[2] - r[0], r[3] - r[1]);
  }
  for (const [L, x, y] of out) {
    ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2);
    ctx.fillStyle = "#9E3B2E"; ctx.fill(); ctx.strokeStyle = "#EFE4C6"; ctx.lineWidth = 1.4; ctx.stroke();
  }
}

// ---- 相機與操作
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.screenSpacePanning = false;
controls.maxPolarAngle = 86 * D2R;
controls.minDistance = 1500;
controls.maxDistance = 160000;
let hfov = 100;
function setFov() {
  const a = innerWidth / innerHeight;
  camera.fov = Math.min(2 * Math.atan(Math.tan(hfov / 2 * D2R) / a) / D2R, 80);
  camera.aspect = a;
  camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(innerWidth, innerHeight);
}
function view(c) {
  const x = (c.lon - meta.lon0) * meta.kx, y = (c.lat - meta.lat0) * meta.ky;
  const t = c.tilt * D2R, a = c.yaw * D2R;
  const f = new THREE.Vector3(Math.cos(a) * Math.cos(t), -Math.sin(t), -Math.sin(a) * Math.cos(t));
  camera.position.set(x, c.alt, -y);
  controls.target.copy(camera.position).addScaledVector(f, c.alt / Math.sin(t));
  hfov = 2 * Math.atan(18 / c.lens) / D2R;
  setFov();
  controls.update();
}
const C = meta.cam;
view(C);
document.getElementById("bView").onclick = () => view(C);
document.getElementById("bTop").onclick = () => view({ lon: 120.33, lat: 22.60, alt: 70000, tilt: 89.9, yaw: 90, lens: 30 });
function toggle(id, obj) {
  const b = document.getElementById(id);
  b.onclick = () => { obj.visible = !obj.visible; b.setAttribute("aria-pressed", obj.visible); };
}
toggle("bLabels", labels);
toggle("bRoutes", routes);
const legend = document.getElementById("legend");
document.getElementById("bRoutes").addEventListener("click", () => { legend.style.visibility = routes.visible ? "" : "hidden"; });
const bHi = document.getElementById("bHi");
let texFull = null;
if (renderer.capabilities.maxTextureSize < 8192) bHi.style.display = "none";
bHi.onclick = async () => {
  const on = bHi.getAttribute("aria-pressed") !== "true";
  if (on && !texFull) { bHi.textContent = "載入中…"; texFull = prep(await loader.loadAsync("data/tex_full.jpg")); bHi.textContent = "高畫質貼圖"; }
  tmat.map = on ? texFull : tex4k; tmat.needsUpdate = true;
  bHi.setAttribute("aria-pressed", on);
};
addEventListener("resize", () => { renderer.setSize(innerWidth, innerHeight); setFov(); });

const ld = document.getElementById("load");
ld.style.opacity = 0; setTimeout(() => ld.remove(), 700);
renderer.setAnimationLoop(() => {
  controls.update();
  tower.rotation.y = Math.atan2(camera.position.x - tower.position.x, camera.position.z - tower.position.z);
  renderer.render(scene, camera);
  drawLabels();
});
