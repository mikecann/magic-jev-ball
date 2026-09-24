// @ts-nocheck
import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { ConvexClient } from "convex/browser";
import { api } from "../convex/_generated/api";

const convex = new ConvexClient(import.meta.env.VITE_CONVEX_URL);

const $ = (id) => document.getElementById(id);
const stage = $("stage"), q = $("q"), panel = $("panel"), msg = $("msg"), meter = $("meter"), doodle = $("doodle");
const R = 1.25;               // ball radius
const SHAKE_NEEDED = 1;       // shake energy required before letting go counts
await document.fonts.load("800 40px Inter");

// ---------- Scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
// Swing the reflected studio lights up and to the left, so the hotspot isn't dead centre on the 8.
scene.environmentRotation.set(-0.45, 0.55, 0);
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
camera.position.set(0, 0, 7);

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(-3, 4, 5);
scene.add(key, new THREE.AmbientLight(0x8890ff, 0.15));

// Soft contact shadow under the ball.
const shadowTex = (() => {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d"), grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(0,0,0,0.75)"); grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.7),
  new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
shadow.position.set(0, -R - 0.35, -0.5);
scene.add(shadow);

const ball = new THREE.Group();
scene.add(ball);
ball.add(new THREE.Mesh(new THREE.SphereGeometry(R, 96, 64),
  new THREE.MeshPhysicalMaterial({ color: 0x050507, roughness: 0.35, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06 })));

// A spherical cap facing +Z with flat (decal-style) UVs, so a 2D canvas maps onto it undistorted.
function capGeometry(angle) {
  const geo = new THREE.SphereGeometry(R * 1.003, 64, 24, 0, Math.PI * 2, 0, angle);
  geo.rotateX(Math.PI / 2);
  const p = geo.attributes.position, uv = geo.attributes.uv, s = R * 1.003 * Math.sin(angle);
  for (let i = 0; i < p.count; i++) uv.setXY(i, p.getX(i) / (2 * s) + 0.5, p.getY(i) / (2 * s) + 0.5);
  return geo;
}

// Front: the white "8".
const eightCanvas = document.createElement("canvas"); eightCanvas.width = eightCanvas.height = 512;
{
  const g = eightCanvas.getContext("2d");
  const grd = g.createRadialGradient(210, 190, 20, 256, 256, 256);
  grd.addColorStop(0, "#ffffff"); grd.addColorStop(0.8, "#ececf2"); grd.addColorStop(1, "#cfcfda");
  g.fillStyle = grd; g.beginPath(); g.arc(256, 256, 256, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#0d0d10"; g.font = "800 330px Inter"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText("8", 256, 280);
}
const eightTex = new THREE.CanvasTexture(eightCanvas); eightTex.colorSpace = THREE.SRGBColorSpace;
ball.add(new THREE.Mesh(capGeometry(0.5), new THREE.MeshPhysicalMaterial({
  map: eightTex, transparent: true, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.4, envMapIntensity: 0.35,
})));

// Back: the window with the floating blue triangle, redrawn as the answer surfaces.
const winCanvas = document.createElement("canvas"); winCanvas.width = winCanvas.height = 768;
const winTex = new THREE.CanvasTexture(winCanvas); winTex.colorSpace = THREE.SRGBColorSpace;
const windowMesh = new THREE.Mesh(capGeometry(0.62), new THREE.MeshPhysicalMaterial({
  map: winTex, emissiveMap: winTex, emissive: 0xffffff, emissiveIntensity: 0.55,
  transparent: true, roughness: 0.15, clearcoat: 0.5, clearcoatRoughness: 0.2, envMapIntensity: 0.4,
}));
windowMesh.rotation.y = Math.PI;
ball.add(windowMesh);

let answerText = "";
function drawWindow(reveal) {
  const g = winCanvas.getContext("2d"), S = 768, c = S / 2;
  g.clearRect(0, 0, S, S);
  g.save(); g.beginPath(); g.arc(c, c, c, 0, Math.PI * 2); g.clip();
  const liquid = g.createRadialGradient(c, c * 0.9, 10, c, c, c);
  liquid.addColorStop(0, "#141a52"); liquid.addColorStop(0.65, "#080a24"); liquid.addColorStop(1, "#010108");
  g.fillStyle = liquid; g.fillRect(0, 0, S, S);

  if (reveal > 0.001 && answerText) {
    const e = 1 - Math.pow(1 - reveal, 3);
    g.save();
    g.globalAlpha = Math.min(1, reveal * 1.4) * 0.96;
    g.filter = `blur(${(1 - e) * 14}px)`;
    g.translate(c, c + (1 - e) * 120);
    g.rotate((1 - e) * -0.35);
    g.scale(0.75 + 0.25 * e, 0.75 + 0.25 * e);
    const w = 540, h = 470, top = -h * 0.42;
    const tri = g.createLinearGradient(0, top, 0, top + h);
    tri.addColorStop(0, "#3a4cf0"); tri.addColorStop(0.6, "#2233c9"); tri.addColorStop(1, "#18239a");
    g.fillStyle = tri;
    g.beginPath(); g.moveTo(-w / 2, top); g.lineTo(w / 2, top); g.lineTo(0, top + h); g.closePath(); g.fill();
    g.fillStyle = "#e9edff"; g.shadowColor = "rgba(170,190,255,0.9)"; g.shadowBlur = 12;
    g.font = "800 46px Inter"; g.textAlign = "center"; g.textBaseline = "middle";
    const lines = wrap(g, answerText.toUpperCase(), 340);
    const lh = 52, y0 = top + 125 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => g.fillText(l, 0, y0 + i * lh));
    g.restore();
  }
  // Inner shadow so the window reads as recessed glass.
  const rim = g.createRadialGradient(c, c, c * 0.72, c, c, c);
  rim.addColorStop(0, "rgba(0,0,0,0)"); rim.addColorStop(1, "rgba(0,0,0,0.95)");
  g.fillStyle = rim; g.fillRect(0, 0, S, S);
  g.restore();
  winTex.needsUpdate = true;
}
function wrap(g, text, max) {
  const out = []; let line = "";
  for (const word of text.split(" ")) {
    const t = line ? line + " " + word : word;
    if (g.measureText(t).width > max && line) { out.push(line); line = word; } else line = t;
  }
  return [...out, line];
}
drawWindow(0);

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.position.z = w < 520 ? 8.5 : 7;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

// ---------- Doodle hint: once per browser, after typing pauses ----------
const HINT_KEY = "magic-jev-ball:shaken";
const hintDone = () => { try { return localStorage.getItem(HINT_KEY) === "1"; } catch { return false; } };
let hintTimer;
q.addEventListener("input", () => {
  clearTimeout(hintTimer);
  doodle.classList.remove("on");
  if (hintDone() || !q.value.trim()) return;
  hintTimer = setTimeout(() => { if (!held && !busy) doodle.classList.add("on"); }, 800);
});
function retireHint() {
  clearTimeout(hintTimer);
  doodle.classList.remove("on");
  try { localStorage.setItem(HINT_KEY, "1"); } catch {}
}

// ---------- Interaction ----------
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2();
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hitPoint = new THREE.Vector3();
const pos = new THREE.Vector3(), vel = new THREE.Vector3(), target = new THREE.Vector3();
const grabOffset = new THREE.Vector3(), lastPos = new THREE.Vector3();
const spin = new THREE.Vector3();          // angular velocity (rad/s) while tumbling
const FRONT = new THREE.Quaternion(), BACK = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
let faceTarget = FRONT, held = false, energy = 0, reveal = 0, revealTarget = 0;
let pending = null, busy = false;

function pointerTo(e) {
  const r = renderer.domElement.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  camera.updateMatrixWorld();
  raycaster.setFromCamera(ndc, camera);
}
const overBall = () => { ball.updateMatrixWorld(); return raycaster.intersectObject(ball, true).length > 0; };

renderer.domElement.addEventListener("pointerdown", (e) => {
  pointerTo(e);
  if (!overBall() || busy) return;
  renderer.domElement.setPointerCapture(e.pointerId);
  raycaster.ray.intersectPlane(plane, hitPoint);
  grabOffset.copy(pos).sub(hitPoint);
  target.copy(pos); lastPos.copy(pos); lastMove = null;
  held = true; energy = 0; revealTarget = 0; faceTarget = null;
  doodle.classList.remove("on");
  panel.classList.remove("on");
  meter.classList.add("on");
  setMsg("Shake it!");
});
renderer.domElement.addEventListener("pointermove", (e) => {
  pointerTo(e);
  if (!held) { renderer.domElement.style.cursor = overBall() && !busy ? "grab" : "default"; return; }
  renderer.domElement.style.cursor = "grabbing";
  if (raycaster.ray.intersectPlane(plane, hitPoint)) {
    target.copy(hitPoint).add(grabOffset);
    chargeShake(e);
    target.x = THREE.MathUtils.clamp(target.x, -2.2, 2.2);
    target.y = THREE.MathUtils.clamp(target.y, -0.9, 0.9);
  }
});
// Direction changes (acceleration) charge the shake, not just dragging it around.
// Measured from pointer events in screen space so frame rate and screen size don't matter.
let lastMove = null;
function chargeShake(e) {
  const h = renderer.domElement.clientHeight || 1;
  const now = e.timeStamp;
  if (lastMove) {
    const dt = Math.max(0.004, (now - lastMove.t) / 1000);
    const vx = (e.clientX - lastMove.x) / h / dt, vy = (e.clientY - lastMove.y) / h / dt;
    const dv = Math.hypot(vx - lastMove.vx, vy - lastMove.vy);
    energy = Math.min(1.5, energy * Math.exp(-dt * 0.35) + dv * dt * 0.12);
    lastMove = { t: now, x: e.clientX, y: e.clientY, vx, vy };
    meter.firstElementChild.style.width = Math.min(100, (energy / SHAKE_NEEDED) * 100) + "%";
    if (energy >= SHAKE_NEEDED) setMsg("Now let go", "go");
  } else lastMove = { t: now, x: e.clientX, y: e.clientY, vx: 0, vy: 0 };
}
const release = () => {
  lastMove = null;
  if (!held) return;
  held = false; meter.classList.remove("on");
  renderer.domElement.style.cursor = "default";
  if (energy < SHAKE_NEEDED) { faceTarget = FRONT; setMsg("Shake it harder than that", "warn"); return; }
  const question = q.value.trim();
  if (!question) { faceTarget = FRONT; setMsg("Ask it a question first", "warn"); q.focus(); return; }
  retireHint();
  faceTarget = BACK; // turn the ball over, like the real thing
  ask(question);
};
renderer.domElement.addEventListener("pointerup", release);
renderer.domElement.addEventListener("pointercancel", release);

function setMsg(text, kind = "") { msg.textContent = text; msg.className = "msg " + kind; }

async function ask(question) {
  busy = true; setMsg("Consulting Jev…");
  pending = convex.action(api.jev.ask, { question }).catch((e) => ({ error: e instanceof Error ? e.message : String(e) }));
  const data = await pending;
  if (data.error) {
    answerText = "Reply hazy, try again";
    panel.innerHTML = `<div class="err">${escapeHtml(data.error)}</div>`;
  } else {
    answerText = data.answer;
    renderPanel(data);
  }
  panel.classList.add("on");
  pending = null; busy = false;
  setMsg("Hold and shake to ask again");
}

// ---------- Loop ----------
const clock = new THREE.Clock(), tmpQ = new THREE.Quaternion(), axis = new THREE.Vector3();
const settle = new THREE.Quaternion(), wobble = new THREE.Euler(), rest = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 1 / 30), t = clock.elapsedTime;

  if (held) {
    pos.lerp(target, 1 - Math.exp(-dt * 28));
    const v = pos.clone().sub(lastPos).divideScalar(dt);
    spin.x += -v.y * dt * 5; spin.y += v.x * dt * 5; spin.z += (v.x - v.y) * dt * 1.5;
    spin.multiplyScalar(Math.exp(-dt * 3));
    if (reveal > 0) { reveal = Math.max(0, reveal - dt * 3); drawWindow(reveal); } // answer sinks
  } else {
    rest.set(0, Math.sin(t * 1.3) * 0.08, 0);
    vel.addScaledVector(rest.sub(pos), dt * 90).multiplyScalar(Math.exp(-dt * 9));
    pos.addScaledVector(vel, dt);
    spin.multiplyScalar(Math.exp(-dt * 6));
  }
  lastPos.copy(pos);
  ball.position.copy(pos);

  const w = spin.length();
  if (w > 1e-4) ball.quaternion.premultiply(tmpQ.setFromAxisAngle(axis.copy(spin).divideScalar(w), w * dt));
  if (faceTarget) {
    wobble.set(Math.sin(t * 0.9) * 0.05, Math.sin(t * 0.7) * 0.07, 0);
    settle.copy(faceTarget).multiply(tmpQ.setFromEuler(wobble));
    ball.quaternion.slerp(settle, 1 - Math.exp(-dt * 4));
    // Only float the answer up once the window faces us and Jev has replied.
    if (faceTarget === BACK && answerText && !pending && ball.quaternion.angleTo(settle) < 0.25) revealTarget = 1;
  }
  if (!held && reveal < revealTarget) { reveal = Math.min(revealTarget, reveal + dt * 0.8); drawWindow(reveal); }

  shadow.scale.setScalar(1 - (pos.y + 0.1) * 0.25);
  shadow.position.x = pos.x;
  shadow.material.opacity = 0.9 - pos.y * 0.3;
  renderer.render(scene, camera);
});

// ---------- Panel ----------
function renderPanel(d) {
  const rows = Object.entries(d.probabilities)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k, p]) => `
      <div class="row ${k === d.choice ? "top" : ""}">
        <div class="lbl">${escapeHtml(d.labels[k])}</div>
        <div class="bar"><i data-w="${(p * 100).toFixed(1)}"></i></div>
        <div class="pct">${Math.round(p * 100)}%</div>
      </div>`).join("");
  panel.innerHTML = `
    <div class="meta">
      <span>model <b>${escapeHtml(d.model)}</b></span>
      <span>round trip <b class="fast">${d.ms} ms</b></span>
      ${d.confidence == null ? "" : `<span>confidence <b>${Math.round(d.confidence * 100)}%</b></span>`}
    </div>${rows}`;
  requestAnimationFrame(() =>
    panel.querySelectorAll(".bar i").forEach((el) => (el.style.width = el.dataset.w + "%")));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

$("form").addEventListener("submit", (e) => { e.preventDefault(); q.blur(); });
