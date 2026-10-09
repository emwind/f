// Shared shader additions for every world material:
//  - depth tint: the ravine floor sinks into cooler, darker air
//  - reveal: geometry that sits between the camera and the hero is dithered
//    away inside a small circle, so occluders stay visible but never hide play
import * as THREE from '../vendor/three.module.min.js';

export const worldUniforms = {
  uDeep: { value: new THREE.Color('#16232a') },
  uDeepAmount: { value: 0.5 },
  uRevealPos: { value: new THREE.Vector2(-999, -999) },
  uRevealRadius: { value: 110 },
  uRevealOn: { value: 1 },
  uPlayerY: { value: 0 },
  uPlayerDepth: { value: 0 },
  uTime: { value: 0 },
  uHighY: { value: 8.0 },
  uHaze: { value: new THREE.Color('#29332f') },
  uHazeAmt: { value: 0.25 },
  uDeepTop: { value: 2.0 },
};

export const GLSL_COMMON = /* glsl */ `
uniform vec3 uDeep;
uniform float uDeepAmount;
uniform vec2 uRevealPos;
uniform float uRevealRadius;
uniform float uRevealOn;
uniform float uPlayerY;
uniform float uPlayerDepth;
uniform float uTime;
uniform float uHighY;
uniform vec3 uHaze;
uniform float uHazeAmt;
uniform float uDeepTop;
varying vec3 vWPos;
varying float vViewZ;
float bayer4(vec2 p) {
  ivec2 q = ivec2(mod(p, 4.0));
  int i = q.y * 4 + q.x;
  int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
  return (float(m[i]) + 0.5) / 16.0;
}
void revealDiscard() {
  if (uRevealOn < 0.5) return;
  vec2 d = gl_FragCoord.xy - uRevealPos;
  d.y *= 0.85;
  float r = length(d) / uRevealRadius;
  if (r < 1.0 && vViewZ < uPlayerDepth - 1.2 && vWPos.y > uPlayerY + 1.0) {
    float th = smoothstep(0.45, 1.0, r);
    if (bayer4(gl_FragCoord.xy) > th * 0.9) discard;
  }
}
vec3 depthTint(vec3 c) {
  float k = smoothstep(uDeepTop, -0.6, vWPos.y) * uDeepAmount;
  c = mix(c, c * uDeep * 3.2, k * 0.55);
  c = mix(c, uDeep, k * 0.35);
  // the forest rim and highest ground fade slightly into cool haze
  float hk = smoothstep(uHighY - 0.5, uHighY + 2.0, vWPos.y) * uHazeAmt;
  c = mix(c, uHaze, hk);
  return c;
}
`;

export function patchWorldMaterial(mat, { instanced = false } = {}) {
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, worldUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying float vViewZ;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          ${instanced ? '#ifdef USE_INSTANCING\n wp = instanceMatrix * wp;\n#endif' : ''}
          wp = modelMatrix * wp;
          vWPos = wp.xyz;
          vViewZ = -(viewMatrix * wp).z;
        }`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL_COMMON)
      .replace('void main() {', 'void main() {\n revealDiscard();')
      .replace('#include <opaque_fragment>', '#include <opaque_fragment>\n gl_FragColor.rgb = depthTint(gl_FragColor.rgb);');
  };
  return mat;
}
