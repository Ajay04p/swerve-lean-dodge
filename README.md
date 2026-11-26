# SWERVE — Camera Lean & Dodge

A zero-build, mobile-first phone-camera arcade game powered by **on-device MediaPipe Pose tracking**. Lean left, lean right, and duck underneath low beams using your front camera—or jump straight into Touch / Mouse / Keyboard Practice Mode.

**Play Live:** https://ajay04p.github.io/swerve-lean-dodge/

## Features

- **100% On-Device Pose Tracking:** Runs [MediaPipe Pose Landmarker Lite](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker) (`@mediapipe/tasks-vision`) directly in your browser via WebAssembly with automatic `GPU` → `CPU` delegate fallback. Video never leaves your device.
- **Cover-Fit Mirrored Alignment:** Horizontally mirrors the front camera feed (`facingMode: "user"`, `640×480` ideal, iOS Safari `playsinline` compatible) and projects upper-body pose landmarks with exact cover-fit math for any portrait phone screen.
- **Weighted Tracking & Calibration:** Tracks weighted Nose (`0`) + Mid-Shoulders (`11`, `12`) with frame-rate independent EMA smoothing. Includes a ~1.4s **Neutral Posture Calibration** step and one-tap **Recenter** button that auto-scales the duck threshold (with hysteresis) from your shoulder span for both standing and desk play.
- **Tactile Studio Arcade Gameplay:**
  - **4 Obstacle Patterns:** Left Wall, Right Wall, Center Pillar, and full-width **Low Beam** (turns tennis-volt green when you duck underneath).
  - **Telegraph & Scoring:** Top-edge hazard telegraph bars, collectible **Gold Rings** (`+50 × combo`), **Near-Miss** bonuses (`CLOSE!`), 3 shields with invulnerability blink, screen shake, particle bursts, and `localStorage` high score.
- **Practice Mode & Controls:** Full fallback with touch/mouse drag (drag low to duck) and keyboard (`←`/`→` or `A`/`D` to lean, `↓`/`S`/`Space` to duck, `P`/`Esc` to pause, `R` to recenter, `M` to mute).
- **Custom Settings:** Lean sensitivity (`Gentle` / `Normal` / `Wide`), toggleable pose skeleton & duck clearance line, camera brightness slider, pause menu, and mute toggle.
- **Zero-Asset Synthesized Audio:** Web Audio API synthesizer unlocked on first tap.

## Project Files

- `index.html` — Mobile-first viewport layout, mirrored camera layer, canvas stage, HUD, and overlays.
- `style.css` — High-contrast tactile studio arcade design tokens, safe-area insets (`100dvh`, `viewport-fit=cover`), and responsive controls.
- `tracker.js` — MediaPipe Pose Landmarker initialization (`GPU` → `CPU`), front camera stream, cover-fit landmark projection, EMA smoothing, calibration, and duck hysteresis.
- `game.js` — Game loop, obstacle waves, telegraphing, collision & near-miss detection, canvas rendering, and input/UI orchestration.
- `audio.js` — Web Audio API procedural sound effects engine.

## Local Development

No build step or package installation is needed. Serve the directory over localhost (or HTTPS for phone camera access):

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
