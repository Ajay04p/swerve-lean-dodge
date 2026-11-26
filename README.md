# MOTION ARCADE — Free On-Device Camera Games

A zero-build, zero-backend, mobile-first **free camera-motion arcade website** powered by **100% on-device MediaPipe Pose tracking**, custom 3D perspective VFX, and procedural Web Audio synthesis.

**Play Free Live:** https://ajay04p.github.io/swerve-lean-dodge/

## Playable Games

1. **SLASH (`games/slash/`)** — *Real Human Neon Hologram Laser-Blade Slicer*
   - Uses on-device MediaPipe Pose Segmentation (`outputSegmentationMasks: true`) to remove your room background and place your real live body inside a dark 3D neon dojo as a glowing cyber hologram (*Just Dance / Tron* aesthetic), with switchable **Hologram**, **Real Cutout**, and **Camera** visual modes.
   - Dual plasma blades trail your live hands to cleave flying 3D wireframe polyhedra cleanly in half along your exact blade angle, chain Multi-Slice Blitz combos (`2× SLICE!`, `3× BLITZ!`, `4× ULTRA!`), ignite **Golden Core FRENZY 2×**, and avoid pulsing Red Spike Mines.
   - Includes full Touch / Mouse swipe and Keyboard Practice Mode.
2. **SWERVE (`games/swerve/`)** — *3D Lean & Duck Tunnel*
   - Articulated 3D-grounded runner driven by your live lean, shoulder tilt, arms, and crouch.
   - 4 obstacle patterns (Left Wall, Right Wall, Center Pillar, overhead Plasma Laser Low Beam), collectible Gold Rings, Near-Miss (`CLOSE!`) bonuses, 4 dynamic color Zones, Fever Mode, and 3 shields.
3. **STRIKE (`games/strike/`)** — *3D Hand-Punch & Duck Arena*
   - Tracks your live screen-left (Cyan) and screen-right (Volt) hands as glowing energy gauntlets.
   - Punch rushing 3D crystals, chain `PERFECT!` and `DOUBLE SMASH!` combos, shatter Golden Power Cores, and duck underneath red overhead laser sweeps.
   - Includes full Touch / Mouse (tap & swipe) and Keyboard (`←`/`↑`/`→` punch, `↓`/`Space` duck) Practice Mode.

## Shared On-Device Engine

- **100% On-Device Privacy:** Runs MediaPipe Pose Landmarker Lite + Segmentation (`@mediapipe/tasks-vision`) locally via WebAssembly (`GPU` → `CPU` automatic fallback). Video never leaves your phone.
- **Front / Back Camera + Multi-Lens Picker:** Switch between Front (auto-mirrored) and Back (auto-unmirrored) cameras, or choose specific lenses (e.g., Wide / Ultra-Wide) in Settings. Preferences persist across all games.
- **Alignment-Gated Calibration:** Waits until head and shoulders are centered and steady for ~1.4s, auto-scaling duck thresholds with hysteresis for both desk and standing play.

## Repository Structure

```
├── index.html          # Motion Arcade Hub landing page
├── hub.css             # Arcade portal styling
├── hub.js              # Ambient 3D backdrop, high-score sync, shared camera toggle
├── shared/
│   ├── tracker.js      # Shared MediaPipe Pose + Segmentation Hologram + dual-hand tracking engine
│   ├── audio.js        # Shared Web Audio arcade synth & mobile haptics
│   └── arcade.css      # Shared mobile-first HUD, modals, and VFX styles
└── games/
    ├── slash/          # SLASH — Real Human Neon Hologram Laser-Blade Slicer
    ├── swerve/         # SWERVE — 3D Lean & Duck Tunnel
    └── strike/         # STRIKE — 3D Hand-Punch & Duck Arena
```

## Local Development

No build step required:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.
