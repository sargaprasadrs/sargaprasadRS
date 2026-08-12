/**
 * dragon.js — pixel-art retro dragon renderer + particles.
 * The sprite is hand-authored on a 26x24 grid (see SPRITES.base).
 * Overlays swap only the pixels that change for blink / eat frames.
 */
(function () {
  "use strict";

  const W = 26;
  const H = 24;

  const PALETTE = {
    B: "#8b5cf6", // body
    D: "#33206b", // outline
    L: "#c4b5fd", // highlight
    W: "#ffffff", // eye white
    E: "#170f38", // pupil
    H: "#f59e0b", // horn
    h: "#b45309", // horn shade
    N: "#6d28d9", // nose
    M: "#2e1065", // mouth
    T: "#ffffff", // tooth
    R: "#f9a8d4", // cheeks
    G: "#fef3c7", // belly
    f: "#6d28d9", // wing
  };

  /* Hand-drawn front-facing dragon: horns, wings, belly, buck teeth.
     Belly rows are built with .repeat() to keep the 26px grid exact. */
  const B = "B".repeat(18);
  const G14 = "G".repeat(14);
  const SPRITES = {
    base: [
      "........H........H........", // 0  horns tips
      ".......HHHH....HHHH.......", // 1
      "......HHHHHH..HHHHHH......", // 2
      "....DDDDDDDDDDDDDDDDDD....", // 3  head top
      "....DBBBBBBBBBBBBBBBBD....", // 4
      "...DBLLBBBBBBBBBBBBBBBBD..", // 5  head shine (L)
      "....DBBBWWWBBBBWWWBBBD....", // 6  eye whites
      "....DBBBWEWBBBBWEWBBBD....", // 7  pupils
      "....DBBBWWWBBBBWWWBBBD....", // 8  eye bottoms
      "....DBRBBBBNNNNBBBBRBD....", // 9  cheeks + nose
      "....DBBBBBBMMMMBBBBBBD....", // 10 mouth
      "....DBBBBBMMTTMMBBBBBD....", // 11 buck teeth
      "....DBBBBBBBBBBBBBBBBD....", // 12 chin
      "....DDDDDDDDDDDDDDDDDD....", // 13 head bottom
      ".fDDBBBBBBBBBBBBBBBBBBDDf.", // 14 wings + shoulders
      "..fD" + B + "Df..", // 15
      "..fDBB" + G14 + "BBDf..", // 16 belly
      ".ffDBB" + G14 + "BBDff.", // 17
      ".ffD" + B + "Dff.", // 18 hips
      "...DDDBBBBBBBBBBBBBBDDD...", // 19 hips
      "....DBB............BBD....", // 20 legs
      "....DBB............BBD....", // 21
      "....DBBBB........BBBBD....", // 22 feet
      "....DDDDD........DDDDD....", // 23
    ],
    W,
    H,
  };

  /* Sparse overlays: only rows listed change; '.' means "keep base pixel". */
  const OVERLAYS = {
    blink: {
      6: "....DBBBBBBBBBBBBBBBBD....", // hide eye whites
      7: "....DBBBEEEBBBBEEEBBBD....", // closed-eye lines
      8: "....DBBBBBBBBBBBBBBBBD....",
    },
    eat1: {
      10: "....DBBBBMMMMMMMMBBBBD....", // big open mouth
      11: "....DBBBBBMMMMMMBBBBBD....",
    },
    eat2: {
      10: "....DBBBBBMMMMMMBBBBBD....", // medium open (chomp)
      11: "....DBBBBBMMTTMMBBBBBD....",
    },
  };

  /* ---------- render helpers ---------- */
  function drawSprite(ctx, frame, ox, oy, scale, alpha) {
    ctx.globalAlpha = alpha;
    for (let r = 0; r < H; r++) {
      const baseRow = SPRITES.base[r];
      const overRow = frame.overlays[r] || null;
      for (let c = 0; c < W; c++) {
        const ch = overRow && overRow[c] !== "." ? overRow[c] : baseRow[c];
        if (ch === "." || ch === " ") continue;
        const color = PALETTE[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(ox + c * scale, oy + r * scale, scale, scale);
      }
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- particles ---------- */
  const PARTICLE_COLORS = {
    heart: "#f472b6",
    fire: "#fb923c",
    spark: "#fde047",
    zzz: "#a5f3fc",
    crumb: "#f59e0b",
    star: "#d8b4fe",
  };

  /* ---------- Dragon class ---------- */
  class Dragon {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
      this.fitScale = Math.min(
        Math.floor((canvas.width - 8) / W),
        Math.floor((canvas.height - 40) / H)
      );
      this.level = 1;
      this.baseScale = 9;
      this.scale = 9;
      this.squash = 0; // 0..1 amount of squish on pet
      this.bounce = 0; // excited bounce energy
      this.state = "idle"; // idle | eat | sleep | levelup | dance
      this.stateT = 0;
      this.stateDur = 1;
      this.blinkTimer = 2 + Math.random() * 3;
      this.blinking = 0;
      this.t = 0;
      this.particles = [];
      this.onFrame = null; // optional callback each frame
    }

    setLevel(lv) {
      this.level = Math.max(1, lv);
      this.baseScale = 9 + Math.min(this.level - 1, 9) * 0.5; // grow as it evolves
      this.scale = Math.min(Math.floor(this.baseScale), this.fitScale);
    }

    pet() {
      this.squash = 1;
      this.spawn("heart", 6);
      this.spawn("spark", 4);
    }

    playEat() {
      this.state = "eat";
      this.stateT = 0;
      this.stateDur = 1.4;
      this.spawn("crumb", 8);
    }

    playSleep() {
      this.state = "sleep";
      this.stateT = 0;
      this.stateDur = 3;
    }

    playLevelUp() {
      this.state = "levelup";
      this.stateT = 0;
      this.stateDur = 2.2;
      this.bounce = 1;
      this.spawn("fire", 26);
      this.spawn("star", 14);
    }

    playDance() {
      this.state = "dance";
      this.stateT = 0;
      this.stateDur = 2.5;
      this.bounce = 1;
    }

    spawn(kind, n, opts) {
      const o = opts || {};
      for (let i = 0; i < n; i++) {
        const fromTop = o.fromTop || 60; // % down the sprite
        const x = (W * this.scale * (0.25 + Math.random() * 0.5));
        const y = (H * this.scale * (fromTop + Math.random() * 30)) / 100;
        const dir = Math.random() < 0.5 ? 1 : -1;
        this.particles.push({
          kind,
          x,
          y,
          vx: (Math.random() - 0.5) * 30 + (kind === "zzz" ? 14 : 0),
          vy: kind === "fire" ? -40 - Math.random() * 30
            : kind === "crumb" ? 20 + Math.random() * 30
            : kind === "zzz" ? -12
            : -22 - Math.random() * 22,
          g: kind === "crumb" ? 60 : kind === "fire" ? -6 : 0,
          life: 1,
          decay: 0.7 + Math.random() * 0.8,
          size: 2 + Math.floor(Math.random() * 3),
          color: PARTICLE_COLORS[kind],
          wobble: Math.random() * Math.PI * 2,
          dir,
        });
      }
    }

    update(dt) {
      this.t += dt;
      // blink cycle
      this.blinkTimer -= dt;
      if (this.blinkTimer <= 0) {
        this.blinking = 0.18;
        this.blinkTimer = 2.4 + Math.random() * 3.5;
      }
      this.blinking = Math.max(0, this.blinking - dt);

      // state machine
      if (this.state !== "idle") {
        this.stateT += dt;
        if (this.stateT >= this.stateDur) this.state = "idle";
      }

      // squash / bounce decay
      this.squash = Math.max(0, this.squash - dt * 4);
      this.bounce = Math.max(0, this.bounce - dt * 1.4);

      // particles
      for (let i = this.particles.length - 1; i >= 0; i--) {
        const p = this.particles[i];
        p.life -= dt * p.decay;
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.wobble += dt * 6;
        p.x += p.vx * dt + Math.sin(p.wobble) * 8 * dt * p.dir;
        p.y += p.vy * dt;
        p.vy += p.g * dt;
      }

      if (this.onFrame) this.onFrame(this);
    }

    render() {
      const ctx = this.ctx;
      const Wpx = this.canvas.width;
      const Hpx = this.canvas.height;
      ctx.clearRect(0, 0, Wpx, Hpx);

      const sleeping = this.state === "sleep";

      // effective scale (integer for crisp pixels) + position
      let s = this.baseScale;
      if (this.state === "levelup") {
        const p = Math.min(1, this.stateT / 0.35);
        s = this.baseScale * (1 + 0.35 * Math.sin(Math.PI * p));
      } else if (this.bounce > 0) {
        s = this.baseScale * (1 + 0.06 * Math.sin(this.t * 14) * this.bounce);
      }
      s = Math.min(Math.floor(s), this.fitScale);
      this.scale = s;

      const sx = Wpx / 2 - (W * s) / 2;
      let bob = 0;
      if (!sleeping && this.state !== "levelup") bob = Math.sin(this.t * 2.2) * 1.5 * s / 12;
      let sy = Hpx - 20 - H * s - bob;
      if (sleeping) sy += 2; // droop

      // squash (petting)
      if (this.squash > 0) {
        const sq = 1 - 0.14 * this.squash;
        ctx.save();
        ctx.translate(Wpx / 2, Hpx - 24);
        ctx.scale(2 - sq, sq); // wider + shorter
        ctx.translate(-Wpx / 2, -(Hpx - 24));
        drawSprite(ctx, this._frame(), sx, sy, s, 1);
        ctx.restore();
      } else {
        drawSprite(ctx, this._frame(), sx, sy, s, sleeping ? 0.82 : 1);
      }

      // level-up glow
      if (this.state === "levelup") {
        const gp = 1 - Math.abs(this.stateT / this.stateDur - 0.5) * 2;
        ctx.strokeStyle = "rgba(251,191,36," + (0.5 * gp).toFixed(3) + ")";
        ctx.lineWidth = 4;
        const r = 40 + 90 * gp;
        ctx.beginPath();
        ctx.arc(Wpx / 2, Hpx - 40, r, 0, Math.PI * 2);
        ctx.stroke();
      }

      // particles
      for (const p of this.particles) {
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.fillRect(p.x, p.y, p.size, p.size);
      }
      ctx.globalAlpha = 1;
    }

    _frame() {
      const overlays = {};
      if (this.state === "sleep") Object.assign(overlays, OVERLAYS.blink);
      else if (this.blinking > 0) Object.assign(overlays, OVERLAYS.blink);
      if (this.state === "eat") {
        const half = this.stateDur / 2;
        Object.assign(overlays, this.stateT % (half * 2) < half ? OVERLAYS.eat1 : OVERLAYS.eat2);
      }
      return { overlays };
    }

    /** Wake the dragon when user interacts. */
    wake() {
      if (this.state === "sleep") this.state = "idle";
    }
  }

  /* ---------- debug: ASCII preview for validating pixel art ---------- */
  function debugPrint() {
    let bad = 0;
    SPRITES.base.forEach((row, i) => {
      if (row.length !== W) {
        console.error("ROW " + i + " length " + row.length + " (expected " + W + "): " + row);
        bad++;
      }
    });
    Object.entries(OVERLAYS).forEach(([name, rows]) => {
      Object.entries(rows).forEach(([r, row]) => {
        if (row.length !== W) {
          console.error("OVERLAY " + name + " row " + r + " length " + row.length + " (expected " + W + ")");
          bad++;
        }
      });
    });
    if (bad) { console.error(bad + " BAD ROW(S)"); return; }
    const out = [];
    SPRITES.base.forEach((row) => {
      out.push(row.split("").map((c) => (c === "." ? " " : c)).join(""));
    });
    console.log(out.join("\n"));
    console.log("W=" + W + " H=" + H + " — ALL ROWS OK");
  }

  const api = { Dragon, SPRITES, OVERLAYS, PALETTE, debugPrint, W, H };
  if (typeof window !== "undefined") {
    window.GitHubPet = window.GitHubPet || {};
    window.GitHubPet.Dragon = Dragon;
    window.GitHubPet.debugPrint = debugPrint;
  }
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
