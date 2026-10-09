// Everything that moves or reacts: the hero, creatures, the Warden, pots,
// sun-stones, levers, chests, pickups, projectiles and effects.
// Each entity exposes update(dt, G) and draw(G); G is the running game.
import { STEP } from './world.js';
import { T } from './level.js';

const GRAV = 22;
const TAU = Math.PI * 2;
const len2 = (x, z) => Math.sqrt(x * x + z * z);

// ------------------------------------------------------------ shared helpers
function moveWithCollision(G, e, dx, dz, r = 0.28, h = 1.35) {
  const C = G.collider;
  let moved = false;
  if (!C.blocked(e.x + dx, e.z + dz, e.y, r, h)) {
    e.x += dx;
    e.z += dz;
    moved = true;
  } else {
    if (dx && !C.blocked(e.x + dx, e.z, e.y, r, h)) {
      e.x += dx;
      moved = true;
    }
    if (dz && !C.blocked(e.x, e.z + dz, e.y, r, h)) {
      e.z += dz;
      moved = true;
    }
  }
  return moved;
}

// vertical physics for walkers; returns true when it landed this frame
function verticalStep(G, e, dt) {
  const C = G.collider;
  if (e.grounded) {
    const g = C.ground(e.x, e.z, e.y + STEP);
    if (g < e.y - 0.45) {
      e.grounded = false;
      e.vy = 0;
    } else e.y = g;
    return false;
  }
  if (!e.floating) e.vy -= GRAV * dt;
  e.y += e.vy * dt;
  // bump the head on undersides of decks and roofs
  if (e.vy > 0) {
    for (const s of C.solids) {
      if (s.off) continue;
      if (e.x > s.x0 && e.x < s.x1 && e.z > s.z0 && e.z < s.z1 && s.y0 > e.y + 0.3 && s.y0 < e.y + 1.4) {
        e.vy = 0;
        e.y = Math.min(e.y, s.y0 - 1.4);
      }
    }
  }
  const g = C.ground(e.x, e.z, e.y + 0.05, 0.05);
  if (e.y <= g) {
    e.y = g;
    e.vy = 0;
    e.grounded = true;
    return true;
  }
  return false;
}

function litTint(G, e, out, yOff = 0.8) {
  e._lt = (e._lt ?? 0) - 1;
  if (e._lt <= 0 || e._lit === undefined) {
    e._lit = G.sunlitAt(e.x, e.y + yOff, e.z);
    e._lt = 4;
  }
  e._litS = e._litS === undefined ? e._lit : e._litS + (e._lit - e._litS) * 0.25;
  return G.tintAt(e.x, e.y + yOff, e.z, e._litS, out);
}

function contactShadow(G, e, w = 0.9) {
  if (!G.debug.contactShadows) return;
  const g = G.collider.ground(e.x, e.z, e.y + 0.05, 0.05);
  const air = Math.max(0, e.y - g);
  const s = Math.max(0.35, 1 - air * 0.28);
  const water = G.collider.isWater(e.x, e.z);
  G.fx.add({ rect: 'blob', mode: 1, x: e.x, y: (water ? G.waterY(e.x, e.z) : g) + 0.03, z: e.z, w: w * s, h: w * 0.5 * s, tint: [0, 0, 0, 0.5 - air * 0.06] });
}

function knock(e, fromX, fromZ, power) {
  const dx = e.x - fromX, dz = e.z - fromZ;
  const d = len2(dx, dz) || 1;
  e.kx = (dx / d) * power;
  e.kz = (dz / d) * power;
}

function pushApart(G, a, b, ra, rb) {
  const dx = a.x - b.x, dz = a.z - b.z;
  const d = len2(dx, dz);
  if (d < ra + rb && d > 0.001 && Math.abs(a.y - b.y) < 1.2) {
    const push = (ra + rb - d) * 0.5;
    moveWithCollision(G, a, (dx / d) * push, (dz / d) * push);
  }
}

// ------------------------------------------------------------ the hero
export class Player {
  constructor(x, z, y, dir = 'up') {
    this.x = x;
    this.z = z;
    this.y = y;
    this.vy = 0;
    this.grounded = true;
    this.fx = 0;
    this.fz = dir === 'down' ? 1 : -1;
    this.vx = 0;
    this.vz = 0;
    this.kx = this.kz = 0;
    this.anim = 0;
    this.attackT = 0;
    this.dashT = 0;
    this.dashCd = 0;
    this.airDash = true;
    this.hurtT = 0;
    this.inv = 0;
    this.coyote = 0;
    this.jumpBuf = 0;
    this.hitSet = new Set();
    this.dead = false;
    this.deadT = 0;
    this.stepT = 0;
    this.thrust = false;
    this.after = [];
  }

  get dir() {
    if (Math.abs(this.fz) >= Math.abs(this.fx) * 0.85) return this.fz > 0 ? 'down' : 'up';
    return 'side';
  }

  update(dt, G) {
    const I = G.input;
    if (this.dead) {
      this.deadT += dt;
      verticalStep(G, this, dt);
      return;
    }
    this.inv = Math.max(0, this.inv - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.coyote = this.grounded ? 0.1 : Math.max(0, this.coyote - dt);
    this.jumpBuf = I.jumpPressed ? 0.12 : Math.max(0, this.jumpBuf - dt);

    // ---- intent
    let mx = I.mx, mz = I.mz;
    const ml = len2(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    if (G.locked) mx = mz = 0;
    const inWater = this.grounded && G.collider.isWater(this.x, this.z);
    const speed = 4.7 * (inWater ? 0.62 : 1);

    // ---- dash
    if (I.dashPressed && this.dashCd <= 0 && (this.grounded || this.airDash) && !G.locked && this.attackT <= 0) {
      if (ml > 0.1) {
        this.fx = mx;
        this.fz = mz;
      }
      const fl = len2(this.fx, this.fz) || 1;
      this.dashDX = this.fx / fl;
      this.dashDZ = this.fz / fl;
      this.dashT = 0.17;
      this.dashCd = 0.5;
      this.inv = Math.max(this.inv, 0.2);
      if (!this.grounded) {
        this.airDash = false;
        this.vy = Math.max(this.vy, 1.5);
      }
      G.sfx('dash');
      G.spawnFx('puff', this.x, this.y + 0.1, this.z);
    }

    // ---- attack
    if (I.attackPressed && this.attackT <= 0 && !G.locked) {
      if (!this.grounded && this.vy < 2) {
        this.thrust = true;
        this.vy = Math.min(this.vy, -4);
      } else {
        this.attackT = 0.3;
        this.hitSet.clear();
        if (ml > 0.1) {
          this.fx = mx;
          this.fz = mz;
        }
        G.sfx('swing');
      }
    }

    let vx, vz;
    if (this.dashT > 0) {
      this.dashT -= dt;
      vx = this.dashDX * 12.5;
      vz = this.dashDZ * 12.5;
      if (!this.grounded) this.vy = Math.max(this.vy, 0);
      if (Math.random() < 0.5) this.after.push({ x: this.x, y: this.y, z: this.z, t: 0.16, dir: this.dir, flip: this.fx < 0 });
    } else {
      const tx = mx * speed, tz = mz * speed;
      const acc = this.grounded ? 30 : 14;
      const slow = this.attackT > 0 ? 0.25 : 1;
      this.vx += (tx * slow - this.vx) * Math.min(1, acc * dt);
      this.vz += (tz * slow - this.vz) * Math.min(1, acc * dt);
      vx = this.vx;
      vz = this.vz;
      if (ml > 0.1 && this.attackT <= 0) {
        this.fx = mx;
        this.fz = mz;
      }
    }
    vx += this.kx;
    vz += this.kz;
    this.kx *= Math.pow(0.0005, dt);
    this.kz *= Math.pow(0.0005, dt);

    moveWithCollision(G, this, vx * dt, vz * dt);

    // ---- jump
    if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0) && !G.locked) {
      this.vy = 7.3;
      this.grounded = false;
      this.coyote = 0;
      this.jumpBuf = 0;
      G.sfx('jump');
      if (inWater) G.spawnFx('splash', this.x, G.waterY(this.x, this.z), this.z);
    }
    if (!I.jumpHeld && this.vy > 3) this.vy -= GRAV * 0.9 * dt; // short hops on tap

    const wasAir = !this.grounded;
    const fallV = this.vy;
    const landed = verticalStep(G, this, dt);
    // visual only: a short landing crouch after a real fall
    this.landT = landed && wasAir && fallV < -4 ? 0.11 : Math.max(0, (this.landT ?? 0) - dt);
    if (landed) {
      this.airDash = true;
      if (wasAir && fallV < -6) {
        G.sfx('land');
        G.spawnFx(G.collider.isWater(this.x, this.z) ? 'splash' : 'puff', this.x, this.y + 0.05, this.z);
      }
      if (this.thrust) {
        this.thrust = false;
        G.shake(0.12);
      }
    }

    // ---- attack hits
    if (this.attackT > 0) {
      this.attackT -= dt;
      const t = 0.3 - this.attackT;
      if (t > 0.05 && t < 0.2) {
        const fl = len2(this.fx, this.fz) || 1;
        const hx = this.x + (this.fx / fl) * 0.75, hz = this.z + (this.fz / fl) * 0.75;
        G.strike(hx, this.y + 0.6, hz, 1.05, 1, this, this.hitSet);
      }
    }
    if (this.thrust && !this.grounded) {
      const hit = G.strike(this.x, this.y - 0.2, this.z, 0.8, 2, this, null, true);
      if (hit) {
        this.vy = 6.5;
        this.thrust = false;
        this.airDash = true;
      }
    }

    // ---- footsteps
    const sp = len2(this.vx, this.vz);
    if (this.grounded && sp > 1 && this.dashT <= 0) {
      this.anim += dt * sp * 1.55;
      this.stepT -= dt * sp;
      if (this.stepT <= 0) {
        this.stepT = 1.7;
        G.sfx(G.collider.isWater(this.x, this.z) ? 'wade' : 'step');
        if (G.collider.isWater(this.x, this.z) && Math.random() < 0.6) G.spawnFx('ripple', this.x, G.waterY(this.x, this.z), this.z);
      }
    } else if (this.grounded) this.anim += dt * 1.5;

    this.after = this.after.filter((a) => (a.t -= dt) > 0);
  }

  hurt(G, dmg, fromX, fromZ) {
    if (this.inv > 0 || this.dead || G.ending) return;
    G.state.hp -= dmg;
    this.inv = 1.0;
    this.hurtT = 0.25;
    knock(this, fromX, fromZ, 7.5);
    this.attackT = 0;
    this.dashT = 0;
    G.sfx('hurt');
    G.shake(0.18);
    G.spawnFx('spark', this.x, this.y + 0.8, this.z);
    if (G.state.hp <= 0) {
      G.state.hp = 0;
      this.dead = true;
      this.deadT = 0;
      G.onDeath();
    }
  }

  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1]);
    const dir = this.dir;
    let anim = 'idle', f = Math.floor(this.anim * 1.2) % 2;
    if (this.dead) {
      anim = 'hurt';
      f = 0;
    } else if (this.hurtT > 0) {
      anim = 'hurt';
      f = 0;
    } else if (this.attackT > 0) {
      anim = 'atk';
      const t = 0.3 - this.attackT;
      f = t < 0.05 ? 0 : t < 0.13 ? 1 : t < 0.22 ? 2 : 3;
    } else if (this.dashT > 0) {
      anim = 'dash';
      f = 0;
    } else if (!this.grounded) {
      anim = 'jump';
      f = this.vy > 2.5 ? 0 : this.vy > -2.5 ? 1 : 2;
    } else if (this.landT > 0) {
      anim = 'land';
      f = 0;
    } else if (len2(this.vx, this.vz) > 1) {
      anim = 'walk';
      f = Math.floor(this.anim) % 4;
    }
    const flip = dir === 'side' && this.fx < 0;
    const blink = this.inv > 0 && !this.dead && Math.floor(this.inv * 20) % 2 === 0;
    const alpha = this.dead ? Math.max(0, 1 - this.deadT * 0.8) : 1;
    // afterimages while dashing: a couple of cool, dithered copies
    for (const a of this.after) {
      G.actors.add({ rect: `hero.${a.dir}.dash.0`, x: a.x, y: a.y - 0.06, z: a.z, w: 1.2, h: 1.8, flip: a.flip, tint: [0.45, 0.55, 0.75, a.t * 3] });
    }
    G.actors.add({
      rect: `hero.${dir}.${anim}.${f}`,
      x: this.x,
      y: this.y - 0.07,
      z: this.z,
      w: 1.2,
      h: 1.8,
      flip,
      tint: [tint[0], tint[1], tint[2], blink ? 0.35 : alpha],
      cast: true,
      flash: this.hurtT > 0.15 ? 0.6 : 0,
    });
    contactShadow(G, this, 0.95);
    if (this.attackT > 0) {
      const t = 0.3 - this.attackT;
      const sf = Math.min(2, Math.floor(t / 0.09));
      const fl = len2(this.fx, this.fz) || 1;
      const ox = (this.fx / fl) * 0.55, oz = (this.fz / fl) * 0.55;
      const sdir = dir === 'side' ? 'side' : dir;
      G.fx.add({ rect: `slash.${sdir}.${sf}`, x: this.x + ox, y: this.y + (dir === 'up' ? 0.25 : -0.15), z: this.z + oz + 0.05, w: 1.6, h: 1.6, flip, tint: [1, 1, 0.92, 1 - sf * 0.25] });
    }
  }
}

// ------------------------------------------------------------ creature base
class Creature {
  constructor(def, G) {
    this.def = def;
    this.x = this.hx = def.x;
    this.z = this.hz = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.vy = 0;
    this.grounded = true;
    this.kx = this.kz = 0;
    this.flashT = 0;
    this.hurtT = 0;
    this.alive = true;
    this.t = Math.random() * 3;
    this.radius = 0.4;
    this.height = 1;
  }
  takeHit(G, dmg, src) {
    if (!this.alive || this.invT > 0) return false;
    this.hp -= dmg;
    this.flashT = 0.12;
    this.hurtT = 0.25;
    this.invT = 0.18;
    if (!this.heavy) knock(this, src.x, src.z, 6);
    else knock(this, src.x, src.z, 1.5);
    G.sfx('hit');
    G.spawnFx('spark', this.x, this.y + this.height * 0.5, this.z);
    G.hitstop(0.05);
    if (this.hp <= 0) this.die(G);
    return true;
  }
  die(G) {
    this.alive = false;
    G.sfx('die');
    this.dieFx(G);
    if (Math.random() < 0.3) G.spawnPickup('heart', this.x, this.z);
  }
  dieFx(G) {
    for (let i = 0; i < 4; i++) G.spawnFx('puff', this.x + (Math.random() - 0.5) * 0.6, this.y + 0.2 + Math.random() * 0.4, this.z + (Math.random() - 0.5) * 0.4);
  }
  baseUpdate(dt, G) {
    this.t += dt;
    this.flashT = Math.max(0, this.flashT - dt);
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.invT = Math.max(0, (this.invT ?? 0) - dt);
    if (this.kx || this.kz) {
      moveWithCollision(G, this, this.kx * dt, this.kz * dt, this.radius * 0.7);
      this.kx *= Math.pow(0.002, dt);
      this.kz *= Math.pow(0.002, dt);
      if (Math.abs(this.kx) + Math.abs(this.kz) < 0.05) this.kx = this.kz = 0;
    }
    const P = G.player;
    if (P && !P.dead) {
      const d = len2(P.x - this.x, P.z - this.z);
      if (d < this.radius + 0.3 && P.y < this.y + this.height && P.y + 1.3 > this.y) P.hurt(G, this.damage ?? 1, this.x, this.z);
      if (this.solid) pushApart(G, P, this, 0.3, this.radius);
    }
  }
  near(G, r) {
    const P = G.player;
    return P && !P.dead && len2(P.x - this.x, P.z - this.z) < r;
  }
}

export class Slime extends Creature {
  constructor(def, G) {
    super(def, G);
    this.hp = 2;
    this.hopT = 0.5 + Math.random();
    this.radius = 0.38;
    this.height = 0.6;
  }
  update(dt, G) {
    this.baseUpdate(dt, G);
    const P = G.player;
    this.hopT -= dt;
    if (this.grounded && this.hopT <= 0 && this.hurtT <= 0) {
      let tx, tz;
      if (this.near(G, 6.5) && Math.abs(P.y - this.y) < 1.6) {
        tx = P.x - this.x;
        tz = P.z - this.z;
        this.hopT = 0.75 + Math.random() * 0.3;
      } else {
        const a = Math.random() * TAU;
        tx = this.hx + Math.cos(a) * 2 - this.x;
        tz = this.hz + Math.sin(a) * 2 - this.z;
        this.hopT = 1.4 + Math.random() * 1.2;
      }
      const d = len2(tx, tz) || 1;
      this.hdx = (tx / d) * 2.6;
      this.hdz = (tz / d) * 2.6;
      this.vy = 5.2;
      this.grounded = false;
    }
    if (!this.grounded) moveWithCollision(G, this, this.hdx * dt, this.hdz * dt, 0.3, 0.6);
    const landed = verticalStep(G, this, dt);
    // visual only: hold the landing squash for a beat
    this.landT = landed ? 0.13 : Math.max(0, (this.landT ?? 0) - dt);
    if (landed && this.near(G, 9)) G.sfx('blop', this);
  }
  dieFx(G) {
    G.spawnFx('splat', this.x, this.y + 0.02, this.z);
    for (let i = 0; i < 2; i++) G.spawnFx('puff', this.x + (Math.random() - 0.5) * 0.6, this.y + 0.2, this.z + (Math.random() - 0.5) * 0.3);
  }
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.35);
    let rect = `slime.idle.${Math.floor(this.t * 2.5) % 2}`;
    if (this.hurtT > 0) rect = 'slime.hurt.0';
    else if (!this.grounded) rect = this.vy > 1 ? 'slime.hop.1' : 'slime.hop.2';
    else if (this.landT > 0) rect = 'slime.hop.3';
    else if (this.hopT < 0.22) rect = 'slime.hop.0';
    G.actors.add({ rect, x: this.x, y: this.y - 0.05, z: this.z, w: 1.07, h: 0.93, tint, cast: true, flash: this.flashT > 0 ? 0.8 : 0 });
    contactShadow(G, this, 0.8);
  }
}

export class Bulb extends Creature {
  constructor(def, G) {
    super(def, G);
    this.hp = 3;
    this.heavy = true;
    this.radius = 0.4;
    this.height = 1.1;
    this.cycle = Math.random() * 2;
    this.solid = true;
  }
  update(dt, G) {
    this.baseUpdate(dt, G);
    this.kx = this.kz = 0;
    const P = G.player;
    const awake = this.near(G, 8.5) && Math.abs(P.y - this.y) < 2.6;
    this.awake = awake;
    if (!awake) {
      this.cycle = 0;
      this.open = 0;
      return;
    }
    this.cycle += dt;
    if (this.cycle < 1.3) this.open = 0;
    else if (this.cycle < 1.65) this.open = 1;
    else if (this.cycle < 1.9) {
      if (this.open !== 2) {
        this.open = 2;
        G.spawnProjectile(this.x, this.y + 1.0, this.z, P.x, P.y + 0.7, P.z, 6.2);
        G.sfx('spit', this);
      }
    } else this.cycle = 0;
  }
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.6);
    // dormant -> alert when the player comes near -> swelling -> fired
    const stage = !this.awake ? 0 : this.open === 2 ? 3 : this.open === 1 ? 2 : 1;
    const v = (Math.floor(this.def.x * 7 + this.def.z * 13) & 1) ? 'b' : 'a';
    const shiver = stage === 1 && this.cycle > 1.0 ? Math.sin(this.t * 55) * 0.025 : 0;
    G.actors.add({ rect: `bulb.${v}.${stage}`, x: this.x + shiver, y: this.y - 0.05, z: this.z, w: 1.2, h: 1.33, tint, cast: true, flash: this.flashT > 0 ? 0.8 : 0, sway: stage === 0 ? 0.03 : 0 });
    contactShadow(G, this, 0.9);
  }
}

Bulb.prototype.dieFx = function (G) {
  for (let i = 0; i < 5; i++) G.spawnFx('leaf', this.x + (Math.random() - 0.5) * 0.6, this.y + 0.6 + Math.random() * 0.4, this.z + 0.1);
  G.spawnFx('puff', this.x, this.y + 0.3, this.z);
};

export class Sentinel extends Creature {
  constructor(def, G) {
    super(def, G);
    this.hp = 6;
    this.heavy = true;
    this.radius = 0.75;
    this.height = 1.9;
    this.state = 'idle';
    this.st = 0;
    this.solid = true;
    this.facing = 1;
  }
  update(dt, G) {
    this.baseUpdate(dt, G);
    const P = G.player;
    this.st += dt;
    if (this.state === 'idle' || this.state === 'walk') {
      if (this.near(G, 8) && Math.abs(P.y - this.y) < 1.5) {
        const dx = P.x - this.x, dz = P.z - this.z, d = len2(dx, dz);
        if (d < 2.4 && this.st > 0.6) {
          this.state = 'raise';
          this.st = 0;
          G.sfx('grind', this);
        } else {
          this.state = 'walk';
          moveWithCollision(G, this, (dx / d) * 1.35 * dt, (dz / d) * 1.35 * dt, 0.6, 1.8);
          this.facing = dx < 0 ? -1 : 1;
        }
      } else this.state = 'idle';
    } else if (this.state === 'raise' && this.st > 0.75) {
      this.state = 'slam';
      this.st = 0;
      G.sfx('stomp', this);
      G.shake(0.25);
      G.spawnRing(this.x, this.y, this.z, 2.7, 0.45, this);
      for (let i = 0; i < 3; i++) G.spawnFx('chip', this.x + (Math.random() - 0.5) * 1.2, this.y + 0.2, this.z + 0.4);
      for (const k of [-1, 1]) G.spawnFx('puff', this.x + k * 0.75, this.y + 0.15, this.z + 0.3);
    } else if (this.state === 'slam' && this.st > 0.9) {
      this.state = 'idle';
      this.st = 0;
    }
    verticalStep(G, this, dt);
  }
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 1.0);
    let rect = 'sentinel.idle';
    if (this.state === 'walk') rect = ['sentinel.walk0', 'sentinel.contact', 'sentinel.walk1', 'sentinel.contact'][Math.floor(this.t * 4.5) % 4];
    if (this.state === 'raise') rect = 'sentinel.raise';
    if (this.state === 'slam') rect = 'sentinel.slam';
    const shake = this.state === 'raise' ? Math.sin(this.st * 60) * 0.03 : 0;
    G.actors.add({ rect, x: this.x + shake, y: this.y - 0.06, z: this.z, w: 2.0, h: 2.2, flip: this.facing < 0, tint, cast: true, flash: this.flashT > 0 ? 0.7 : 0 });
    contactShadow(G, this, 1.7);
  }
}

Sentinel.prototype.dieFx = function (G) {
  for (let i = 0; i < 7; i++) G.spawnFx('chip', this.x + (Math.random() - 0.5) * 1.4, this.y + 0.4 + Math.random() * 1.2, this.z + 0.3);
  for (let i = 0; i < 4; i++) G.spawnFx('puff', this.x + (Math.random() - 0.5) * 1.2, this.y + 0.2 + Math.random() * 0.8, this.z + 0.2);
};

export class Moth extends Creature {
  constructor(def, G) {
    super(def, G);
    this.hp = 1;
    this.radius = 0.4;
    this.height = 0.6;
    this.y = this.y + 1.7;
    this.state = 'drift';
    this.st = Math.random() * 2;
    this.ang = Math.random() * TAU;
    this.vx = this.vz = 0;
  }
  update(dt, G) {
    this.baseUpdate(dt, G);
    const P = G.player;
    this.st += dt;
    const g = G.collider.ground(this.x, this.z, 50);
    let targetY = g + 1.7 + Math.sin(this.t * 3) * 0.2;
    let tx = this.hx + Math.cos(this.t * 0.5) * 2.5, tz = this.hz + Math.sin(this.t * 0.7) * 1.8;
    if (this.near(G, 8)) {
      if (this.state === 'drift') {
        this.state = 'circle';
        this.st = 0;
      }
      if (this.state === 'circle') {
        this.ang += dt * 1.4;
        tx = P.x + Math.cos(this.ang) * 3;
        tz = P.z + Math.sin(this.ang) * 2.2;
        targetY = Math.max(g, P.y) + 1.9;
        if (this.st > 2.4) {
          this.state = 'swoop';
          this.st = 0;
          this.sx = P.x;
          this.sz = P.z;
          this.sy = P.y + 0.6;
          G.sfx('flutter', this);
        }
      } else if (this.state === 'swoop') {
        tx = this.sx + (this.sx - this.x) * 0.5;
        tz = this.sz + (this.sz - this.z) * 0.5;
        targetY = this.sy;
        if (this.st > 0.8) {
          this.state = 'circle';
          this.st = 0;
        }
      }
    } else this.state = 'drift';
    const sp = this.state === 'swoop' ? 7.5 : 3.2;
    const dx = tx - this.x, dz = tz - this.z, d = len2(dx, dz) || 1;
    this.vx += ((dx / d) * Math.min(sp, d * 2) - this.vx) * Math.min(1, dt * 4);
    this.vz += ((dz / d) * Math.min(sp, d * 2) - this.vz) * Math.min(1, dt * 4);
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.x = Math.max(1, Math.min(G.L.W - 1, this.x));
    this.z = Math.max(1, Math.min(G.L.D - 1, this.z));
    this.y += (Math.max(targetY, G.collider.terrain(this.x, this.z) + 0.6) - this.y) * Math.min(1, dt * 3);
  }
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.2);
    // one wingbeat over four frames; the body rises on the downstroke. Swoops glide.
    let f = Math.floor(this.t * 13) % 4;
    if (this.state === 'swoop' && this.st > 0.12) f = Math.floor(this.st * 6) % 3 === 2 ? 2 : 4;
    const bob = [-0.05, 0, 0.06, 0.02, 0][f];
    G.actors.add({ rect: `moth.${f}`, x: this.x, y: this.y - 0.35 + bob, z: this.z, w: 1.2, h: 0.93, flip: this.vx < -0.3, tint, cast: true, flash: this.flashT > 0 ? 0.8 : 0 });
    contactShadow(G, this, 0.7);
  }
}

Moth.prototype.dieFx = function (G) {
  for (let i = 0; i < 3; i++) G.spawnFx('puff', this.x + (Math.random() - 0.5) * 0.5, this.y - 0.1, this.z);
  for (let i = 0; i < 3; i++) G.spawnFx('glint', this.x + (Math.random() - 0.5) * 0.6, this.y - 0.1, this.z);
};

// ------------------------------------------------------------ the Root Warden
export class Warden extends Creature {
  constructor(def, G) {
    super(def, G);
    this.maxHp = this.hp = 24;
    this.heavy = true;
    this.radius = 1.35;
    this.height = 3.0;
    this.state = 'dormant';
    this.st = 0;
    this.solid = true;
    this.facing = 1;
    this.damage = 1;
    this.phase = 1;
    this.patternIx = 0;
  }
  takeHit(G, dmg, src) {
    if (this.state === 'dormant' || this.state === 'dying') return false;
    const stunned = this.state === 'stunned';
    const ok = super.takeHit(G, stunned ? dmg * 2 : dmg, src);
    if (ok) {
      this.kx *= 0.3;
      this.kz *= 0.3;
    }
    return ok;
  }
  die(G) {
    this.alive = true; // keep drawing through the death sequence
    this.state = 'dying';
    this.st = 0;
    G.onBossDefeated(this);
  }
  wake(G) {
    if (this.state !== 'dormant') return;
    this.state = 'roar';
    this.st = 0;
    G.sfx('roar');
    G.shake(0.4);
  }
  update(dt, G) {
    if (this.state === 'dormant') {
      this.t += dt;
      return;
    }
    if (this.state === 'dying') {
      this.st += dt;
      this.flashT = Math.floor(this.st * 12) % 2 ? 0.1 : 0;
      if (Math.random() < 0.3) G.spawnFx(Math.random() < 0.5 ? 'chip' : 'spark', this.x + (Math.random() - 0.5) * 2.4, this.y + Math.random() * 2.6, this.z + 0.3);
      if (this.st > 2.2 && !this.gone) {
        this.gone = true;
        this.alive = false;
        for (let i = 0; i < 10; i++) G.spawnFx('glint', this.x + (Math.random() - 0.5) * 3, this.y + Math.random() * 3, this.z);
        G.spawnPickup('vessel', this.x, this.z);
      }
      return;
    }
    this.baseUpdate(dt, G);
    const P = G.player;
    this.st += dt;
    if (this.hp <= this.maxHp / 2 && this.phase === 1) {
      this.phase = 2;
      G.sfx('roar');
      G.shake(0.35);
      G.spawnCreature('moth', this.x - 3, this.z + 1);
      G.spawnCreature('moth', this.x + 3, this.z + 1);
    }
    const quick = this.phase === 2 ? 0.72 : 1;
    const dx = P.x - this.x, dz = P.z - this.z, d = len2(dx, dz) || 1;
    switch (this.state) {
      case 'roar':
        if (this.st > 1.4) this.next();
        break;
      case 'walk':
        this.facing = dx < 0 ? -1 : 1;
        moveWithCollision(G, this, (dx / d) * 2.0 * dt, (dz / d) * 2.0 * dt, 1.1, 2.5);
        if (this.st > 1.5 * quick) this.choose(G);
        break;
      case 'rearCharge':
        if (this.st > 0.75 * quick) {
          this.state = 'charge';
          this.st = 0;
          this.cdx = dx / d;
          this.cdz = dz / d;
          this.facing = dx < 0 ? -1 : 1;
          G.sfx('charge');
        }
        break;
      case 'charge': {
        this.damage = 2;
        const moved = moveWithCollision(G, this, this.cdx * 9.5 * dt, this.cdz * 9.5 * dt, 1.1, 2.5);
        if (Math.random() < 0.4) G.spawnFx('puff', this.x - this.cdx, this.y + 0.1, this.z - this.cdz);
        if (!moved || this.st > 1.4) {
          this.damage = 1;
          if (!moved) {
            this.state = 'stunned';
            G.shake(0.35);
            G.sfx('stomp');
            for (let i = 0; i < 5; i++) G.spawnFx('chip', this.x + this.cdx * 1.4, this.y + 1 + Math.random(), this.z + this.cdz * 1.4);
          } else this.state = 'recover';
          this.st = 0;
        }
        break;
      }
      case 'stunned':
        if (this.st > 1.6) this.next();
        break;
      case 'recover':
        if (this.st > 0.5) this.next();
        break;
      case 'rearStomp':
        if (this.st > 0.65 * quick) {
          this.state = 'stomp';
          this.st = 0;
          this.rings = this.phase === 2 ? 2 : 1;
          this.stompRing(G);
        }
        break;
      case 'stomp':
        if (this.rings > 1 && this.st > 0.55) {
          this.rings--;
          this.st = 0;
          this.stompRing(G);
        } else if (this.st > 0.8) this.next();
        break;
      case 'volley':
        if (this.st > 0.5 && !this.fired) {
          this.fired = true;
          const base = Math.atan2(dz, dx);
          const n = this.phase === 2 ? 7 : 5;
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * 0.22;
            G.spawnProjectile(this.x, this.y + 1.6, this.z, this.x + Math.cos(a) * 10, P.y + 0.7, this.z + Math.sin(a) * 10, 5.4);
          }
          G.sfx('spit');
        }
        if (this.st > 1.1) {
          if (this.phase === 2 && !this.second) {
            this.second = true;
            this.fired = false;
            this.st = 0.2;
          } else this.next();
        }
        break;
    }
    verticalStep(G, this, dt);
  }
  stompRing(G) {
    G.sfx('stomp');
    G.shake(0.4);
    G.spawnRing(this.x, this.y, this.z, 8.5, 1.5, this);
    for (let i = 0; i < 6; i++) G.spawnFx('chip', this.x + (Math.random() - 0.5) * 2.5, this.y + 0.2, this.z + 0.6);
  }
  next() {
    this.state = 'walk';
    this.st = 0;
  }
  choose(G) {
    const order = ['rearCharge', 'rearStomp', 'volley', 'rearStomp', 'rearCharge', 'volley'];
    this.state = order[this.patternIx++ % order.length];
    this.st = 0;
    this.fired = false;
    this.second = false;
    G.sfx('grind', this);
  }
  draw(G) {
    if (this.gone) return;
    const tint = litTint(G, this, [0, 0, 0, 1], 1.4);
    let rect = `warden.idle${Math.floor(this.t * 2) % 2}`;
    if (this.state === 'dormant') rect = 'warden.idle0';
    if (this.state === 'roar' || this.state === 'rearCharge' || this.state === 'rearStomp' || this.state === 'volley') rect = 'warden.rear';
    if (this.state === 'charge') rect = 'warden.charge';
    if (this.state === 'stomp') rect = 'warden.stomp';
    if (this.state === 'stunned' || this.state === 'dying' || this.hurtT > 0.12) rect = 'warden.hurt';
    // phase two wears its damage: lost roof slabs, a cracked mask, a snapped antler
    if (this.phase === 2) rect += '.b';
    let sink = 0;
    if (this.state === 'dying' && this.st > 0.6) {
      rect = 'warden.down';
      sink = Math.min(0.25, (this.st - 0.6) * 0.2);
    }
    const dormantDim = this.state === 'dormant' ? 0.55 : 1;
    const shake = this.state === 'rearCharge' || this.state === 'rearStomp' ? Math.sin(this.st * 70) * 0.04 : 0;
    const alpha = this.state === 'dying' ? Math.max(0, 1 - Math.max(0, this.st - 1.5) * 1.4) : 1;
    G.actors.add({ rect, x: this.x + shake, y: this.y - 0.08 - sink, z: this.z, w: 3.87, h: 3.53, flip: this.facing < 0, tint: [tint[0] * dormantDim, tint[1] * dormantDim, tint[2] * dormantDim, alpha], cast: true, flash: this.flashT > 0 ? 0.7 : 0 });
    contactShadow(G, this, 3.0);
  }
}

// ------------------------------------------------------------ world objects
export class Pot {
  constructor(def, G) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.broken = false;
    this.solid = { x0: this.x - 0.3, z0: this.z - 0.3, x1: this.x + 0.3, z1: this.z + 0.3, y0: this.y - 0.2, y1: this.y + 0.65, kind: 'pot' };
    G.collider.solids.push(this.solid);
  }
  takeHit(G) {
    if (this.broken) return false;
    this.broken = true;
    this.solid.off = true;
    G.sfx('pot');
    for (let i = 0; i < 3; i++) G.spawnFx('chip', this.x, this.y + 0.3, this.z);
    if (this.def.drop) G.spawnPickup(this.def.drop, this.x, this.z);
    return true;
  }
  update() {}
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.4);
    G.actors.add({ rect: this.broken ? 'potBroken' : 'pot', x: this.x, y: this.y - 0.04, z: this.z, w: 0.73, h: 0.8, tint, cast: !this.broken });
    if (!this.broken) contactShadow(G, this, 0.7);
  }
}

export class SunStone {
  constructor(def, G) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.lit = G.state.flags[`sun:${def.id}`];
    G.collider.solids.push({ x0: this.x - 0.35, z0: this.z - 0.2, x1: this.x + 0.35, z1: this.z + 0.2, y0: this.y - 0.2, y1: this.y + 1.6, kind: 'stone' });
    this.glow = 0;
    if (this.lit) this.addLight();
  }
  addLight() {
    this.local = { x: this.x, y: this.y + 1, z: this.z, r: 3.5, color: [1, 0.8, 0.35], k: 0.7 };
    this.G?.lightsChanged();
  }
  interactable(G) {
    return !this.lit;
  }
  interact(G) {
    return this.takeHit(G);
  }
  takeHit(G) {
    if (this.lit) return false;
    this.lit = true;
    this.glow = 1;
    G.state.flags[`sun:${this.def.id}`] = true;
    G.sfx('chime');
    for (let i = 0; i < 8; i++) G.spawnFx('glint', this.x + (Math.random() - 0.5), this.y + 0.6 + Math.random() * 1.2, this.z + 0.1);
    G.onSunstone(this);
    return true;
  }
  update(dt) {
    this.glow = Math.max(0, this.glow - dt * 0.6);
  }
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.8);
    const b = this.lit ? 1.15 + this.glow * 0.8 : 1;
    G.actors.add({ rect: `sunstone.${this.lit ? 1 : 0}`, x: this.x, y: this.y - 0.05, z: this.z, w: 1.0, h: 1.73, tint: [tint[0] * b, tint[1] * b, tint[2] * b, 1], cast: true });
    if (this.lit && Math.random() < 0.05) G.spawnFx('glint', this.x + (Math.random() - 0.5) * 0.6, this.y + 0.7 + Math.random() * 0.6, this.z + 0.1);
    contactShadow(G, this, 0.8);
  }
}

export class Lever {
  constructor(def, G) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.down = !!G.state.flags[`gate:${def.opens}`];
  }
  interactable() {
    return !this.down;
  }
  interact(G) {
    return this.takeHit(G);
  }
  takeHit(G) {
    if (this.down) return false;
    this.down = true;
    G.sfx('lever');
    G.openGate(this.def.opens, true);
    G.message('The grate grinds open. A way back down to the courtyard.');
    return true;
  }
  update() {}
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.4);
    G.actors.add({ rect: `lever.${this.down ? 1 : 0}`, x: this.x, y: this.y - 0.04, z: this.z, w: 0.73, h: 1.0, tint, cast: true });
  }
}

export class Chest {
  constructor(def, G) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.open = !!G.state.flags.chest;
    G.collider.solids.push({ x0: this.x - 0.55, z0: this.z - 0.3, x1: this.x + 0.55, z1: this.z + 0.3, y0: this.y - 0.2, y1: this.y + 0.75, kind: 'chest' });
  }
  interactable() {
    return !this.open;
  }
  interact(G) {
    if (this.open) return false;
    this.open = true;
    G.state.flags.chest = true;
    G.state.secrets++;
    G.sfx('secret');
    G.state.maxHp += 1;
    G.state.hp = G.state.maxHp;
    for (let i = 0; i < 10; i++) G.spawnFx('glint', this.x + (Math.random() - 0.5), this.y + 0.5 + Math.random(), this.z + 0.2);
    G.message('Hidden chamber: a Heart Vessel. Your heart grows stronger.');
    return true;
  }
  takeHit(G) {
    return this.interact(G);
  }
  update() {}
  draw(G) {
    const tint = litTint(G, this, [0, 0, 0, 1], 0.4);
    G.actors.add({ rect: `chest.${this.open ? 1 : 0}`, x: this.x, y: this.y - 0.04, z: this.z, w: 1.2, h: 1.0, tint, cast: true });
    contactShadow(G, this, 1.1);
  }
}

export class Stele {
  constructor(def, G) {
    this.def = def;
    this.x = def.x;
    this.z = def.z;
    this.y = G.collider.ground(def.x, def.z, 50);
    this.text = def.text;
  }
  interactable() {
    return true;
  }
  interact(G) {
    G.message(this.text, 6);
    G.sfx('read');
    return true;
  }
  update() {}
  draw() {}
}

export class Crack {
  constructor(solid, G, mesh) {
    this.solid = solid;
    this.x = (solid.x0 + solid.x1) / 2;
    this.z = solid.z1;
    this.y = solid.y0;
    this.hp = 3;
    this.mesh = mesh;
    if (G.state.flags.crack) this.breakNow(G, true);
  }
  takeHit(G, dmg) {
    if (this.solid.off) return false;
    this.hp -= 1;
    G.sfx('crack');
    G.shake(0.1);
    for (let i = 0; i < 3; i++) G.spawnFx('chip', this.x + (Math.random() - 0.5) * 2, this.y + 0.6 + Math.random(), this.z + 0.2);
    if (this.hp <= 0) this.breakNow(G);
    return true;
  }
  breakNow(G, silent) {
    this.solid.off = true;
    if (this.mesh) this.mesh.visible = false;
    G.state.flags.crack = true;
    if (!silent) {
      G.sfx('secret');
      G.message('The cracked wall gives way.');
      for (let i = 0; i < 10; i++) G.spawnFx('chip', this.x + (Math.random() - 0.5) * 3, this.y + Math.random() * 2, this.z + 0.3);
    }
  }
  update() {}
  draw(G) {
    if (this.solid.off) return;
    G.flat.add({ rect: 'cracks', mode: 2, x: this.x, y: this.y + 2.4, z: this.z + 0.03, angle: 0, w: 2.2, h: 2.2, tint: [0.9, 0.9, 0.9, 1] });
  }
}

export class Pickup {
  constructor(kind, x, z, G) {
    this.kind = kind;
    this.x = x;
    this.z = z;
    this.y = G.collider.ground(x, z, 50);
    this.t = 0;
    this.alive = true;
  }
  update(dt, G) {
    this.t += dt;
    const P = G.player;
    if (P && !P.dead && this.t > 0.3 && len2(P.x - this.x, P.z - this.z) < 0.7 && Math.abs(P.y - this.y) < 1.2) {
      this.alive = false;
      if (this.kind === 'heart') {
        G.state.hp = Math.min(G.state.maxHp, G.state.hp + 1);
        G.sfx('pickup');
      } else if (this.kind === 'vessel') {
        G.state.maxHp += 1;
        G.state.hp = G.state.maxHp;
        G.sfx('secret');
        for (let i = 0; i < 8; i++) G.spawnFx('glint', this.x + (Math.random() - 0.5), this.y + Math.random() * 1.2, this.z);
        if (this.def?.secret) {
          G.state.secrets++;
          G.message('Behind the waterfall: a Heart Vessel. Your heart grows stronger.');
        } else G.message('A Heart Vessel. Your heart grows stronger.');
        if (this.flag) G.state.flags[this.flag] = true;
      }
    }
  }
  draw(G) {
    const bob = Math.sin(this.t * 4) * 0.08 + 0.25;
    const tint = litTint(G, this, [0, 0, 0, 1], 0.4);
    const b = 1.25;
    if (this.kind === 'heart') G.actors.add({ rect: 'heart', x: this.x, y: this.y + bob, z: this.z, w: 0.42, h: 0.38, tint: [tint[0] * b, tint[1] * b, tint[2] * b, 1] });
    else G.actors.add({ rect: 'vessel', x: this.x, y: this.y + bob, z: this.z, w: 0.75, h: 0.75, tint: [tint[0] * b, tint[1] * b, tint[2] * b, 1], cast: true });
    contactShadow(G, this, 0.45);
  }
}

// ------------------------------------------------------------ projectiles and rings
export class Seed {
  constructor(x, y, z, tx, ty, tz, speed) {
    const dx = tx - x, dz = tz - z, d = len2(dx, dz) || 1;
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = (dx / d) * speed;
    this.vz = (dz / d) * speed;
    this.vy = ((ty - y) / d) * speed * 0.5;
    this.t = 0;
    this.alive = true;
  }
  update(dt, G) {
    this.t += dt;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    this.y += this.vy * dt;
    if (this.t > 2.6 || G.collider.terrain(this.x, this.z) > this.y || G.collider.blocked(this.x, this.z, this.y - 0.1, 0.05, 0.2)) {
      this.alive = false;
      G.spawnFx('puff', this.x, this.y, this.z);
      return;
    }
    const P = G.player;
    if (P && !P.dead && len2(P.x - this.x, P.z - this.z) < 0.45 && this.y > P.y && this.y < P.y + 1.5) {
      this.alive = false;
      P.hurt(G, 1, this.x - this.vx, this.z - this.vz);
    }
  }
  // the hero can bat seeds away
  takeHit(G) {
    this.alive = false;
    G.spawnFx('spark', this.x, this.y, this.z);
    G.sfx('hit');
    return true;
  }
  draw(G) {
    G.actors.add({ rect: 'seed', x: this.x, y: this.y - 0.15, z: this.z, w: 0.32, h: 0.32, tint: [1.1, 1.05, 0.95, 1], cast: true });
    const g = G.collider.ground(this.x, this.z, this.y);
    G.fx.add({ rect: 'blob', mode: 1, x: this.x, y: g + 0.03, z: this.z, w: 0.35, h: 0.18, tint: [0, 0, 0, 0.4] });
  }
}

export class Ring {
  constructor(x, y, z, maxR, dur, owner) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.maxR = maxR;
    this.dur = dur;
    this.t = 0;
    this.alive = true;
    this.owner = owner;
    this.hitDone = false;
  }
  get r() {
    return 0.4 + (this.maxR - 0.4) * Math.min(1, this.t / this.dur);
  }
  update(dt, G) {
    this.t += dt;
    if (this.t > this.dur + 0.25) this.alive = false;
    const P = G.player;
    if (!P || P.dead || this.hitDone || this.t > this.dur) return;
    const d = len2(P.x - this.x, P.z - this.z);
    const r = this.r;
    // a grounded hero inside the travelling band is caught; jumping clears it
    if (Math.abs(d - r) < 0.45 && P.y - this.y < 0.45 && P.y > this.y - 1.2) {
      this.hitDone = true;
      P.hurt(G, 1, this.x, this.z);
    }
  }
  draw(G) {
    const r = this.r;
    const a = this.t > this.dur ? Math.max(0, 1 - (this.t - this.dur) * 4) : 1;
    G.fx.add({ rect: 'ring', mode: 1, x: this.x, y: this.y + 0.04, z: this.z, w: r * 2.2, h: r * 2.2, tint: [1.1, 1.05, 0.95, a] });
  }
}

export class Fx {
  constructor(kind, x, y, z) {
    this.kind = kind;
    this.x = x;
    this.y = y;
    this.z = z;
    this.t = 0;
    this.alive = true;
    const r = Math.random;
    this.vx = (r() - 0.5) * 2.5;
    this.vz = (r() - 0.5) * 1.2;
    this.vy = kind === 'chip' || kind === 'leaf' ? 3 + r() * 2 : kind === 'glint' ? 0.8 : 0.4;
    this.life = { puff: 0.45, spark: 0.22, splash: 0.4, ripple: 0.7, chip: 0.8, leaf: 1.0, glint: 0.7, splat: 1.1 }[kind] ?? 0.5;
    this.variant = Math.floor(r() * 3);
  }
  update(dt) {
    this.t += dt;
    if (this.t > this.life) this.alive = false;
    if (this.kind === 'chip' || this.kind === 'leaf') {
      this.vy -= (this.kind === 'leaf' ? 6 : 16) * dt;
      this.x += this.vx * dt;
      this.z += this.vz * dt;
      this.y += this.vy * dt;
    } else if (this.kind === 'puff' || this.kind === 'glint') {
      this.y += this.vy * dt;
    }
  }
  draw(G) {
    const f = Math.min(2, Math.floor((this.t / this.life) * 3));
    const k = this.kind;
    const fade = 1 - this.t / this.life;
    if (k === 'puff') G.fx.add({ rect: `puff.${f}`, x: this.x, y: this.y - 0.2, z: this.z + 0.1, w: 0.67, h: 0.53, tint: [0.95, 0.92, 0.85, 0.9] });
    else if (k === 'spark') G.fx.add({ rect: `spark.${f}`, x: this.x, y: this.y - 0.4, z: this.z + 0.2, w: 0.8, h: 0.8, tint: [1.2, 1.15, 1, 1] });
    else if (k === 'splash') G.fx.add({ rect: `splash.${f}`, x: this.x, y: this.y - 0.05, z: this.z + 0.05, w: 0.8, h: 0.67, tint: [1, 1, 1, 1] });
    else if (k === 'ripple') G.fx.add({ rect: 'ring', mode: 1, x: this.x, y: this.y + 0.01, z: this.z, w: 0.4 + this.t * 1.4, h: 0.3 + this.t * 1.0, tint: [0.75, 0.85, 0.9, fade * 0.8] });
    else if (k === 'chip') G.fx.add({ rect: `chip.${this.variant}`, x: this.x, y: this.y, z: this.z, w: 0.3, h: 0.24, tint: [0.9, 0.88, 0.85, 1] });
    else if (k === 'leaf') G.fx.add({ rect: `leaf.${this.variant}`, x: this.x + Math.sin(this.t * 8) * 0.15, y: this.y, z: this.z, w: 0.3, h: 0.24, tint: [0.85, 0.9, 0.8, 1] });
    else if (k === 'splat') G.fx.add({ rect: `slime.splat.${Math.min(2, Math.floor(this.t * 9))}`, mode: 1, x: this.x, y: this.y, z: this.z, w: 1.0, h: 0.62, tint: [0.9, 0.9, 0.9, Math.min(1, fade * 2.5)] });
    else if (k === 'glint') G.fx.add({ rect: `glint.${f}`, x: this.x, y: this.y, z: this.z + 0.1, w: 0.33, h: 0.33, tint: [1.2, 1.1, 0.85, fade + 0.2] });
  }
}

export const CREATURES = { slime: Slime, bulb: Bulb, sentinel: Sentinel, moth: Moth, boss: Warden };
export { len2, T };
