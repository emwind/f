# RESUME — bell_muted_cel3d_01

Status: **MILESTONE 1 reached** (runnable; level, player, camera, toon ramp, edge pass, water,
enemy code present). Now in MILESTONE 2 (image correction: paving tiling, foliage, ground zones).

## Experiment goal
Standalone Three.js visual hypothesis test: could Bell work as a *fully 3D* action-adventure
with restrained, muted cel/toon shading ("Alundra-like ancient fantasy translated into
restrained illustrated 3D")? One compact playable area (1–3 min): overgrown sanctuary
courtyard above a small ravine. Isolated: do not touch `experiments/sanctuary-hd2d` or Godot work.

## Run
```sh
cd experiments/bell_muted_cel3d_01
npm start            # = npx http-server -p 8090 -c-1 .   → http://localhost:8090
# or: python3 -m http.server 8090
```
No build step, no install (three.js r170 vendored in `vendor/`). ES modules need http (not file://).
URL params: `?x=..&z=..` spawn, `?pitch= &dist= &fov= &yaw=` camera, `?nohelp`, `?capture` (no rAF loop; frames on demand for tools).

Screenshots (headless, swiftshader):
```sh
npx http-server -p 8123 -c-1 . &
NODE_PATH=$(npm root -g) node tools/shot.mjs out.jpg "<query>" "<js: tp(x,z); sim({mx,mz,jump,attack,dash},secs)>" [waitMs]
```
(Playwright is globally installed in the cloud box; `tools/shot.mjs` falls back to NODE_PATH.)

## Controls
WASD/arrows move · Space jump · J / X / left-click strike · Shift / K dash ·
T toon↔Lambert · O edges+hulls · P shadows · G grade · 1–4 pitch presets (35/42/50/58) ·
[ ] distance · - = FOV · R reset · H hide help.

## Folder structure
```
index.html            page + HUD/help overlay
package.json          npm start (http-server)
vendor/               three.module.min.js r170 + license (copied)
src/main.js           renderer, lights, camera rig, input, debug keys, loop, window.__G test API
src/materials.js      PALETTE, 3-band ramp, paint shader injection (patchPaintShader), toon/Lambert twins, hull outline
src/geom.js           Batch merger, rng, chamferBox/stoneBlock, rockGeom, tubeGeom, smoothNormalsCopy
src/level.js          layout + colliders + all architecture/ground dressing + vegetation calls
src/vegetation.js     clumps (spherical-normal masses), big tree, small tree, ferns, reeds, vines, roots
src/water.js          stream + gorge water (toon-lit, depth attribute), waterfall sheet, splash rings
src/player.js         procedural adventurer rig + verlet scarf + controller + animation
src/enemy.js          stone guardian (dormant→wake→chase→windup→slam→recover, hit/stagger, crumble)
src/fx.js             dust, chips, ripples, slam shock ring
src/post.js           composite: depth-edge lines (silhouette + Laplacian crease), grade, vignette
src/collision.js      AABB boxes + ramps, cylinder push-out, ground/ceiling queries
tools/shot.mjs        headless screenshot helper
docs/screenshots/     captures (m1_* = milestone 1)
```

## Layout (metres; x east, z south toward camera, y up)
- South bank y0 (start, z 9.5..19) → stream bed −0.8 (z 6..8.5, wade or stepping stones) →
  north bank y0 → **main stair** (x −6..0, z 4.5→0, 10 steps) → **courtyard** y3 (z −12..0).
- Courtyard east edge x=10 drops into the **gorge** (x 10..18, bed −0.8, walkable, waterfall from
  culvert at z −12). **Bridge** y3 at z −7.2..−4.8 (south parapet broken: you can fall in).
- **Promontory** y3 (x 18..28) → stair (x 20.5..24.5, z −6→−12) → **terrace** y6 → **shrine**
  (sealed indigo door, bronze seal ring glows as you approach) at x −2, z −17.
- Guardian kneels dormant on the indigo ring at (−3, 3, −5.5), leashed to the courtyard.

## Rendering approach (current)
- MeshToonMaterial + 64px ramp (3 bands: shadow 0 / mid 0.42 / lit 1.0, slightly soft steps).
- Shader injection in `color_fragment`: world-space fbm posterised into soft tonal regions,
  vertical streaks on walls, moss on up-facing surfaces, height falloff toward a cool low tint
  (ravine darker/cooler). Characters use noise 0 so nothing swims.
- Vertex colours carry per-block tint; material base colour is white for environment batches.
- Geometry batched per material (≈100 draw calls, ≈200k tris).
- Post: one composite (depth Laplacian + silhouette edge, tinted not black, fades with distance);
  mild desat + split tone + vignette (G toggles).
- Characters: inverted-hull outline (smooth-normal copy), stronger than environment edges.
- Lights: Directional 2.7 warm from (−0.62, 1, 0.32) (upper-left, west-south-west), PCF soft
  shadows following the camera target; Hemisphere 1.05 (sky c3cbd0 / ground 5e5848). No tone mapping.
- Camera: pitch 42°, distance 30, FOV 34°, yaw 0, target = player + (0, 0.9, −3.6) clamped.

## Palette (materials.js PAL)
limestone b8a888 · cool stone 9c988a · paving a99d84 · dirt 7a6850 · moss 6b6f43 · leaf 56643f ·
leafDark 34432f · bark 574536 · indigo 434a6b · gold a38645 · bronze 7d6438 · water 4f6e69 /
deep 2f4b4d · player tunic 4b5876, scarf 9c5634 (single warm accent).

## Rejected approaches
- Jittered boxes with big chipped corners → read as shattered glass facets. Now chamfered boxes
  with small proportional chips.
- Icosahedron boulders for cliffs → generic low-poly. Now stacked limestone strata slabs.
- Strong low-area height tint (range −1.4..4) → start area too dark. Now −1.2..1.6.

## Known weaknesses (M1)
- Paving reads as a uniform tile grid; needs clustered loss / soil zones.
- Shrubs/small trees still read a bit like low-poly spheres.
- Flat ground patches look like polygon decals.
- Water slightly too saturated.
- Guardian when kneeling reads as a pile of green boxes.

## Next 3 tasks
1. Paving clustered by noise, larger calm soil zones, softer ground patches.
2. Foliage silhouettes (lumpy noise displacement), tree check, vines.
3. Water desat, guardian readability, then composition shot + self-critique.
