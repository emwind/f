import * as THREE from '../vendor/three.module.min.js';
import { makeTextures } from './textures.js';
import { buildLevel } from './level.js';
import { buildWorld, makeCollider } from './world.js';
import { worldUniforms } from './shaderPatch.js';

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d1210');

const tex = makeTextures();
const L = buildLevel();
const world = buildWorld(L, tex);
scene.add(world.group);

const cam = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 200);
const target = new THREE.Vector3(+(params.get('x') ?? 20), +(params.get('y') ?? 2), +(params.get('z') ?? 22));
const pitch = THREE.MathUtils.degToRad(+(params.get('pitch') ?? 42));
const dist = +(params.get('dist') ?? 30);
cam.position.set(target.x, target.y + Math.sin(pitch) * dist, target.z + Math.cos(pitch) * dist);
cam.lookAt(target);

const sunDir = new THREE.Vector3(-0.6, 1.1, -0.35).normalize();
const sun = new THREE.DirectionalLight('#ffe3bd', 2.6);
sun.position.copy(new THREE.Vector3(24, 3, 21).addScaledVector(sunDir, 60));
sun.target.position.set(24, 3, 21);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 140 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight('#b9c7c6', '#4a3f31', 1.3));
const fill = new THREE.DirectionalLight('#a7b6cc', 0.45);
fill.position.set(10, 8, 30);
scene.add(fill);

function frame(t) {
  worldUniforms.uTime.value = t / 1000;
  renderer.render(scene, cam);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.getElementById('title').classList.add('gone');
window.__world = world; window.__renderer = renderer;
window.__ready = true;
