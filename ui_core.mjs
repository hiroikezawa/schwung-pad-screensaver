/*
 * PAD SCREENSAVER - its own screen, and the 32 pads as a display.
 *
 * Pure logic: every host service (param channel, LEDs, pad block, display)
 * is injected, so tests/test_ui.mjs drives exactly this file under node.
 * The wiring to Schwung's real globals is ui_chain.js.
 *
 * While this module's screen is shown it holds host_pad_block and paints
 * the pads. The shim honours pad_block only while the Schwung screen is up
 * and drops it by itself when the screen goes away, so on a Move track the
 * pads (and their LEDs) are Move's again. Leaving -- Back, or the screen
 * closing -- puts Move's own colours back from the pad LED snapshot.
 */

import { W, H, N, ANIM_COUNT, ANIM_NAMES, makeAnim, pickNext } from './anims.mjs';
import { quantize, nearestByKey } from './palette.mjs';

/* Move's pads are notes 68-99 and count up from the BOTTOM-LEFT (Schwung's
 * CLAUDE.md, "Move's rack counts up from the BOTTOM-LEFT"). Animations draw
 * with y = 0 at the top, so the flip happens here and only here. */
export const PAD_FIRST = 68;
export const PAD_LAST = 99;
export function padNote(x, y) { return PAD_FIRST + (H - 1 - y) * W + x; }

export const MODE_LABELS = ["RANDOM", "SEQUENTIAL"];
const MODE_SHORT = ["RND", "SEQ"];

/* Knob 1 is deliberately unassigned (a MIDI FX has no MIX/VOLUME). */
export const KNOBS = [
    null,
    { key: "interval",   label: "INT",  name: "INTERVAL",   min: 10, max: 180, step: 1, detents: 1 },
    { key: "brightness", label: "BRT",  name: "BRIGHTNESS", min: 5,  max: 100, step: 1, detents: 1 },
    { key: "speed",      label: "SPD",  name: "SPEED",      min: 25, max: 300, step: 5, detents: 1 },
    { key: "mode",       label: "MODE", name: "MODE",       min: 0,  max: 1,   step: 1, detents: 4 },
];
const KNOB_CC_FIRST = 71;

export const DEFAULTS = { interval: 30, brightness: 70, speed: 100, mode: 0 };

export const FRAME_MS = 40;          /* 25 FPS */
export const FADE_MS = 750;          /* crossfade between animations */
const REASSERT_EVERY_FRAMES = 6;     /* one row of our LEDs re-sent round-robin */
const TOUCH_SHOW_MS = 900;

export function decodeDelta(v) {
    if (v >= 1 && v <= 63) return v;
    if (v >= 65 && v <= 127) return v - 128;
    return 0;
}

/* The DSP's one-line state: 1,interval,brightness,speed,mode */
export function parseUiState(text) {
    if (typeof text !== "string" || text.length === 0) return null;
    const f = text.split(",").map(Number);
    if (f.length !== 5 || f[0] !== 1 || f.some((x) => !Number.isInteger(x))) return null;
    return { interval: f[1], brightness: f[2], speed: f[3], mode: f[4] === 1 ? 1 : 0 };
}

/**
 * host = {
 *   setParam(key, value) -> bool, getParam(key) -> string|null,
 *   padBlock(on), sendLed(note, color) -> bool, padSnapshot() -> {note: color}|null,
 *   displayOn() -> bool, now() -> ms, random() -> [0,1),
 *   gfx: { clear(), print(x, y, text, color), fillRect(x, y, w, h, c),
 *          drawRect(x, y, w, h, c), textWidth(text) }
 * }
 */
export function createUi(host) {
    const rand = host.random || Math.random;
    let s = { ...DEFAULTS };
    let haveState = false;

    let cur = null, prev = null;
    let fadeStart = -Infinity;
    let nextSwitchAt = 0;
    let lastFrame = 0, nextFrame = 0, frameCount = 0;
    const fbCur = new Float32Array(N * 3), fbPrev = new Float32Array(N * 3);
    const outColor = new Int16Array(N);           /* palette index per pad, y=0 top */

    const acc = [0, 0, 0, 0, 0];
    const pending = new Map();
    let ledCache = {};
    let moveSnap = null;
    let reassertRow = 0;
    let wasOn = false;
    let touched = -1, lastKnob = -1, showUntil = 0;
    let dirty = true;
    let lastShownSecond = -1;
    let switches = 0;

    function refresh() {
        const next = parseUiState(host.getParam("ui_state"));
        if (next) {
            /* a knob write still in flight wins over the read it raced */
            for (const k of pending.keys()) next[k] = s[k];
            s = next;
            haveState = true;
            dirty = true;
        }
    }

    function flushPending() {
        for (const [key, value] of pending)
            host.setParam(key, key === "mode" ? (value ? "sequential" : "random") : String(value));
        pending.clear();
    }

    /* ---- scheduling ---- */
    function switchAnim(now, fade) {
        const idx = pickNext(cur ? cur.index : -1, s.mode, rand);
        if (fade && cur) { prev = cur; fadeStart = now; } else { prev = null; fadeStart = -Infinity; }
        cur = makeAnim(idx, rand);
        /* INTERVAL is read here, so a knob change takes effect from the next switch */
        nextSwitchAt = now + s.interval * 1000;
        switches++;
        dirty = true;
    }

    /* ---- frame ---- */
    function renderFrame(now) {
        const dt = Math.min(0.1, Math.max(0, (now - lastFrame) / 1000)) * (s.speed / 100);
        lastFrame = now;
        cur.step(dt);
        cur.render(fbCur);
        let mix = 1;
        if (prev) {
            mix = (now - fadeStart) / FADE_MS;
            if (mix >= 1) { prev = null; mix = 1; }
            else { prev.step(dt); prev.render(fbPrev); }
        }
        const gain = s.brightness / 100;
        for (let i = 0; i < N; i++) {
            let r = fbCur[i * 3], g = fbCur[i * 3 + 1], b = fbCur[i * 3 + 2];
            if (mix < 1) {
                r = fbPrev[i * 3] + (r - fbPrev[i * 3]) * mix;
                g = fbPrev[i * 3 + 1] + (g - fbPrev[i * 3 + 1]) * mix;
                b = fbPrev[i * 3 + 2] + (b - fbPrev[i * 3 + 2]) * mix;
            }
            outColor[i] = nearestByKey(quantize(r * gain, g * gain, b * gain));
        }
    }

    /* ---- LEDs ---- */
    function paintLeds() {
        /* Move repaints its own pads; whatever Move changed since the last
         * frame is ours to put back now. */
        const snap = host.padSnapshot ? host.padSnapshot() : null;
        if (snap) {
            if (moveSnap)
                for (let note = PAD_FIRST; note <= PAD_LAST; note++)
                    if (snap[String(note)] !== moveSnap[String(note)]) delete ledCache[note];
            moveSnap = snap;
        }
        if (frameCount % REASSERT_EVERY_FRAMES === 0) {
            for (let col = 0; col < W; col++) delete ledCache[PAD_FIRST + reassertRow * W + col];
            reassertRow = (reassertRow + 1) % H;
        }
        for (let y = 0; y < H; y++)
            for (let x = 0; x < W; x++) {
                const note = padNote(x, y), color = outColor[y * W + x];
                if (ledCache[note] === color) continue;     /* unchanged: not re-sent */
                /* cache only what was queued, so a dropped packet is retried */
                if (host.sendLed(note, color)) ledCache[note] = color;
            }
    }

    /* Hand the pads back to Move with Move's own colours. */
    function restoreLeds() {
        const snap = host.padSnapshot ? host.padSnapshot() : null;
        for (let note = PAD_FIRST; note <= PAD_LAST; note++) {
            const c = snap && snap[String(note)] !== undefined ? snap[String(note)] : 0;
            host.sendLed(note, c);
        }
        ledCache = {};
        moveSnap = null;
    }

    function release() {
        flushPending();
        restoreLeds();
        host.padBlock(0);
    }

    /* ---- knobs ---- */
    function onKnobTurn(i, raw) {
        const k = KNOBS[i];
        const d = decodeDelta(raw);
        if (!k || d === 0) return;
        let steps;
        if (k.detents <= 1) steps = d;
        else {
            if (Math.sign(acc[i]) !== Math.sign(d)) acc[i] = 0;
            acc[i] += d;
            steps = Math.trunc(acc[i] / k.detents);
            acc[i] -= steps * k.detents;
        }
        lastKnob = i;
        showUntil = host.now() + TOUCH_SHOW_MS;
        dirty = true;
        if (steps === 0) return;
        const v = Math.min(k.max, Math.max(k.min, s[k.key] + steps * k.step));
        if (v === s[k.key]) return;
        s[k.key] = v;
        pending.set(k.key, v);
    }

    function onKnobTouch(i, down) {
        if (!KNOBS[i]) return;
        if (down) { touched = i; lastKnob = i; }
        else if (touched === i) touched = -1;
        showUntil = host.now() + TOUCH_SHOW_MS;
        dirty = true;
    }

    function onMidi(data) {
        if (!data || data.length < 3) return;
        const status = data[0] & 0xF0, d1 = data[1], d2 = data[2];
        if (status === 0x90 || status === 0x80) {
            /* pads are held by pad_block and do nothing here */
            if (d1 < KNOBS.length) onKnobTouch(d1, status === 0x90 && d2 > 0);
            return;
        }
        if (status === 0xB0 && d1 >= KNOB_CC_FIRST && d1 < KNOB_CC_FIRST + KNOBS.length)
            onKnobTurn(d1 - KNOB_CC_FIRST, d2);
    }

    /* ---- screen ---- */
    function valueText(i) {
        switch (i) {
        case 1: return `${s.interval}s`;
        case 2: return `${s.brightness}%`;
        case 3: return `${s.speed}%`;
        case 4: return MODE_SHORT[s.mode];
        default: return "";
        }
    }

    function draw(now) {
        const g = host.gfx;
        const tw = (t) => (g.textWidth ? g.textWidth(t) : t.length * 6);
        g.clear();
        g.fillRect(0, 0, 128, 11, 1);
        g.print(2, 2, "PAD SCREENSAVER", 0);

        const num = String(cur.index + 1).padStart(2, "0");
        g.print(0, 15, `${num} ${ANIM_NAMES[cur.index]}`, 1);
        const left = Math.max(0, Math.ceil((nextSwitchAt - now) / 1000));
        g.print(0, 26, `NEXT ${left}s`, 1);
        const m = MODE_LABELS[s.mode];
        g.print(126 - tw(m), 26, m, 1);

        const big = touched >= 0 ? touched : (now < showUntil ? lastKnob : -1);
        if (big >= 1) {
            const k = KNOBS[big];
            const v = big === 4 ? MODE_LABELS[s.mode] : valueText(big);
            g.print(0, 40, `${big + 1} ${k.name}`, 1);
            g.print(126 - tw(v), 40, v, 1);
            if (big !== 4) {
                g.drawRect(0, 52, 128, 10, 1);
                g.fillRect(2, 54, Math.round(124 * (s[k.key] - k.min) / (k.max - k.min)), 6, 1);
            } else {
                g.print(0, 53, s.mode ? "1 to 10 in order" : "never twice in a row", 1);
            }
        } else {
            for (let i = 1; i < KNOBS.length; i++) {
                const x = (i - 1) * 32;
                g.print(x + 1, 41, `${i + 1}${KNOBS[i].label}`, 1);
                g.print(x + 1, 53, valueText(i), 1);
            }
        }
        lastShownSecond = left;
        dirty = false;
    }

    /* ---- lifecycle ---- */
    function init() {
        refresh();
        const now = host.now();
        lastFrame = now;
        nextFrame = now;
        switchAnim(now, false);          /* the first animation is chosen too */
        ledCache = {};
        wasOn = false;
        dirty = true;
    }

    function tick() {
        const on = host.displayOn();
        if (!on) {
            if (wasOn) release();        /* screen dismissed: pads back to Move now */
            wasOn = false;
            return;
        }
        /* Restated EVERY frame: the shim drops the flag on its own on the
         * display edge, so remembering it would latch dead pads. */
        host.padBlock(1);
        const now = host.now();
        if (!wasOn) {
            ledCache = {}; moveSnap = null;
            if (!haveState) refresh();
            lastFrame = now;
            nextFrame = now;
        }
        wasOn = true;
        flushPending();

        if (now >= nextSwitchAt) switchAnim(now, true);
        if (now >= nextFrame) {
            /* one frame per tick at most, never a burst after a stall */
            nextFrame = Math.max(nextFrame + FRAME_MS, now);
            frameCount++;
            renderFrame(now);
            paintLeds();
        }
        const left = Math.max(0, Math.ceil((nextSwitchAt - now) / 1000));
        if (dirty || left !== lastShownSecond || now < showUntil + 50) draw(now);
    }

    /* Back leaves the module: tidy up, then let the host navigate. */
    function handleBack() {
        release();
        wasOn = false;
        return false;
    }

    return {
        init, tick, onMidi, handleBack,
        /* for tests */
        get state() { return { ...s }; },
        get anim() { return cur ? cur.index : -1; },
        get fading() { return prev !== null; },
        get nextSwitchAt() { return nextSwitchAt; },
        get switches() { return switches; },
        get colors() { return Array.from(outColor); },
    };
}

export { ANIM_COUNT };
