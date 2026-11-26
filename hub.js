// MOTION ARCADE HUB — Ambient 3D backdrop, high-score sync, and shared camera toggle

const KEYS = {
  slashBest: 'slash_high_score',
  swerveBest: 'swerve_high_score',
  strikeBest: 'strike_high_score',
  cameraFacing: 'swerve_camera_facing',
  cameraMirror: 'swerve_camera_mirror',
};

function readInt(key) {
  try {
    return Math.max(0, parseInt(localStorage.getItem(key) || '0', 10) || 0);
  } catch {
    return 0;
  }
}

function readStr(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStr(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore storage errors
  }
}

function initHubUI() {
  const slashBest = readInt(KEYS.slashBest);
  const swerveBest = readInt(KEYS.swerveBest);
  const strikeBest = readInt(KEYS.strikeBest);
  const totalBest = slashBest + swerveBest + strikeBest;

  const slashBadge = document.getElementById('badge-best-slash');
  const swerveBadge = document.getElementById('badge-best-swerve');
  const strikeBadge = document.getElementById('badge-best-strike');
  const totalPill = document.getElementById('total-score-pill');

  if (slashBadge) {
    slashBadge.textContent = slashBest > 0 ? `BEST ${slashBest.toLocaleString()}` : 'NEW';
  }
  if (swerveBadge) {
    swerveBadge.textContent = swerveBest > 0 ? `BEST ${swerveBest.toLocaleString()}` : 'NEW';
  }
  if (strikeBadge) {
    strikeBadge.textContent = strikeBest > 0 ? `BEST ${strikeBest.toLocaleString()}` : 'NEW';
  }
  if (totalPill) {
    totalPill.textContent = `TOTAL ${totalBest.toLocaleString()}`;
  }

  // Shared Front / Back camera toggle inherited by all arcade games
  const camBtns = Array.from(document.querySelectorAll('#hub-camera-toggle .cam-btn'));
  let facing = readStr(KEYS.cameraFacing, 'user') === 'environment' ? 'environment' : 'user';

  const syncCamUI = () => {
    camBtns.forEach((btn) => {
      const active = btn.dataset.facing === facing;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
  };

  camBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      facing = btn.dataset.facing === 'environment' ? 'environment' : 'user';
      writeStr(KEYS.cameraFacing, facing);
      writeStr(KEYS.cameraMirror, facing === 'user' ? '1' : '0');
      syncCamUI();
    });
  });

  syncCamUI();
}

function initAmbientBackdrop() {
  const canvas = document.getElementById('hub-bg-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let w = window.innerWidth;
  let h = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  const resize = () => {
    w = window.innerWidth;
    h = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  resize();
  window.addEventListener('resize', resize);

  const FOCAL = 0.32;
  const SPAWN_Z = 1.1;
  const streaks = Array.from({ length: 22 }, () => ({
    wx: (Math.random() < 0.5 ? -1 : 1) * (0.7 + Math.random() * 0.5),
    wy: -0.9 + Math.random() * 1.8,
    z: Math.random() * SPAWN_Z,
    speed: 0.25 + Math.random() * 0.28,
    cyan: Math.random() > 0.5,
  }));

  const project = (wx, wy, z) => {
    const s = FOCAL / Math.max(0.08, z + FOCAL);
    const vpX = w * 0.5;
    const vpY = h * 0.34;
    const nearW = Math.min(w, 860) * 1.1;
    const nearH = h * 0.85;
    return {
      x: vpX + wx * (nearW * 0.5) * s,
      y: vpY + (h * 0.56 - vpY + wy * (nearH * 0.5)) * s,
      s,
    };
  };

  let scroll = 0;
  let lastMs = performance.now();

  const frame = (nowMs) => {
    const dt = Math.min((nowMs - lastMs) / 1000, 0.05);
    lastMs = nowMs;
    scroll = (scroll + dt * 0.22) % 1;

    ctx.clearRect(0, 0, w, h);

    // Subtle 3D perspective floor grid
    const corners = [
      [-1, 1],
      [1, 1],
      [-0.36, 1],
      [0.36, 1],
    ];
    for (let i = 0; i < corners.length; i++) {
      const [wx, wy] = corners[i];
      const pFar = project(wx, wy, SPAWN_Z);
      const pNear = project(wx, wy, 0);
      ctx.strokeStyle = i < 2 ? 'rgba(200, 245, 59, 0.2)' : 'rgba(50, 230, 255, 0.1)';
      ctx.lineWidth = i < 2 ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(pFar.x, pFar.y);
      ctx.lineTo(pNear.x, pNear.y);
      ctx.stroke();
    }

    for (let i = 0; i < 6; i++) {
      const z = (((i / 6) - scroll + 1) % 1) * SPAWN_Z;
      const pL = project(-1, 1, z);
      const pR = project(1, 1, z);
      const a = Math.max(0.03, (1 - z / SPAWN_Z) * 0.16);
      ctx.strokeStyle = `rgba(200, 245, 59, ${a.toFixed(3)})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.stroke();
    }

    // Subtle ambient warp streaks
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';
    for (const st of streaks) {
      st.z -= dt * st.speed;
      if (st.z < -0.1) st.z = SPAWN_Z;
      const p1 = project(st.wx, st.wy, st.z);
      const p2 = project(st.wx, st.wy, Math.min(SPAWN_Z, st.z + 0.12));
      const a = Math.max(0.02, (1 - st.z / SPAWN_Z) * 0.42);
      ctx.strokeStyle = st.cyan ? `rgba(50, 230, 255, ${a.toFixed(3)})` : `rgba(200, 245, 59, ${a.toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 1.8 * p1.s);
      ctx.beginPath();
      ctx.moveTo(p2.x, p2.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.stroke();
    }
    ctx.restore();

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

window.addEventListener('DOMContentLoaded', () => {
  initHubUI();
  initAmbientBackdrop();
});
