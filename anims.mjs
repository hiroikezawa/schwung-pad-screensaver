/*
 * PAD SCREENSAVER - the ten animations.
 *
 * Pure: an animation is advanced by step(dt) (seconds, already scaled by
 * SPEED) and drawn by render(fb) into an RGB frame buffer of 8 x 4 pads,
 * fb[(y * W + x) * 3 + c] in 0..1. Here y = 0 is the TOP row; mapping to
 * Move's pad notes is done in one place, padNote() in ui_core.mjs.
 * Randomness is injected so the tests can seed it.
 */

export const W = 8, H = 4, N = W * H;

export const ANIM_NAMES = [
    "PLASMA FLOW", "KNIGHT RIDER", "MATRIX RAIN", "FIRE", "WAVE INTERFERENCE",
    "DIGITAL GLITCH", "PARTICLE SNAKE", "COLOR GRADIENT", "CELLULAR AUTOMATA",
    "DUAL SCANNER",
];
export const ANIM_COUNT = ANIM_NAMES.length;

const TAU = Math.PI * 2;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fract = (v) => v - Math.floor(v);

/* h, s, v in 0..1 (h wraps) -> writes into fb at pixel i */
export function hsv(fb, i, h, s, v) {
    h = fract(h) * 6;
    const k = Math.floor(h), f = h - k;
    const p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
    let r, g, b;
    switch (k) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
    }
    fb[i * 3] = r; fb[i * 3 + 1] = g; fb[i * 3 + 2] = b;
}

function set(fb, i, r, g, b) { fb[i * 3] = r; fb[i * 3 + 1] = g; fb[i * 3 + 2] = b; }

/* Fixed-rate sub-steps for the discrete simulations, so speed changes only
 * how often they run, never what a step does. */
function stepper(period, fn) {
    let acc = 0;
    return (dt) => {
        acc += dt;
        let n = 0;
        while (acc >= period && n < 8) { acc -= period; fn(); n++; }
        if (acc > period) acc = 0;                 /* drop a backlog, never burst */
    };
}

/* 01 ------------------------------------------------------------ PLASMA FLOW */
function plasma(rand) {
    let t = rand() * 100;
    return {
        step(dt) { t += dt; },
        render(fb) {
            const cx = 3.5 + 3 * Math.sin(t * 0.31), cy = 1.5 + 1.5 * Math.cos(t * 0.23);
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    const v = Math.sin(x * 0.55 + t * 0.9)
                        + Math.sin(y * 0.9 - t * 0.6)
                        + Math.sin((x + y) * 0.45 + t * 1.1)
                        + Math.sin(Math.hypot(x - cx, y - cy) * 1.1 - t);
                    hsv(fb, y * W + x, v * 0.12 + t * 0.04, 0.9, 0.55 + 0.45 * Math.sin(v * 0.8 + t * 0.5) ** 2);
                }
        },
    };
}

/* 02 ----------------------------------------------------------- KNIGHT RIDER */
function knight(rand) {
    let phase = rand() * TAU;
    const trail = new Float32Array(W);
    let head = 0;
    return {
        step(dt) {
            phase += dt * 1.6;
            head = 3.5 - 3.5 * Math.cos(phase);   /* eases into each end */
            const decay = Math.exp(-dt * 5);
            for (let x = 0; x < W; x++) {
                const near = Math.max(0, 1 - Math.abs(x - head));
                trail[x] = Math.max(trail[x] * decay, near);
            }
        },
        render(fb) {
            for (let y = 0; y < H; y++) {
                const spread = y === 1 || y === 2 ? 1 : 0.35;   /* a beam, wider in the middle */
                for (let x = 0; x < W; x++) {
                    const v = trail[x] * spread;
                    const hot = Math.max(0, 1 - Math.abs(x - head) * 1.5) * spread;
                    set(fb, y * W + x, v, 0.12 * hot, 0.03 * hot);
                }
            }
        },
    };
}

/* 03 ------------------------------------------------------------ MATRIX RAIN */
function matrix(rand) {
    const glow = new Float32Array(N);
    const drops = [];
    function spawn(x, delay) {
        return { x, y: -1 - rand() * 2, v: 2.2 + rand() * 3, wait: delay };
    }
    for (let x = 0; x < W; x++) drops.push(spawn(x, rand() * 2));
    return {
        step(dt) {
            const decay = Math.exp(-dt * 3.2);
            for (let i = 0; i < N; i++) glow[i] *= decay;
            for (let k = 0; k < W; k++) {
                const d = drops[k];
                if (d.wait > 0) { d.wait -= dt; continue; }
                d.y += d.v * dt;
                if (d.y >= H + 0.5) { drops[k] = spawn(d.x, rand() * 1.8); continue; }
                /* interpolate the head across two rows, so 4 rows still flow */
                const y0 = Math.floor(d.y), f = d.y - y0;
                if (y0 >= 0 && y0 < H) glow[y0 * W + d.x] = Math.max(glow[y0 * W + d.x], 1 - f * 0.5);
                if (y0 + 1 >= 0 && y0 + 1 < H) glow[(y0 + 1) * W + d.x] = Math.max(glow[(y0 + 1) * W + d.x], f);
            }
        },
        render(fb) {
            for (let i = 0; i < N; i++) {
                const v = glow[i];
                const white = v > 0.85 ? (v - 0.85) * 4 : 0;   /* the head is near-white */
                set(fb, i, white * 0.6, v, white * 0.45 + v * 0.12);
            }
        },
    };
}

/* 04 ------------------------------------------------------------------- FIRE */
function fire(rand) {
    /* rows 0..H-1 are the pads (0 = top), row H is the hidden heat source */
    const heat = new Float32Array(W * (H + 1));
    const next = new Float32Array(W * (H + 1));
    const tick = stepper(1 / 18, () => {
        for (let x = 0; x < W; x++) heat[H * W + x] = 0.65 + rand() * 0.45;
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const below = (y + 1) * W;
                const l = heat[below + Math.max(0, x - 1)], c = heat[below + x];
                const r = heat[below + Math.min(W - 1, x + 1)];
                const v = (l + 2 * c + r + heat[y * W + x]) / 5;
                next[y * W + x] = Math.max(0, v - (0.05 + rand() * 0.12) * (1.25 - y / H));
            }
        heat.set(next.subarray(0, H * W));
    });
    for (let i = 0; i < 24; i++) tick(1 / 18);
    return {
        step: tick,
        render(fb) {
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    const h = clamp01(heat[y * W + x] * 1.2);
                    /* black -> red -> orange -> yellow */
                    set(fb, y * W + x, clamp01(h * 2), clamp01(h * 1.6 - 0.55), clamp01(h * 2 - 1.75) * 0.5);
                }
        },
    };
}

/* 05 ------------------------------------------------------ WAVE INTERFERENCE */
function waves(rand) {
    let t = rand() * 50;
    const a1 = rand() * TAU, a2 = rand() * TAU;
    const k1 = [Math.cos(a1) * 0.9, Math.sin(a1) * 0.9], k2 = [Math.cos(a2) * 0.7, Math.sin(a2) * 0.7];
    return {
        step(dt) { t += dt; },
        render(fb) {
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    const w1 = Math.sin(x * 0.8 - t * 1.4);
                    const w2 = Math.sin(x * k1[0] + y * k1[1] + t * 1.1);
                    const w3 = Math.sin(x * k2[0] + y * k2[1] - t * 0.7);
                    const sum = (w1 + w2 + w3) / 3;               /* -1..1 */
                    const v = clamp01((sum + 0.35) / 1.35) ** 1.6;
                    hsv(fb, y * W + x, 0.5 + 0.28 * (0.5 + 0.5 * Math.sin(sum * 2 + t * 0.3)), 0.85, v);
                }
        },
    };
}

/* 06 --------------------------------------------------------- DIGITAL GLITCH */
const GLITCH_COLORS = [[1, 0.05, 0.05], [1, 1, 1], [0, 0.9, 1], [0, 0.9, 1], [1, 0.05, 0.2]];
function glitch(rand) {
    const base = new Float32Array(N * 3);
    const blocks = [];
    let shiftRow = -1, shiftBy = 0, shiftLeft = 0;
    let invertRow = -1, invertLeft = 0;
    let t = 0;
    const tick = stepper(1 / 20, () => {
        t++;
        if (rand() < 0.22 && blocks.length < 4) {
            const w = 1 + Math.floor(rand() * 3), h = 1 + Math.floor(rand() * 2);
            blocks.push({
                x: Math.floor(rand() * (W - w + 1)), y: Math.floor(rand() * (H - h + 1)), w, h,
                c: GLITCH_COLORS[Math.floor(rand() * GLITCH_COLORS.length)], life: 2 + Math.floor(rand() * 6),
            });
        }
        for (let i = blocks.length - 1; i >= 0; i--) if (--blocks[i].life <= 0) blocks.splice(i, 1);
        if (shiftLeft > 0) shiftLeft--;
        else if (rand() < 0.06) { shiftRow = Math.floor(rand() * H); shiftBy = rand() < 0.5 ? -2 : 2; shiftLeft = 3; }
        if (invertLeft > 0) invertLeft--;
        else if (rand() < 0.03) { invertRow = Math.floor(rand() * H); invertLeft = 2; }
        /* a dim cyan "signal" that scrolls, with a few noise sparks */
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const on = ((x + y * 3 + t) % 7) < 2;
                const i = (y * W + x) * 3;
                base[i] = 0; base[i + 1] = on ? 0.22 : 0.03; base[i + 2] = on ? 0.28 : 0.05;
                if (rand() < 0.02) { base[i] = 0.7; base[i + 1] = 0.7; base[i + 2] = 0.7; }
            }
    });
    return {
        step: tick,
        render(fb) {
            fb.set(base);
            for (const b of blocks)
                for (let y = b.y; y < b.y + b.h; y++)
                    for (let x = b.x; x < b.x + b.w; x++) set(fb, y * W + x, b.c[0], b.c[1], b.c[2]);
            if (shiftLeft > 0 && shiftRow >= 0) {
                const row = fb.slice(shiftRow * W * 3, (shiftRow + 1) * W * 3);
                for (let x = 0; x < W; x++) {
                    const sx = ((x - shiftBy) % W + W) % W;
                    for (let c = 0; c < 3; c++) fb[(shiftRow * W + x) * 3 + c] = row[sx * 3 + c];
                }
            }
            /* one row inverted at a time: never a full-screen strobe */
            if (invertLeft > 0 && invertRow >= 0)
                for (let x = 0; x < W; x++)
                    for (let c = 0; c < 3; c++) {
                        const i = (invertRow * W + x) * 3 + c;
                        fb[i] = 1 - fb[i];
                    }
        },
    };
}

/* 07 --------------------------------------------------------- PARTICLE SNAKE */
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function snake(rand) {
    const LEN = 7;
    let body = [[1, 1], [0, 1]];
    let dir = 0;
    let hue = rand();
    const free = (x, y) => x >= 0 && x < W && y >= 0 && y < H &&
        !body.some(([bx, by], i) => i < body.length - 1 && bx === x && by === y);
    const tick = stepper(1 / 7, () => {
        const [hx, hy] = body[0];
        let choices = [dir, (dir + 1) % 4, (dir + 3) % 4];
        if (rand() < 0.2) choices = [choices[1 + Math.floor(rand() * 2)], ...choices];  /* wander */
        let d = -1;
        for (const c of choices) if (free(hx + DIRS[c][0], hy + DIRS[c][1])) { d = c; break; }
        if (d < 0) {                       /* boxed in: reverse along its own tail */
            body.reverse();
            const [ax, ay] = body[0], [bx, by] = body[1] || body[0];
            dir = DIRS.findIndex(([dx, dy]) => dx === ax - bx && dy === ay - by);
            if (dir < 0) dir = 0;
            return;
        }
        dir = d;
        body.unshift([hx + DIRS[d][0], hy + DIRS[d][1]]);
        if (body.length > LEN) body.pop();
    });
    return {
        step(dt) { hue += dt * 0.05; tick(dt); },
        render(fb) {
            fb.fill(0);
            body.forEach(([x, y], i) => {
                const v = i === 0 ? 1 : 0.75 * (1 - i / LEN) + 0.05;
                hsv(fb, y * W + x, hue + i * 0.03, i === 0 ? 0.35 : 0.9, v);
            });
        },
    };
}

/* 08 --------------------------------------------------------- COLOR GRADIENT */
function gradient(rand) {
    let t = rand() * 20;
    return {
        step(dt) { t += dt; },
        render(fb) {
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++)
                    hsv(fb, y * W + x, t * 0.06 - x / W * 0.45 + y * 0.035, 0.85, 1);
        },
    };
}

/* 09 ------------------------------------------------------ CELLULAR AUTOMATA */
function life(rand) {
    let cells = 0;                          /* 32 cells = one 32-bit word */
    const glow = new Float32Array(N);
    const history = [];
    let gen = 0, hue = rand();
    const alive = (c, x, y) => (c >>> (((y + H) % H) * W + ((x + W) % W))) & 1;
    function seed() {
        cells = 0;
        for (let i = 0; i < N; i++) if (rand() < 0.4) cells |= 1 << i;
        cells >>>= 0;
        history.length = 0;
        gen = 0;
    }
    seed();
    const tick = stepper(0.45, () => {
        let next = 0;
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                let n = 0;
                for (let dy = -1; dy <= 1; dy++)
                    for (let dx = -1; dx <= 1; dx++) if (dx || dy) n += alive(cells, x + dx, y + dy);
                const a = alive(cells, x, y);
                if (n === 3 || (a && n === 2)) next |= 1 << (y * W + x);
            }
        next >>>= 0;
        hue += 0.035;
        gen++;
        /* extinct, frozen, or looping (any of the last 12 states): reseed */
        if (next === 0 || history.includes(next) || gen > 120) seed();
        else {
            history.push(cells);
            if (history.length > 12) history.shift();
            cells = next;
        }
    });
    return {
        step(dt) {
            tick(dt);
            const decay = Math.exp(-dt * 2.5);
            for (let i = 0; i < N; i++) glow[i] = (cells >>> i) & 1 ? 1 : glow[i] * decay;
        },
        render(fb) {
            for (let i = 0; i < N; i++) {
                const on = (cells >>> i) & 1;
                hsv(fb, i, hue + (on ? 0 : 0.12), on ? 0.75 : 0.95, on ? 1 : glow[i] * 0.45);
            }
        },
    };
}

/* 10 ----------------------------------------------------------- DUAL SCANNER */
function dual(rand) {
    let phase = rand() * TAU;
    const red = new Float32Array(N), blue = new Float32Array(N);
    let a = 0;
    return {
        step(dt) {
            phase += dt * 1.3;
            a = 3.5 - 3.5 * Math.cos(phase);     /* left edge -> right edge -> back */
            const b = (W - 1) - a;               /* mirrored: they cross in the middle */
            const decay = Math.exp(-dt * 4);
            for (let y = 0; y < H; y++)
                for (let x = 0; x < W; x++) {
                    const i = y * W + x;
                    red[i] = Math.max(red[i] * decay, Math.max(0, 1 - Math.abs(x - a) * 1.2));
                    blue[i] = Math.max(blue[i] * decay, Math.max(0, 1 - Math.abs(x - b) * 1.2));
                }
        },
        render(fb) {
            for (let i = 0; i < N; i++) {
                const r = red[i], b = blue[i];
                /* additive: where they meet the pads go magenta / white-ish */
                set(fb, i, clamp01(r + b * 0.15), clamp01(Math.min(r, b) * 0.5), clamp01(b + r * 0.15));
            }
        },
    };
}

const FACTORIES = [plasma, knight, matrix, fire, waves, glitch, snake, gradient, life, dual];

export function makeAnim(index, rand = Math.random) {
    const i = ((index % ANIM_COUNT) + ANIM_COUNT) % ANIM_COUNT;
    const a = FACTORIES[i](rand);
    a.index = i;
    a.name = ANIM_NAMES[i];
    a.step(0);
    return a;
}

/* ----------------------------------------------------------------- schedule */

export const MODES = ["random", "sequential"];

/* Picks the next animation. RANDOM never repeats the one before it. */
export function pickNext(current, mode, rand) {
    if (mode === 1) return current < 0 ? 0 : (current + 1) % ANIM_COUNT;
    if (current < 0) return Math.floor(rand() * ANIM_COUNT) % ANIM_COUNT;
    const r = Math.floor(rand() * (ANIM_COUNT - 1)) % (ANIM_COUNT - 1);
    return r >= current ? r + 1 : r;
}
