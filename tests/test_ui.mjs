/* ui_core.mjs against a fake host: switching times, knobs, LEDs, hand-back. */
import { createUi, padNote, PAD_FIRST, PAD_LAST, FRAME_MS, FADE_MS } from '../ui_core.mjs';

let failures = 0;
const check = (cond, msg) => { if (!cond) { failures++; console.error("FAIL", msg); } };

function seeded(seed) {
    let a = seed >>> 0;
    return () => { a = (Math.imul(a, 1664525) + 1013904223) >>> 0; return a / 4294967296; };
}

function makeHost(opts = {}) {
    const h = {
        t: 1000, display: true, block: 0, params: {},
        dsp: "dsp" in opts ? opts.dsp : "1,30,70,100,0",
        leds: [], ledState: {}, sendOk: true,
        snapshot: Object.fromEntries(Array.from({ length: 32 }, (_, i) => [String(68 + i), (i * 5) % 128])),
        reads: 0, draws: 0,
    };
    h.api = {
        setParam: (k, v) => { h.params[k] = v; return true; },
        getParam: (k) => { h.reads++; return k === "ui_state" ? h.dsp : null; },
        padBlock: (on) => { h.block = on; },
        sendLed: (note, c) => {
            if (!h.sendOk) return false;
            h.leds.push([note, c]); h.ledState[note] = c; return true;
        },
        padSnapshot: () => ({ ...h.snapshot }),
        displayOn: () => h.display,
        now: () => h.t,
        random: seeded(opts.seed ?? 7),
        gfx: { clear() { h.draws++; }, print() {}, fillRect() {}, drawRect() {}, textWidth: (t) => t.length * 6 },
    };
    return h;
}

/* advance in shadow-UI ticks (~23 ms) */
function run(ui, h, ms) {
    const end = h.t + ms;
    while (h.t < end) { h.t += 23; ui.tick(); }
}

const knob = (n, delta) => [0xB0, 71 + n - 1, delta >= 0 ? delta : 128 + delta];

/* pad mapping: y = 0 is the top row, and the 32 notes are exactly 68..99 */
{
    const notes = new Set();
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++) notes.add(padNote(x, y));
    check(notes.size === 32 && Math.min(...notes) === 68 && Math.max(...notes) === 99, "pad notes 68..99");
    check(padNote(0, 3) === 68 && padNote(7, 0) === 99, "bottom-left is 68, top-right is 99");
}

/* switching at 10 / 30 / 180 s, and the first animation is chosen at init */
for (const secs of [10, 30, 180]) {
    const h = makeHost({ dsp: `1,${secs},70,100,0` });
    const ui = createUi(h.api);
    ui.init();
    check(ui.anim >= 0 && ui.anim < 10, "first animation chosen");
    const start = h.t;
    check(ui.nextSwitchAt === start + secs * 1000, `${secs}s: first switch due at ${ui.nextSwitchAt - start}`);
    run(ui, h, 1);
    const before = ui.switches;
    run(ui, h, secs * 1000 - 200);
    check(ui.switches === before, `${secs}s: switched early`);
    run(ui, h, 300);
    check(ui.switches === before + 1, `${secs}s: did not switch on time`);
    check(ui.nextSwitchAt - start >= 2 * secs * 1000 && ui.nextSwitchAt - start < 2 * secs * 1000 + 30,
          `${secs}s: second switch due at ${ui.nextSwitchAt - start}`);
    run(ui, h, secs * 1000 * 3);
    check(ui.switches === before + 4, `${secs}s: ${ui.switches - before} switches over 4 intervals`);
}

/* RANDOM never shows the same animation twice in a row */
{
    const h = makeHost({ dsp: "1,10,70,100,0", seed: 3 });
    const ui = createUi(h.api);
    ui.init();
    let last = ui.anim, repeats = 0;
    for (let i = 0; i < 300; i++) { run(ui, h, 10000); if (ui.anim === last) repeats++; last = ui.anim; }
    check(repeats === 0, `random repeated ${repeats} times`);
}

/* SEQUENTIAL goes 1..10 */
{
    const h = makeHost({ dsp: "1,10,70,100,1" });
    const ui = createUi(h.api);
    ui.init();
    check(ui.anim === 0, "sequential starts at 01");
    for (let i = 1; i <= 12; i++) { run(ui, h, 10000); check(ui.anim === i % 10, `sequential #${i} -> ${ui.anim}`); }
}

/* INTERVAL change applies from the NEXT switch; the knob writes reach the DSP */
{
    const h = makeHost();
    const ui = createUi(h.api);
    ui.init();
    run(ui, h, 5000);
    const due = ui.nextSwitchAt;
    for (let i = 0; i < 30; i++) ui.onMidi(knob(2, 1));     /* 30 -> 60 */
    run(ui, h, 50);
    check(ui.state.interval === 60, `interval knob -> ${ui.state.interval}`);
    check(h.params.interval === "60", "interval written to DSP");
    check(ui.nextSwitchAt === due, "current timer untouched by knob");
    run(ui, h, due - h.t + 50);
    check(ui.nextSwitchAt - h.t > 59000, "next interval is the new 60 s");
    for (let i = 0; i < 400; i++) ui.onMidi(knob(2, 5));
    check(ui.state.interval === 180, "interval max 180");
    for (let i = 0; i < 400; i++) ui.onMidi(knob(2, -5));
    check(ui.state.interval === 10, "interval min 10");
    for (let i = 0; i < 5; i++) ui.onMidi(knob(3, -50));
    check(ui.state.brightness === 5, "brightness floor");
    ui.onMidi(knob(4, 3));
    check(ui.state.speed === 115, "speed steps by 5");
    ui.onMidi(knob(5, 1)); ui.onMidi(knob(5, 1)); ui.onMidi(knob(5, 1));
    check(ui.state.mode === 0, "mode needs 4 detents");
    ui.onMidi(knob(5, 1));
    check(ui.state.mode === 1, "mode -> sequential");
    run(ui, h, 50);
    check(h.params.mode === "sequential" && h.params.brightness === "5" && h.params.speed === "115", "all knobs written");
    const before = { ...ui.state };
    ui.onMidi(knob(1, 10));                                  /* knob 1 is unassigned */
    ui.onMidi([0x90, 0, 127]);
    check(JSON.stringify(ui.state) === JSON.stringify(before), "knob 1 does nothing");
}

/* LEDs: only pad notes, valid colours, unchanged pads not re-sent, crossfade happens */
{
    const h = makeHost({ dsp: "1,10,70,100,0" });
    const ui = createUi(h.api);
    ui.init();
    run(ui, h, 2000);
    check(h.block === 1, "pads blocked while shown");
    check(h.leds.every(([n, c]) => n >= PAD_FIRST && n <= PAD_LAST && c >= 0 && c <= 127), "LED notes/colours valid");
    const frames = 2000 / FRAME_MS;
    check(h.leds.length < frames * 32, `LED sends ${h.leds.length} < ${frames * 32} (changed only)`);
    for (let n = PAD_FIRST; n <= PAD_LAST; n++) check(n in h.ledState, `pad ${n} painted`);
    run(ui, h, 10000 - 2000 + 100);
    check(ui.fading, "crossfade after a switch");
    run(ui, h, FADE_MS + 100);
    check(!ui.fading, "crossfade ends");

    /* a dropped LED packet is retried */
    h.sendOk = false; run(ui, h, 500); h.sendOk = true;
    h.leds = []; run(ui, h, 100);
    const cols = ui.colors;
    for (let y = 0; y < 4; y++) for (let x = 0; x < 8; x++)
        check(h.ledState[padNote(x, y)] === cols[y * 8 + x], "LED state matches frame after drops");

    /* Move repainting a pad is painted over on the next frame */
    h.snapshot["70"] = 99;
    h.ledState[70] = 99;
    run(ui, h, 100);
    check(h.ledState[70] === ui.colors[(3 * 8) + 2], "Move repaint overwritten");
}

/* screen dismissed: Move's colours back, pad block released; reopened: resumes */
{
    const h = makeHost();
    const ui = createUi(h.api);
    ui.init();
    run(ui, h, 1000);
    h.display = false;
    h.leds = [];
    ui.tick();
    check(h.block === 0, "pad block released on dismiss");
    check(h.leds.length === 32 && h.leds.every(([n, c]) => h.snapshot[String(n)] === c), "Move's colours restored");
    h.leds = [];
    run(ui, h, 5000);
    check(h.leds.length === 0, "no LEDs while hidden");
    h.display = true;
    run(ui, h, 200);
    check(h.block === 1 && h.leds.length > 0, "resumes when shown again");

    /* Back: same hand-back, returns false so the host navigates */
    h.leds = [];
    check(ui.handleBack() === false, "handleBack lets the host navigate");
    check(h.block === 0 && h.leds.length === 32, "Back restores pads");
}

/* the DSP read failing (null) keeps defaults and is retried on show */
{
    const h = makeHost({ dsp: null });
    const ui = createUi(h.api);
    ui.init();
    check(ui.state.interval === 30 && ui.state.brightness === 70 && ui.state.speed === 100 && ui.state.mode === 0, "defaults");
    h.dsp = "1,99,40,200,1";
    h.display = false; ui.tick(); h.display = true; run(ui, h, 50);
    check(ui.state.interval === 99 && ui.state.mode === 1, "state read after a failed first read");
    const reads = h.reads;
    run(ui, h, 60000);
    check(h.reads === reads, "no param reads while running");
}

/* long run: no growth, still painting */
{
    const h = makeHost({ dsp: "1,10,100,300,0" });
    const ui = createUi(h.api);
    ui.init();
    run(ui, h, 30 * 60 * 1000);                 /* half an hour */
    h.leds = [];
    run(ui, h, 2000);
    check(h.leds.length > 0, "still painting after 30 min");
    check(ui.switches >= 179, `switches over 30 min: ${ui.switches}`);
}

if (failures) { console.error(`test_ui: ${failures} failure(s)`); process.exit(1); }
console.log("test_ui: OK");
