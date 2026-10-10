import * as THREE from '../vendor/three.module.min.js';

// One composite pass: subtle depth-based edge lines (silhouettes + creases via
// a depth Laplacian), tinted rather than black, plus a mild illustrative grade.
export class Post {
  constructor(renderer, w, h) {
    this.renderer = renderer;
    const dt = new THREE.DepthTexture(w, h);
    dt.type = THREE.UnsignedIntType;
    this.rt = new THREE.WebGLRenderTarget(w, h, { samples: 4, type: THREE.HalfFloatType, depthTexture: dt });
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: this.rt.texture }, tDepth: { value: dt },
        uTexel: { value: new THREE.Vector2(1 / w, 1 / h) },
        uNear: { value: 1 }, uFar: { value: 200 },
        uEdge: { value: 0.7 }, uEdgeColor: { value: new THREE.Vector3(0.46, 0.41, 0.37) },
        uGrade: { value: 1 },
      },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        #include <common>
        varying vec2 vUv;
        uniform sampler2D tColor, tDepth; uniform vec2 uTexel; uniform float uNear, uFar, uEdge, uGrade; uniform vec3 uEdgeColor;
        float lin(vec2 uv){ float z = texture2D(tDepth, uv).x * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
        void main(){
          vec4 col = texture2D(tColor, vUv);
          float c = lin(vUv);
          vec2 o = uTexel;
          float l = lin(vUv - vec2(o.x, 0.0)), r = lin(vUv + vec2(o.x, 0.0));
          float d = lin(vUv - vec2(0.0, o.y)), u = lin(vUv + vec2(0.0, o.y));
          // silhouette: step in depth (relative); crease: second derivative
          float sil = max(max(abs(l - c), abs(r - c)), max(abs(d - c), abs(u - c))) / c;
          float lap = (abs(l + r - 2.0 * c) + abs(d + u - 2.0 * c)) / c;
          float e = smoothstep(0.006, 0.025, sil) * 0.9 + smoothstep(0.0025, 0.009, lap) * 0.5;
          e = clamp(e, 0.0, 1.0) * uEdge;
          // edges fade with distance so far masses stay soft
          e *= 1.0 - smoothstep(38.0, 70.0, c);
          vec3 rgb = mix(col.rgb, col.rgb * uEdgeColor, e);
          if (uGrade > 0.5) {
            float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
            rgb = mix(vec3(lum), rgb, 0.9);                     // gentle overall desaturation
            vec3 shadowTint = vec3(0.93, 0.98, 1.05), lightTint = vec3(1.03, 1.0, 0.95);
            rgb *= mix(shadowTint, lightTint, smoothstep(0.05, 0.45, lum));
            vec2 q = vUv - 0.5;
            rgb *= 1.0 - dot(q, q) * 0.55;                       // soft vignette
          }
          gl_FragColor = vec4(rgb, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.qs = new THREE.Scene(); this.qs.add(this.quad);
    this.qc = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  }
  setSize(w, h) { this.rt.setSize(w, h); this.mat.uniforms.uTexel.value.set(1 / w, 1 / h); }
  render(scene, camera) {
    this.mat.uniforms.uNear.value = camera.near; this.mat.uniforms.uFar.value = camera.far;
    this.renderer.setRenderTarget(this.rt);
    this.renderer.render(scene, camera);
    const i = this.renderer.info.render; this.stats = { calls: i.calls, tris: i.triangles };
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.qs, this.qc);
  }
}
