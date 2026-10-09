# Ravine Sanctuary: an Alundra-lineage 2D/3D hybrid slice

A standalone, playable vertical slice (about 5 to 10 minutes) that explores how
Alundra's visual language could evolve with a modern hybrid renderer: real 3D
terrain, architecture, light and shadow, with hand-built pixel-art sprites for
the hero, creatures and vegetation. It is deliberately *not* Octopath-style
HD-2D: no tilt-shift, no miniature look, no heavy depth of field, no bloom,
no glossy PBR, no cinematic post stack.

It is fully self-contained in this folder and does not touch any other
project in the repository.

![Strongest shot: the sanctuary waterfall](docs/screenshots/00-strongest.jpg)

## Run it

No build step. three.js r170 is vendored in `vendor/`. Any static file server
works:

```sh
cd experiments/sanctuary-hd2d
npm start                 # npx http-server -p 8080 -c-1 .
# then open http://localhost:8080
```

or `python3 -m http.server 8080` from the same folder. Opening `index.html`
straight from disk will not work (ES modules need http).

Useful URL parameters for testing:

| Parameter | Effect |
| --- | --- |
| `?notitle` | skip the title screen |
| `?map=shrine` / `?map=vista` | start in the Underground Shrine or the Hidden Vale |
| `&x=..&z=..` | spawn position (tile units) |
| `&flags=sun:roof,sun:bridge` | preset story flags (comma list) |
| `&god` | 99 hearts |
| `&pitch=..&viewH=..&fov=..` | camera rig overrides |

`npm run check` runs `tools/reach.js`, a reachability test over the level data
(every objective, secret and the shortcut must be reachable with the jump and
step heights the player actually has).

## Controls

| Action | Keyboard | Gamepad |
| --- | --- | --- |
| Move (8 directions) | WASD / arrow keys | left stick / d-pad |
| Jump | Space | A |
| Attack (in the air: down-thrust) | J or Z | X |
| Dash (short i-frames) | K, X or Shift | B / RB |
| Interact (read, lever, chest) | E or C | Y |
| Debug panel | F1 or ` | |
| Mute | M | |

Falling off the world is impossible; dying returns you to the last checkpoint
with full hearts and keeps your story flags.

## The route

```
                 ┌──────────── OVERGROWN SANCTUARY (z 0-41) ─────────────┐
   north         │ shrine door (needs 3 sun-stones)   waterfall + secret │
     ▲           │ upper court 5, roofed hall, pinnacle 6, altar dais 7  │
     │           │ ravine (0) with stream, broken stone bridge (3)       │
                 │ outskirts terrace (3) ─ lever ─ grate shortcut ───┐   │
                 ├──────────── RUINED COURTYARD (z 42-63) ───────────┼───┤
                 │ moat jump, pool, broken aqueduct (3.5), terraces  ◄┘   │
                 │ roofless house (west), ruins (east)                    │
                 ├──────────── FOREST APPROACH (z 64-85) ─────────────────┤
                 │ start ridge (7) ─ arch bridge to lookout (7)           │
                 │ lower path beneath the arch (4), east glade ruins      │
   south         └───────────────────────────────────────────────────────┘
  (camera side)

  shrine door ─► UNDERGROUND SHRINE: entrance (4), grand stair, hall (0) with
                 channel and galleries (2), cracked wall ─► secret chamber
              ─► WARDEN'S CHAMBER: miniboss, door seals behind you
              ─► THE HIDDEN VALE: a promontory over a lake valley and a
                 drowned tower (composed reveal, end of slice)
```

1. **Forest Approach.** Start on a high ridge. The arch bridge leads to a
   lookout; the path beneath it is the way down. Distant sanctuary walls and the
   courtyard pool are visible long before you can reach them.
2. **Ruined Courtyard.** First real enemies, a stone pool under a broken
   aqueduct, raised terraces. A grate in the north wall is locked from the far
   side: that is the shortcut you open later.
3. **Overgrown Sanctuary.** The hub. A stele explains the puzzle: three
   sun-stones (on the hall roof, beneath the broken bridge in the ravine, and on
   the altar dais) must be struck awake. Each needs different traversal: a
   climb onto the roof through its ragged hole, a drop into the ravine, the
   pinnacle and root ramp. The lever on the outskirts terrace raises the grate
   back into the courtyard. When the third stone wakes, the camera shows the
   shrine door sinking.
4. **Underground Shrine.** Cooler and darker, carved reliefs, brazier light as
   warm accents. Water channel, side galleries, one cracked gallery wall.
5. **Warden's Chamber.** The Root Warden: rear-and-charge, stomp shockwaves you
   jump over, seed volleys, and in its second phase it calls moths. Its death
   opens the far door.
6. **The Hidden Vale.** A composed reveal beyond the shrine: a promontory over a
   valley lake with a drowned tower, a cascade and forest slopes. Walking to the
   edge ends the slice.

**Secrets:** a heart vessel in a niche behind the sanctuary waterfall, and a
chest behind the cracked wall in the shrine. **Shortcut:** the grate between
the outskirts and the courtyard.

**Enemies:** slime (small melee, hops), bulb (rooted ranged seed spitter),
sentinel (heavy guardian: telegraphed raise, slam and ring shockwave), moth
(flying, circles and swoops), plus the Warden.

## Screenshots

| | |
| --- | --- |
| ![](docs/screenshots/01-forest-approach.jpg) Forest Approach, start ridge | ![](docs/screenshots/02-forest-arch-bridge.jpg) Arch bridge and the lower path |
| ![](docs/screenshots/03-ruined-courtyard.jpg) Ruined Courtyard | ![](docs/screenshots/03b-courtyard-aqueduct.jpg) On the broken aqueduct |
| ![](docs/screenshots/04-sanctuary-waterfall.jpg) Sanctuary waterfall (secret behind it) | ![](docs/screenshots/05-ravine-bridge.jpg) Ravine and the broken bridge |
| ![](docs/screenshots/06-combat.jpg) Combat: slash, hit flash on a sentinel | ![](docs/screenshots/07-shrine-hall.jpg) Underground Shrine hall |
| ![](docs/screenshots/08-warden-fight.jpg) The Root Warden | ![](docs/screenshots/09-hidden-vale.jpg) The Hidden Vale |
| ![](docs/screenshots/10-debug-low-camera.jpg) Debug panel, 32° camera | |

Screenshots were captured headless (software WebGL) with `tools/capture.mjs`.

## Art pass 2: authored refinement

A visual-only pass over the same slice. No areas, enemies, mechanics, puzzles
or systems were added; the level grid, collision, route, camera and debug
tools are unchanged (`node tools/reach.js` and the scripted playtests give the
same results as before). What changed is how the existing content is drawn.

![](docs/screenshots/pass2/00-strongest.jpg)

**Vegetation as composition, not scatter** (`placePlants` in `decor.js`).
Every tile is read for its niche (water edge, damp wall base, forest floor,
meadow, dry stone, shrine). Clusters seed sparsely per niche with large-scale
patchiness, carry big plants in the middle and small ones at the rim, and keep
stair mouths, interactables, jump edges and enemy floors clear. Key views get
authored clusters (`dressing` in `level.js`). Small plant instances went from
about 3,800 to about 2,400 (37% fewer): grass tufts halved, mushrooms down 75%,
flowers gathered into drifts, while ferns and reeds grew where water and walls
give them a reason to.

**Masonry silhouettes** (`masonryKit.js`). A small kit dressed along every
built wall edge: coping courses (intact, worn, broken, missing) on retaining
walls, limestone capstones with notches on free-standing walls, chunky corner
stones, stepped collapsed wall ends with rubble, protruding stones on tall
faces, drains over water, damp-tinted stones near water. Visual only.

**Ground** (`flagstoneTextures`, `dampWearField`). Paving is now laid in
east-west courses of long slabs with worn corners, cracks and sunken stones.
Moss is no longer painted into every joint: a per-vertex damp field (water,
wall bases with runoff, tree shade) blends a damp version of the paving in,
and a wear field softens walked floors and trampled verges. The dark seam at
grass edges is lighter and only strong where it is damp.

**Hero** (`heroFrame` in `sprites.js`). Repainted at the same size: a mop of
chestnut locks with a tied tail instead of a gold cap, a rust scarf collar
separating head and body, indigo tunic over undyed sleeves and trousers,
worn boots, belt pouch. New dash and falling poses, a wince on hurt, a lean on
attack and dash, and hair tail and scarf that sway per frame.

**Trees.** Crowns are 2 to 5 separate masses carried on visible limbs at
different heights and reaches, each a tight knot of clumps (big centre, small
rim, darker underneath and behind), with varied trunk heights.

**Area light** (`MOODS` in `main.js`). The sun keeps its angle; colour,
intensity, sky fill, ravine depth tint and sprite light blend by area: cool
forest shade with warm sun patches, open warm courtyard, high-contrast
sanctuary with cool ravine shadow, bluer and darker shrine with warmer
braziers, a brighter and readable Warden's chamber, a brighter vale.

**Water.** Broad water darkens toward its middle, a thin wet line runs along
every shore, and foam only appears where water moves: under the falls and in
narrow channels.

| Before / after | |
| --- | --- |
| ![](docs/screenshots/pass2/01-forest.jpg) Forest Approach | ![](docs/screenshots/pass2/02-forest-bridge.jpg) Arch bridge |
| ![](docs/screenshots/pass2/03-courtyard.jpg) Ruined Courtyard | ![](docs/screenshots/pass2/04-waterfall.jpg) Sanctuary waterfall |
| ![](docs/screenshots/pass2/05-ravine-bridge.jpg) Ravine bridge | ![](docs/screenshots/pass2/06-combat.jpg) Combat |
| ![](docs/screenshots/pass2/07-shrine.jpg) Underground Shrine | ![](docs/screenshots/pass2/08-warden.jpg) Warden's Chamber |
| ![](docs/screenshots/pass2/09-vale.jpg) Hidden Vale | ![](docs/screenshots/pass2/10-sanctuary-court.jpg) Sanctuary court |
| ![](docs/screenshots/pass2/11-hero-close.jpg) Hero close-up | ![](docs/screenshots/pass2/13-hero-sheet-front.jpg) Hero frames |

**Still short of the target:** wall faces themselves are still one tiled
texture (the kit fixes edges, not faces); canopy clumps are still the same six
painted cards; the sentinel and slime were not repainted; some open lawns now
read a little empty; light moods follow the player rather than being lit
volumes, so a distant area is shown in the current area's light.

## What is 2D and what is 3D

**3D (real geometry, lit and shadowed):** terrain, cliffs and retaining walls,
stairs, bridges, aqueduct, roofs, gates, columns, braziers, tree trunks and
roots, water surfaces, the waterfall, the shrine and the vale's tower. All of it
is built procedurally from a tile height grid plus a list of free-standing
solids (`src/level.js`, `src/world.js`).

**2D (pixel-art sprites in the 3D world):** the hero, all creatures and the
boss, projectiles and VFX, tree canopies, bushes, ferns, grass tufts, reeds,
flowers, mushrooms, hanging vines, ivy and grass lips over ledges, statues,
steles, pots, chests, the lever and sun-stones. Every sprite is painted in code
at load (`src/sprites.js`) into one 2048² atlas, snapped to the shared palette
ramps with ordered dithering and outlined.

**Painted 2D backdrop:** only the far sky and ridge silhouettes behind the
Hidden Vale.

## Rendering techniques

* **Fixed 3/4 rig.** Perspective camera at 42° pitch with a narrow 30° FOV, so
  verticals barely converge and the image reads close to Alundra's oblique
  projection while keeping real parallax. Zoom is expressed as visible world
  height (`viewH`) so changing FOV does not change framing. The camera leads
  the hero slightly, follows the ground level rather than jumps, and clamps so
  map edges never enter the frame.
* **One shared palette.** Ground textures, masonry and every sprite are
  quantized to the same hand-picked ramps (`src/palette.js`): warm limestone,
  muted olive, cool shadow greens, indigo accents, restrained gold. This, more
  than any shader, is what makes 2D and 3D read as one world.
* **Splat-blended ground.** Each terrain vertex carries weights for six ground
  types; the fragment shader picks a type per pixel by noisy argmax and darkens
  a thin seam where one type laps over another. Tile edges become hand-drawn
  borders instead of grid lines.
* **Chipped silhouettes.** Wall and terrain vertices are displaced by smooth 3D
  noise (small amplitude for masonry, larger for natural rock), and vertex AO
  darkens wall bases and inner corners. No baked lighting, no normal maps.
* **Depth tint and haze.** A shared shader patch tints low ground toward a
  cool deep colour (the ravine floor sinks into shadowy air) and the highest
  ground toward haze. In the shrine the same uniform fades wall tops to black,
  which frames rooms the way old dungeon maps did.
* **Cutaway walls.** Tall rock directly in front of a room (camera side) is
  drawn as a low lip above the floor it fronts, while invisible blockers keep
  the full collision. This is what makes the shrine readable from the 3/4 view.
* **Occluder reveal.** World geometry and flagged sprites that sit between the
  camera and the hero are dithered away in a small screen-space circle around
  the hero, instead of fading whole objects.
* **Sprite cards that cast real shadows.** Upright sprites are camera-facing
  cards stretched vertically by `1 / cos(pitch)` so they keep their painted
  proportions. Their shadow pass uses a separate depth material that turns each
  card to face the sun, so shadows have the sprite's real silhouette and length.
  Contact-shadow blobs anchor characters to the ground.
* **Sprites lit by the same light as the world.** Each static sprite gets a
  tint from one light model (`src/light.js`): sky ambient + sun, where sun
  visibility is a ray march through the collider and through tree canopy
  spheres, plus brazier and sun-stone point lights. Moving actors are re-tinted
  every frame, so walking under a canopy or past a brazier changes the hero's
  light just like the ground around them.
* **Water** is a small custom shader: scrolling palette-ramp ripples, a depth
  colour from the bed height, fresnel toward the sky colour and foam at shores.
* **Restrained feedback.** Hit flash, short hitstop, small screen shake,
  afterimages on dash, palette-snapped particles (chips, leaves, glints, puffs).
* **Shadow stability.** The sun's shadow camera follows the view and is
  snapped to its texel grid so shadows never swim.

### Key custom materials and shaders

| Where | What |
| --- | --- |
| `src/shaderPatch.js` | `patchWorldMaterial`: depth tint, high haze, occluder reveal dither; applied to every Lambert world material |
| `src/world.js` `groundMaterial` | six-way splat blend with noisy argmax and seam darkening |
| `src/world.js` `buildWater` | ripple / fresnel / foam water |
| `src/billboard.js` | instanced sprite batch: upright, ground-decal and wall-hanging modes, sway, flip, flash, dithered fade, sun-facing shadow cards |
| `src/decor.js` | waterfall shader, far backdrop painter, sprite retint |

## How characters and world are integrated

The hero and creatures are drawn at roughly 60 pixels per world unit, the same
density as the vegetation and close to the texel density of the ground, so
nothing looks "pasted on" or "tiny on a big model". They stand on real
geometry (collision is the same height grid that builds the mesh), cast
sun-shaped shadows onto it, receive its light, are occluded by it, and are
revealed through it. Foliage that overlaps them is the same kind of object they
are (painted cards in the same palette), which softens the 2D/3D boundary at
exactly the place the eye looks.

## Debug toggles (F1)

Camera pitch, zoom, FOV and four presets (42° default, 35° low, 55° high,
near-orthographic); sun azimuth and height; toggles for lighting, shadow maps,
depth tint / haze, sprite light response, foreground canopy, occluder reveal,
contact shadows and sprite cast shadows; save screenshot.

## Candid assessment

**What works**

* Traversal reads. Heights are legible from the 3/4 view because walls, lips,
  vines and shadows all describe the same drops, and the reach checker keeps the
  level honest.
* The shared palette and per-sprite light make the hero sit *in* the world.
  The sanctuary waterfall, the courtyard aqueduct and the shrine chamber are
  close to the intended look: illustrated, solid, quiet.
* Cutaway walls plus black wall tops solve the dungeon readability problem
  without a separate camera mode.
* The Hidden Vale shows the approach scales to composed set pieces.

**What still looks conventional 3D or HD-2D**

* Masonry walls are boxes with a tiled texture. Alundra's walls are drawn
  with intent: specific capstones, broken corners, moss where water runs. Ours
  repeat too evenly and the top edges are too straight.
* Lighting is still a little dim and flat in the forest; the scene needs one
  clear light idea per area (sun shafts through canopy, warm court, cool
  ravine) rather than a uniform sun.
* Tree canopies are better than before (clustered, lit per clump) but still
  read as stacked cards from some angles, and big crowns can dominate the
  frame.
* Grass tufts are scattered by rule, so meadows look procedural. Hand-placed
  dressing would read far more like Alundra.
* The hero's animation is functional (idle, walk, jump, attack, hurt) but
  stiff; the hair reads as a helmet.
* The shrine is too grey; the warm brazier accents need more contrast against
  a cooler, bluer stone.

## Recommendations for next steps

1. Replace generic wall boxes with a small kit of authored wall pieces
   (capstones, corners, broken ends, drains) placed along the same edges the
   builder already finds.
2. Per-area lighting presets (direction, colour, ambient, haze) blended by
   position, plus projected canopy light/shadow cookies on the ground.
3. Hand-place hero dressing in key compositions and keep procedural scatter as
   a base layer only.
4. Re-draw the hero at the same resolution with more frames and secondary
   motion (cloth, hair), and give creatures anticipation frames.
5. A tile-edge "drawn outline" pass on wall tops (a thin dark line on top edges
   only) would push the illustrated look further than any post effect.
6. Move level data to a small editor-friendly JSON format once the kit settles.

## Reusable techniques

* Palette ramps + Bayer quantization shared by textures and sprites
  (`palette.js`) for cohesion.
* Height grid + free solids → mesh, collision and reachability from one source
  (`level.js`, `world.js`, `tools/reach.js`).
* `patchWorldMaterial` for any three.js Lambert material: depth tint, haze,
  reveal.
* Instanced `SpriteBatch` with sun-facing shadow cards (`billboard.js`).
* CPU sprite light model with ray-marched sun visibility and local lights
  (`light.js`).
* Cutaway walls with invisible blockers for 3/4 dungeons (`cutaway()` in
  `level.js`).
* Deterministic `__G.debugApi.sim(input, seconds)` for automated playtests and
  screenshot staging.

## Files

```
index.html          page, HUD, debug panel
atlas.html          dev view of the generated sprite atlas (?s=scale)
src/main.js         renderer, game loop, maps, camera, HUD, debug, flow
src/level.js        overworld, shrine and vale layouts; cutaway walls
src/world.js        terrain / wall / stair / solid meshes, water, collider
src/masonryKit.js   authored wall-edge kit: coping, capstones, corners, ruins
src/decor.js        trees, props, plant scatter, waterfall, backdrop, sprite tint
src/sprites.js      procedural pixel-art painter and atlas
src/billboard.js    instanced sprite batches
src/entities.js     player, creatures, boss, interactables, projectiles, fx
src/light.js        sun and sprite light model
src/shaderPatch.js  shared world shader additions
src/textures.js     procedural ground and masonry textures
src/palette.js      palette ramps and dithering
src/noise.js        noise utilities
src/audio.js        synthesized ambience and effects (WebAudio)
tools/reach.js      reachability check
tools/capture.mjs   screenshot capture
```
