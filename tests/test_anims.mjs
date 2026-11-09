/* The ten animations and the scheduler, without hardware. */
import { W, H, N, ANIM_COUNT, ANIM_NAMES, makeAnim, pickNext } from '../anims.mjs';
import { nearest, PALETTE_SIZE, quantize, nearestByKey } from '../palette.mjs';

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error("FAIL", msg); } };

function seeded(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

check(ANIM_COUNT === 10 && ANIM_NAMES.length === 10, "ten animations");
check(W * H === 32 && N === 32, "8 x 4 grid");

/* Each animation: a frame buffer never written out of bounds (a guard band
 * after the 96 values must stay untouched), every value finite in 0..1,
 * every one of the 32 pads lit at some point, and the picture changes. */
for (let a = 0; a < ANIM_COUNT; a++) {
    for (const seed of [1, 2, 3]) {
        const rand = seeded(seed * 100 + a);
        const anim = makeAnim(a, rand);
        const big = new Float32Array(N * 3 + 16).fill(-7);
        const fb = big.subarray(0, N * 3);
        const lit = new Uint8Array(N);
        let changes = 0, prevKey = "";
        const dts = [1 / 25, 0, 0.1, 1 / 25 * 3, 1 / 25 * 0.25];
        for (let f = 0; f < 25 * 120; f++) {          /* two minutes */
            anim.step(dts[f % dts.length]);
            anim.render(fb);
            for (let i = 0; i < N * 3; i++)
                if (!(Number.isFinite(fb[i]) && fb[i] >= 0 && fb[i] <= 1)) {
                    check(false, `${ANIM_NAMES[a]} value ${fb[i]} at ${i}`); i = N * 3; f = 1e9;
                }
            for (let i = N * 3; i < big.length; i++) if (big[i] !== -7) { check(false, `${ANIM_NAMES[a]} wrote past the frame`); f = 1e9; break; }
            let key = "";
            for (let p = 0; p < N; p++) {
                const c = nearest(fb[p * 3] * 0.7, fb[p * 3 + 1] * 0.7, fb[p * 3 + 2] * 0.7);
                if (c !== 0) lit[p] = 1;
                key += c + ",";
            }
            if (key !== prevKey) changes++;
            prevKey = key;
        }
        const litCount = lit.reduce((s, v) => s + v, 0);
        check(litCount === N, `${ANIM_NAMES[a]} seed ${seed}: only ${litCount}/32 pads ever lit`);
        check(changes > 100, `${ANIM_NAMES[a]} seed ${seed}: picture changed only ${changes} times`);
    }
}

/* Out-of-range index wraps instead of throwing. */
check(makeAnim(10).index === 0 && makeAnim(-1).index === 9, "index wraps");

/* RANDOM never repeats and reaches all ten; SEQUENTIAL is 1..10 in order. */
{
    const rand = seeded(42);
    let cur = pickNext(-1, 0, rand);
    const seen = new Set([cur]);
    for (let i = 0; i < 5000; i++) {
        const n = pickNext(cur, 0, rand);
        check(n !== cur, "random repeated");
        check(n >= 0 && n < ANIM_COUNT, "random out of range");
        seen.add(n);
        cur = n;
    }
    check(seen.size === ANIM_COUNT, "random reaches all ten");
    /* even with a rand() that returns 0.9999999 or 0 */
    for (const r of [0, 0.9999999]) for (let c = 0; c < 10; c++) {
        const n = pickNext(c, 0, () => r);
        check(n !== c && n >= 0 && n < 10, `random edge r=${r} c=${c} -> ${n}`);
    }
    let s = pickNext(-1, 1, rand);
    check(s === 0, "sequential starts at 1");
    for (let i = 1; i < 25; i++) { s = pickNext(s, 1, rand); check(s === i % 10, "sequential order"); }
}

/* Palette: indices in range, black stays black, primaries land on themselves. */
check(PALETTE_SIZE === 128, "128 palette entries");
check(nearest(0, 0, 0) === 0, "black");
check(nearest(1, 1, 1) === 120, "white");
check(nearest(1, 0, 0) === 127 && nearest(0, 1, 0) === 126 && nearest(0, 0, 1) === 125, "primaries");
for (let k = 0; k < 32768; k += 97) { const c = nearestByKey(k); check(c >= 0 && c < 128 && c !== 117 && c !== 121, "palette index"); }
check(quantize(2, -1, 0.5) === ((31 << 10) | 16), "quantize clamps");

if (failures) { console.error(`test_anims: ${failures} failure(s)`); process.exit(1); }
console.log("test_anims: OK");
