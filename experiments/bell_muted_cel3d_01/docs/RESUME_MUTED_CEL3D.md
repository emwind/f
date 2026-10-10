# RESUME — bell_muted_cel3d_01

## HERO-ASSET REFINEMENT PASS (in progress — read this first)
Goal: can a few hand-authored hero assets + art direction change the read of the whole scene?
Scope rules: no new level/enemy/systems/traversal; keep 42° camera, layout, palette, controls,
toon system, outline strength, shrine destination.

Benchmark captures: `TAG=before|after NODE_PATH=$(npm root -g) node tools/capture.mjs`
→ `docs/screenshots/refine/{before,after}-01-hero-stair-courtyard, -02-guardian-close, -03-tree,
-04-shrine, -05-ordinary`. `before-*` captured. WIP shots: `refine/wip-*`.

1. **Guardian — DONE.** `src/enemy.js` geometry rebuilt (behaviour/pose code unchanged). New
   `hewn(profile, depth, mat, …)` = hand-drawn asymmetric front silhouette polygons extruded with
   a tiny bevel, flat normals, vertex-colour stain from below + darker back faces + per-triangle
   localized moss. Design: pedestal feet, wide skirt slab with indigo course, one tapered stele
   torso with a broken-away right shoulder (jagged break slab, fern sprouting), shrine-roof cap,
   recessed head niche (dark recess + lintel + jambs, sunk face + eye slit), indigo/gold seal motif
   on the chest (echoes the shrine door), dark crack strips, massive intact left arm with mossy
   pauldron + bronze disc, thinner broken right arm. root scale 1.15, hull ×1.1. Old `blk()` removed.
   Verdict: no longer reads robotic/golem; reads as a carved shrine-sentinel. Still flat-extruded
   (front-view authored; side views are slab-like).
2. **Tree — DONE.** `src/vegetation.js`: new `tier()` (broad flat-bottomed scalloped canopy tier:
   lobed rim, lit crown → mid rim → cool dark underside in vertex colour, ellipsoid normals) and
   `mass()` (main tier + stepped rim lobes). `bigTree` rewritten: thick leaning kinked trunk, 7
   short curling buttress roots, 3 major limbs + 4 twigs visible between 4 tiers at distinct
   heights, two hanging vine groups. `shrub()` and `smallTree()` now use tiers (shared language).
   `src/level.js`: courtyard surface roots now meander and are thinner (were straight "stilts").
   `src/main.js`: canopy fade radius 6.4 around (−14.2, −6.4).
   Verdict: biggest visible change so far — designed tree silhouette with negative space; tiers
   are slightly "stone-pine/acacia", which suits ancient-Mediterranean mood.
3. **Shrine — NEXT.** Then material/value + lighting mood pass, then `TAG=after` capture + verdict.


Status: **all milestones (0–4) reached; the handoff is complete.** The prototype runs, the route
is fully traversable, combat with the guardian works (wake → telegraphed slam → hits → crumble),
and the screenshot set has been captured. The visual verdict and its reasoning are in
`README.md` under "Candid visual assessment".

## Goal

A standalone Three.js visual hypothesis test: could Bell work as a fully 3D action-adventure with
restrained, muted cel shading? The target is "Alundra-like ancient fantasy translated into
restrained illustrated 3D".

It is one compact area: an overgrown sanctuary courtyard above a ravine. It is isolated from the
rest of the repo. Don't touch `experiments/sanctuary-hd2d` or any Godot work.

## Current visual hypothesis

Readable 3D comes from three things working together:
- a fixed 42° camera
- a 3-band toon ramp
- painted world-space tonal regions, all in a muted limestone/olive/indigo/bronze palette

The finding so far: readability and coherence work. "Illustrated" is only partly achieved. Most of
the illustration comes from geometry, palette and painted value zones, not from the toon ramp or
the edges.

## Run

```sh
cd experiments/bell_muted_cel3d_01
npm start                 # npx http-server -p 8090 -c-1 .  → http://localhost:8090
# or: python3 -m http.server 8090
```

There is no install or build step. three.js r170 is vendored. ES modules need http, so
`file://` won't work.

URL params:
- `?x=&z=` spawn position
- `?pitch=&dist=&fov=&yaw=` camera
- `?nohelp` hide the help box
- `?capture` no rAF loop; `window.__G.render()` renders a frame on demand

Headless screenshots (Playwright is global in the cloud box; the scripts fall back to `NODE_PATH`):

```sh
npx http-server -p 8123 -c-1 . &
NODE_PATH=$(npm root -g) node tools/capture.mjs [prefix]          # documented set
NODE_PATH=$(npm root -g) node tools/shot.mjs out.jpg "<query>" "tp(x,z); sim({mx,mz,jump,attack,dash},secs)" [waitMs]
```

`window.__G` exposes:
- `sim(input, seconds)`: fixed-step simulation
- `tp(x, z)`: teleport the player
- `toggle(code)`: press a debug key
- `snapCam()`, `render()`
- the `player`, `guardian`, `post`, `CAM` and `STATE` objects

Warning: never run `pkill -f shot.mjs` inside a command that also contains `shot.mjs`. It kills
its own shell.

## Controls

- Movement: WASD/arrows move · Space jump · J/X/click strike · Shift/K dash
- Debug: T toon↔Lambert · O edges+hulls · P shadows · G grade · C shade zones
- Camera: 1–4 pitch 35/42/50/58 · [ ] distance · - = FOV
- Misc: R reset · H help

## Folder structure

```
README.md, index.html, package.json
vendor/three.module.min.js (+LICENSE)   copied r170
src/main.js        renderer, lights, camera rig, input, debug keys, canopy fade, seal glow, loop, __G API
src/materials.js   PAL palette, RAMP, GLOBAL uniforms (uTime, uLowTint, uLowRange, uCloud), patchPaintShader,
                   paintMat (cached toon + Lambert twin in userData.alt), applyShadingMode, hull outlines
src/geom.js        rng/R/rr, noise3, Batch (merge → 1 draw/material), mat4, chamferBox, stoneBlock,
                   rockGeom, tubeGeom, smoothNormalsCopy
src/level.js       layout constants (Y, SPAWN, SHRINE_DOOR), colliders, masonry/rockFace/pave/patch/pillar/stairs
                   builders, all dressing, vegetation placement
src/vegetation.js  clump (noise-lobed, spherical normals), shrub, bigTree (separate canopy batch), smallTree,
                   fern, reeds, vine, vineCurtain, root
src/water.js       stream + gorge (toon-lit, aDepth attribute), waterfall sheet, splash rings
src/player.js      procedural adventurer rig, verlet scarf ribbon, controller (gravity, step-up, stair snap,
                   coyote, dash, wading slow, fall respawn), animation, slash arc
src/enemy.js       Guardian: dormant/wake/chase/windup/slam/recover/return, hit flash + stagger, crumble debris
src/fx.js          dust, chips, ripples, slam shock ring
src/post.js        composite: depth silhouette + Laplacian crease edges, grade, vignette, draw stats
src/collision.js   AABB boxes + z/x ramps; ground(), resolve() cylinder push-out, ceiling()
tools/shot.mjs, tools/capture.mjs
docs/screenshots/  01–14 final set + m1_…m4_ milestone history
```

Everything was created in this task. Nothing outside the folder was modified.

## Layout (metres; x east, z south toward camera, y up)

| Area | Height | Extent |
| --- | --- | --- |
| South bank (start) | 0 | spawn (−9, 14) |
| Stream | bed −0.8, water −0.38 | z 6..8.5; bank ramps on both sides; stepping stones near x −4 |
| North bank | 0 | z 0..5 |
| Main stair | 0 → 3 | x −6..0, z 4.5 → 0, 10 steps |
| Courtyard | 3 | x −24..10, z −12..0; tree at (−17.5, −7.5); guardian ring at (−3, −5.5); colonnade at z −10.2 |
| Gorge | bed −0.8 | x 10..18, z −12..6; culvert waterfall at x 14, z −12 |
| Bridge | 3 | z −7.2..−4.8; south parapet gap at x 13.4–15.6 |
| Promontory | 3 | x 18..28; fallen head at (25.2, −2.8) |
| Promontory stair | 3 → 6 | x 20.5..24.5, z −6 → −12 |
| Terrace | 6 | z −24..−12 |
| Shrine | façade at z −17.6 | door at x −2, plinth top 6.66 |
| Bounds | — | cliffs west (x < −24), east (x > 28), north (z < −24); invisible wall at z 19 |

## Rendering approach

- **Toon ramp.** MeshToonMaterial with the RAMP texture: 64 px, bands 0 / 0.42 / 1.0, soft edges
  of about 0.08 in N·L.
- **Twin materials.** The T key swaps every painted mesh's material for its Lambert twin
  (`applyShadingMode`).
- **Paint injection** (`color_fragment`):
  - fbm × `uNoiseScale`, posterised by `bands()` and scaled by `uNoiseAmt`
  - wall streaks (`uStreak`)
  - moss on n.y > 0.55 (`uMoss`, `uMossColor`)
  - height falloff (`uLowRange` −1.2..1.6 → `uLowTint` 56656a)
  - shade zones (`uCloud` 0.24, fbm of xz × (0.05, 0.065))

  Characters use noise 0 and moss 0, so nothing swims on moving objects. The guardian's moss is
  baked into object-space vertex colour instead.
- **Environment batches.** Material colour is white; the palette lives in vertex colours.
- **Lights.**
  - Directional fff0d8, intensity 2.7, direction (−0.72, 0.8, 0.36)
  - Shadow map 2048, ortho ±24, bias −0.0006, normalBias 0.04
  - Hemisphere c3cbd0 / 5e5848, intensity 1.05
  - NoToneMapping
  - Fog 8f988f, 34–95
  - Background 9aa29a
- **Post.**
  - Rendered to an MSAA ×4 HalfFloat render target with a depth texture
  - Edges: sil smoothstep(0.006, 0.025), lap smoothstep(0.0025, 0.009); strength 0.7; edge
    colour multiplier (0.46, 0.41, 0.37); fades out between 38 and 70 m
  - Grade: 0.9 saturation, split tone, vignette 0.55
- **Hull outlines.** Colour 231b16, width 0.022; the guardian's is 1.25×.

## Camera

- pitch 42°, distance 30, FOV 34°, yaw 0
- target = player + (0, 0.9 + 0.8y, −3.6), with x clamped to [−12, 19] and z to [−19, 9]
- exponential follow at a rate of 4/s
- the shadow frustum follows the camera target

## Palette and materials

All values are in `materials.js` PAL. Key decisions:
- Limestone is warm (b8a888) where exposed and cool (9c988a) lower down. Lower masonry courses are
  lerped toward limeDark.
- The coping lip is lighter (c2b494) to mark walkable edges.
- Leaves are desaturated olive/forest greens, with darker undersides baked into vertex colour.
- Indigo (434a6b / 2e3350) and bronze/gold (7d6438 / a38645) are used only for sanctuary motifs.
- Water is 506660 shallow and 2c4143 deep, with a pale foam colour of b9bfae.
- The player is muted indigo-blue, with a rust scarf (9c5634) as the one warm accent.

## Rejected approaches and why

- **Jittered boxes with large chipped corners** read as shattered glass facets. I replaced them
  with chamferBox, small proportional jitter and rare chips.
- **Icosahedron rocks/cliffs** looked generic low-poly. I replaced them with layered limestone
  strata slabs.
- **A strong low-area tint (range −1.4..4)** made the start area muddy. The range is now −1.2..1.6.
- **Random per-slab paving loss** looked like a uniform tiling grid. Loss is now clustered by
  noise3, with tilted, broken fringe slabs.
- **Leaf blobs on vine stems** looked like lollipops. Vine leaves are now elongated pads that hug
  the wall.
- **A deep recessed shrine door (1.4 m)** hid the door from a 42° camera. The recess is now 0.6 m
  and the door slab is brighter indigo.
- **material.clone() on paint materials** crashes because of circular userData (alt ↔ alt). Use
  `paintMat` with a distinct param key instead.

## Known bugs

- The east cliff top ends short, so sky shows at the top right on the promontory (shot 08).
- Guardian crumble debris can come to rest slightly floating or interpenetrating. The physics
  is simple per-piece ground snapping.
- The guardian can't follow onto the stairs or the bridge, because it is leashed to the
  courtyard. That's intentional, but it can look abrupt.
- The player can stand on top of the stair cheek walls and some low props. That's harmless.
- Hit detection is circle-based. A strike can connect around a pillar.
- Performance has only been measured in SwiftShader. Real-GPU fps hasn't been checked. There's an
  fps / draws / tris readout bottom-left in the live build.

## Known visual weaknesses

- Clean low-poly indie feel. Tops are flat and evenly lit, and the uniformity of the chamfered
  boxes shows.
- Foliage is still blobby. There is no painted silhouette breakup (cards or alpha).
- The start area and stream are flat, and the stream is perfectly straight.
- The fallen head and the guardian read blocky and slightly robotic.
- The edges are subtle enough to contribute little.
- Toon vs Lambert makes only a small difference on planar geometry.
- The lighting is "clear afternoon"; there is no mood lighting.

## Screenshots

`docs/screenshots/`:
- 01 is the strongest, 02 the weakest
- 03–08 are areas and combat
- 09–13 are toggle and pitch comparisons
- 14 is the grayscale value check
- m1_* … m4_* are the milestone history

## Next 3 tasks (priority order)

1. **Break the low-poly read.** Add authored hand-painted vertex colour or small stylised
   textures on paving and walls: edge wear, AO in the joints, painted cracks. Add alpha-card
   leaf fringes around the foliage masses. Replace the straight stream with a curved terrain mesh
   for the banks.
2. **Mood lighting pass.** Try a lower, warmer sun with longer shadows and a darker, cooler
   ravine. Try a single light shaft or canopy-dapple cookie over the shrine forecourt. Re-check
   the grayscale composition.
3. **Hand-model two hero assets** (guardian and fallen head), or import a test glTF, to see
   whether bespoke silhouettes rather than procedural boxes close the gap to "illustrated". If
   they do, port the camera, ramp and paint shader to Godot.

## Implementation assumptions

- Fixed camera yaw (looking north), so "up" on the controls is −z.
- All geometry is deterministic (seeded rng), so screenshots are reproducible.
- The collision world is axis-aligned: boxes plus ramps, step-up 0.45, player radius 0.3,
  height 1.5. Stairs are ramps with visual steps; the ramp is offset by one rise.
- Below y −6 the player respawns at the last safe grounded position and takes 1 damage.
  At 0 hp the player respawns at the start.
- The guardian has 5 hp. Being hit interrupts its windup.
