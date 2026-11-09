/*
 * PAD SCREENSAVER - RGB -> Move pad palette.
 *
 * Move's pads take a palette INDEX (0-127), not an RGB value. The animations
 * draw in RGB (0..1 per channel); this file finds the nearest palette entry.
 * The table is the one documented at the top of Schwung's
 * src/shared/constants.mjs. Results are cached on a 5-bit-per-channel grid,
 * which is also the quantisation that keeps unchanged pads from being re-sent.
 */

const HEX = [
    0x000000, 0xFF4032, 0x800400, 0xC93C00, 0xAC1F00, 0x8C5018, 0x491804, 0xFADC3B,
    0xFFC516, 0xB6FF0E, 0x79FF18, 0x34C216, 0x4F8A04, 0x62FF55, 0x297D53, 0x269E72,
    0x31ADFF, 0x3663FC, 0x1A34FF, 0x1C0CE6, 0x153999, 0x3937FF, 0x5722FF, 0x972BFF,
    0x852178, 0xFF1032, 0xFF2BD4, 0xA63421, 0x995628, 0x876700, 0x90821F, 0x4A8700,
    0x007F12, 0x1853B2, 0x624BAD, 0x733A67, 0xF8BCAF, 0xFF9B76, 0xFFBF5F, 0xD9AF71,
    0xFFF480, 0xBFBA69, 0xBCCC88, 0xAEFF99, 0x7CDD9F, 0x89B47D, 0x80F3FF, 0x7ACEFC,
    0x68A1D3, 0x858FC2, 0xBBAAF2, 0xCDBBE4, 0xEF8BB0, 0x859D8C, 0x6B756E, 0x84909B,
    0x6A7075, 0x88859D, 0x6C6A75, 0x9D859C, 0x746A74, 0x9C9D85, 0x74756A, 0x9D8484,
    0x756A6A, 0x661914, 0x210806, 0x460300, 0x280000, 0x5D1700, 0x200D00, 0x470C00,
    0x1C0800, 0x3B2B14, 0x1C130A, 0x250E05, 0x0D0602, 0x645817, 0x201C07, 0x664E08,
    0x211902, 0x486605, 0x172101, 0x306609, 0x0F2103, 0x144D08, 0x061902, 0x1F3701,
    0x0A1100, 0x276622, 0x0C210B, 0x143E29, 0x081910, 0x004D36, 0x00180E, 0x134566,
    0x061621, 0x152764, 0x070C20, 0x0A1466, 0x030621, 0x0B045C, 0x03011D, 0x0A1C4C,
    0x040B1E, 0x161666, 0x070721, 0x220D66, 0x0B0421, 0x3C1166, 0x130521, 0x350D30,
    0x11040F, 0x660614, 0x210206, 0x661154, 0x21051B, 0x000000, 0x595959, 0x1A1A1A,
    0xFFFFFF, 0x595959, 0xCCCCCC, 0x404040, 0x141414, 0x0000FF, 0x00FF00, 0xFF0000,
];
export const PALETTE_SIZE = HEX.length;   /* 128 */

/* Duplicates (117 = 0, 121 = 118) are never chosen; the first copy wins. */
const R = new Float32Array(128), G = new Float32Array(128), B = new Float32Array(128);
for (let i = 0; i < 128; i++) {
    R[i] = ((HEX[i] >> 16) & 255) / 255;
    G[i] = ((HEX[i] >> 8) & 255) / 255;
    B[i] = (HEX[i] & 255) / 255;
}
const CANDIDATES = [];
for (let i = 0; i < 128; i++) if (i !== 117 && i !== 121) CANDIDATES.push(i);

export function paletteRgb(i) { return [R[i], G[i], B[i]]; }

/* 5 bits per channel. Below ~1/32 of full a pad is simply off. */
export function quantize(r, g, b) {
    const q = (v) => (v <= 0 ? 0 : v >= 1 ? 31 : Math.round(v * 31));
    return (q(r) << 10) | (q(g) << 5) | q(b);
}

const cache = new Int16Array(32768).fill(-1);

function search(key) {
    const r = ((key >> 10) & 31) / 31, g = ((key >> 5) & 31) / 31, b = (key & 31) / 31;
    if (key === 0) return 0;
    let best = 0, bestD = Infinity;
    for (const i of CANDIDATES) {
        /* "redmean" weighted distance: cheap and close to perceptual */
        const rm = (r + R[i]) * 0.5;
        const dr = r - R[i], dg = g - G[i], db = b - B[i];
        const d = (2 + rm) * dr * dr + 4 * dg * dg + (3 - rm) * db * db;
        if (d < bestD) { bestD = d; best = i; }
    }
    return best;
}

/* Quantised key -> palette index, cached. */
export function nearestByKey(key) {
    let v = cache[key];
    if (v < 0) { v = search(key); cache[key] = v; }
    return v;
}

export function nearest(r, g, b) { return nearestByKey(quantize(r, g, b)); }
