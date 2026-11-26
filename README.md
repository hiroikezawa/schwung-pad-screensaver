# PAD SCREENSAVER

**English** | [日本語](README.ja.md)

A **visual-only MIDI FX** for Schwung on Ableton Move. Put it in a chain's
MIDI FX slot, and while this module's screen is open it shows 10 kinds of
animation on the 32 pads (8 columns × 4 rows). The animation changes at a set
interval.

It does not touch MIDI at all. Every incoming message passes straight on to
the next stage (the synth), and the module never sends sound, notes or CCs of
its own. It is independent of BPM and the transport and runs while playback is
stopped.

## When it is shown

- Only while this module's Schwung screen is open.
- Close the screen (Back, Menu, going back to a track) and the pad colours
  return to Move's own display, and the pads return to Move's normal operation.
- While the screen is open the pads are display-only. Pressing them makes no
  sound (the pads are held through Schwung's `host_pad_block`).

Because of how Schwung works, a chain MIDI FX can draw the pad LEDs only while
its own screen is open. So it is not a screensaver in the usual sense that
starts by itself when Move's normal screen has been idle.

## Knobs

| Knob | Name | What it does | Default |
|---|---|---|---|
| 1 | — | Not assigned | — |
| 2 | INTERVAL | Seconds each animation is shown. 10–180 s in 1 s steps. A change takes effect from the next switch | 30 s |
| 3 | BRIGHTNESS | Pad brightness 5–100 % | 70 % |
| 4 | SPEED | Animation speed 25–300 % (5 % steps) | 100 % |
| 5 | MODE | RANDOM (never the same one twice in a row) / SEQUENTIAL (1→10 in order) | RANDOM |

While a knob is touched, its value (seconds for INTERVAL) is shown large on the
screen. The four settings are saved as the slot's state and come back when the
set is reopened. To switch the effect on and off, use Schwung's standard bypass
(Mute + jog click).

## Animations

| # | Name | What it is |
|---|---|---|
| 01 | PLASMA FLOW | A plasma of four sine waves on top of each other. The hue drifts slowly sideways |
| 02 | KNIGHT RIDER | A red dot sweeps left and right with a trail behind it. The middle two rows are a bright band |
| 03 | MATRIX RAIN | Green light falls from top to bottom, each column with its own timing and speed. The head is bright, almost white |
| 04 | FIRE | Heat rises from an invisible source below the bottom row and cools as it goes. Black → red → orange → yellow |
| 05 | WAVE INTERFERENCE | Interference of three waves. Blues, purples and cyans |
| 06 | DIGITAL GLITCH | A dark cyan signal with red, white and cyan blocks, row shifts and noise. Only one row is ever inverted (no full-screen flashing) |
| 07 | PARTICLE SNAKE | A snake of light 7 long. It turns at the walls and now and then changes course. The hue shifts little by little |
| 08 | COLOR GRADIENT | A rainbow gradient flowing sideways, each row slightly out of phase |
| 09 | CELLULAR AUTOMATA | Game of Life on 8×4 (a board that wraps top/bottom and left/right). When everything dies, stops or falls into a cycle, it seeds again. Dead cells leave an afterglow |
| 10 | DUAL SCANNER | A red band from the left and a blue band from the right cross in the middle; where they overlap the colours mix |

On a switch, the colours of the outgoing and incoming animations are blended
over 0.75 s. The first animation shown is also chosen according to MODE.

## About colour

Move's pads cannot show arbitrary RGB; they light with a colour picked from a
128-colour palette. The animations compute RGB internally and send the nearest
palette colour. Brightness changes and crossfades are therefore approximated
with the palette's darker colours. LEDs are sent only for pads whose colour
changed (one frame every 40 ms, 25 FPS).

## How it works

- `dsp/pad_screensaver.c`: a DSP that only passes MIDI through. It holds the
  four settings and saves/restores them as `state`. It returns an empty string
  for `ui_hierarchy`, so Schwung opens `ui_chain.js` instead of the standard
  knob screen.
- `ui_core.mjs`: the screen, knobs, the switching timer and sending the LEDs.
- `anims.mjs`: the 10 animations (pure computation that runs without hardware).
- `palette.mjs`: conversion from RGB to the pads' palette index.

The animations run in Schwung's screen process, not in audio processing (the
SPI callback).

## Building and testing

```bash
scripts/test.sh                  # DSP tests (ASan/UBSan), animation and UI tests, Move build
scripts/build.sh arm64           # makes dist/pad-screensaver-module.tar.gz
scripts/install.py http://<Move's IP>:7700   # install through Schwung Manager
```

After installing, restart Move, then choose **Pad Screensaver** in the MIDI FX
list.

## Licence

MIT (`LICENSE`). For the bundled third-party code see `THIRD_PARTY_LICENSES.md`.
