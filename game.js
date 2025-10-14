// === Tuning knobs and visual constants ===============================
const CANVAS_WIDTH = 320;
const CANVAS_HEIGHT = 180;
const MAP_WIDTH = 640;
const MAP_HEIGHT = 480;
const PLAYER_SPEED = 110; // units per second
const ENEMY_SPEED = 70;
const DETECTION_RADIUS = 140;
const ENEMY_HP = 3;
const BONK_DAMAGE = 3; // single bonk defeats an enemy
const BONK_DURATION_MS = 180;
const BONK_ARC_DEG = 80;
const BONK_REACH = 34;
const LOOT_RADIUS = 6;
const LOOT_LIFETIME_MS = 6000;
const PLAYER_RADIUS = 10;
const ENEMY_RADIUS = 9;
const FLOOR_COLOR = "#1d2333";
const TILE_COLOR = "#262d40";
const PLAYER_COLOR = "#67ff8f";
const ENEMY_COLOR = "#ff6262";
const LOOT_COLOR = "#ffd966";
const BONK_COLOR = "rgba(255, 255, 255, 0.35)";

// === Helper utilities ================================================
function randRange(min, max) {
  return Math.random() * (max - min) + min;
}

// Track pressed keys so we can query them in update() without worrying
// about key repeat rates. Keys are stored as lowercase strings.
const keys = {};
window.addEventListener("keydown", (event) => {
  keys[event.key.toLowerCase()] = true;
  if (event.key.toLowerCase() === "j" && !bonk.active) {
    startBonk();
  }
});
window.addEventListener("keyup", (event) => {
  keys[event.key.toLowerCase()] = false;
});

// === Canvas setup =====================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
ctx.imageSmoothingEnabled = false;

// A tiny map made of rectangles gives us something to walk around.
const floorPatches = [
  { x: 80, y: 80, width: 200, height: 140 },
  { x: 300, y: 120, width: 220, height: 100 },
  { x: 160, y: 260, width: 260, height: 120 },
];

// === Entity state =====================================================
const player = {
  x: MAP_WIDTH / 2,
  y: MAP_HEIGHT / 2,
  radius: PLAYER_RADIUS,
  facingX: 1,
  facingY: 0,
  loot: 0,
};

let nextEnemyId = 1;
const enemies = [
  { id: nextEnemyId++, x: 140, y: 140, radius: ENEMY_RADIUS, hp: ENEMY_HP },
  { id: nextEnemyId++, x: 420, y: 320, radius: ENEMY_RADIUS, hp: ENEMY_HP },
  { id: nextEnemyId++, x: 260, y: 200, radius: ENEMY_RADIUS, hp: ENEMY_HP },
];

const lootOrbs = [];

const bonk = {
  active: false,
  timer: 0,
  hitEnemies: new Set(),
  dirX: 1,
  dirY: 0,
};

// === Core loop scaffolding ===========================================
let lastTime = performance.now();
requestAnimationFrame(loop);

function loop(now) {
  const dt = (now - lastTime) / 1000;
  lastTime = now;

  update(dt, now);
  draw(now);

  requestAnimationFrame(loop);
}

// === Update phase =====================================================
function update(dt, nowMs) {
  handleMovement(dt);
  updateBonk(dt);
  updateEnemies(dt);
  handleBonkHits();
  updateLoot(nowMs);
}

// Checkpoint 1: after loading the page, wiggle the player around.
// The green circle should follow WASD / arrow keys and stay inside the room.
function handleMovement(dt) {
  let moveX = 0;
  let moveY = 0;
  if (keys["w"] || keys["arrowup"]) moveY -= 1;
  if (keys["s"] || keys["arrowdown"]) moveY += 1;
  if (keys["a"] || keys["arrowleft"]) moveX -= 1;
  if (keys["d"] || keys["arrowright"]) moveX += 1;

  if (moveX !== 0 || moveY !== 0) {
    const length = Math.hypot(moveX, moveY);
    moveX /= length;
    moveY /= length;
    player.facingX = moveX;
    player.facingY = moveY;
  }

  player.x += moveX * PLAYER_SPEED * dt;
  player.y += moveY * PLAYER_SPEED * dt;

  // Clamp to simple room bounds instead of complicated collision.
  player.x = Math.max(player.radius, Math.min(MAP_WIDTH - player.radius, player.x));
  player.y = Math.max(player.radius, Math.min(MAP_HEIGHT - player.radius, player.y));
}

function updateBonk(dt) {
  if (!bonk.active) return;
  bonk.timer -= dt * 1000;
  if (bonk.timer <= 0) {
    bonk.active = false;
    bonk.hitEnemies.clear();
  }
}

function startBonk() {
  bonk.active = true;
  bonk.timer = BONK_DURATION_MS;
  bonk.hitEnemies.clear();
  const magnitude = Math.hypot(player.facingX, player.facingY) || 1;
  bonk.dirX = player.facingX / magnitude;
  bonk.dirY = player.facingY / magnitude;
}

// Checkpoint 2: move close to an enemy; it should start chasing once
// the distance drops below DETECTION_RADIUS.
function updateEnemies(dt) {
  for (const enemy of enemies) {
    const dx = player.x - enemy.x;
    const dy = player.y - enemy.y;
    const distance = Math.hypot(dx, dy);

    if (distance < DETECTION_RADIUS) {
      const dirX = dx / (distance || 1);
      const dirY = dy / (distance || 1);
      enemy.x += dirX * ENEMY_SPEED * dt;
      enemy.y += dirY * ENEMY_SPEED * dt;
    }

    enemy.x = Math.max(enemy.radius, Math.min(MAP_WIDTH - enemy.radius, enemy.x));
    enemy.y = Math.max(enemy.radius, Math.min(MAP_HEIGHT - enemy.radius, enemy.y));
  }
}

function handleBonkHits() {
  if (!bonk.active) return;

  const cosHalfArc = Math.cos((BONK_ARC_DEG * Math.PI) / 360);
  for (let i = enemies.length - 1; i >= 0; i--) {
    const enemy = enemies[i];
    if (bonk.hitEnemies.has(enemy.id)) continue;

    const dx = enemy.x - player.x;
    const dy = enemy.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance > BONK_REACH + enemy.radius) continue;

    const dot = (dx * bonk.dirX + dy * bonk.dirY) / (distance || 1);
    if (dot < cosHalfArc) continue;

    // Checkpoint 3: press J while facing an enemy to bonk it. The faint arc
    // should appear, the enemy flashes (via removal), and a loot orb pops out.
    enemy.hp -= BONK_DAMAGE;
    bonk.hitEnemies.add(enemy.id);
    if (enemy.hp <= 0) {
      spawnLoot(enemy.x, enemy.y);
      enemies.splice(i, 1);
    }
  }
}

function spawnLoot(x, y) {
  lootOrbs.push({
    x: x + randRange(-6, 6),
    y: y + randRange(-6, 6),
    radius: LOOT_RADIUS,
    expiresAt: performance.now() + LOOT_LIFETIME_MS,
  });
}

function updateLoot(nowMs) {
  for (let i = lootOrbs.length - 1; i >= 0; i--) {
    const orb = lootOrbs[i];

    if (nowMs > orb.expiresAt) {
      lootOrbs.splice(i, 1);
      continue;
    }

    const dx = orb.x - player.x;
    const dy = orb.y - player.y;
    const distance = Math.hypot(dx, dy);
    if (distance < orb.radius + player.radius) {
      lootOrbs.splice(i, 1);
      player.loot += 1;
    }
  }
}

// === Draw phase =======================================================
function draw(nowMs) {
  ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.fillStyle = FLOOR_COLOR;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  const offsetX = CANVAS_WIDTH / 2 - player.x;
  const offsetY = CANVAS_HEIGHT / 2 - player.y;

  drawMap(offsetX, offsetY);
  drawLoot(offsetX, offsetY, nowMs);
  drawEnemies(offsetX, offsetY);
  drawPlayer(offsetX, offsetY);
  drawHUD(nowMs);
}

function drawMap(offsetX, offsetY) {
  ctx.save();
  ctx.fillStyle = TILE_COLOR;
  for (const tile of floorPatches) {
    ctx.fillRect(
      Math.round(tile.x + offsetX),
      Math.round(tile.y + offsetY),
      tile.width,
      tile.height
    );
  }
  ctx.restore();

  // Draw map bounds for quick orientation.
  ctx.save();
  ctx.strokeStyle = "#3a3f5a";
  ctx.lineWidth = 2;
  ctx.strokeRect(
    Math.round(offsetX),
    Math.round(offsetY),
    MAP_WIDTH,
    MAP_HEIGHT
  );
  ctx.restore();
}

function drawLoot(offsetX, offsetY, nowMs) {
  ctx.save();
  for (const orb of lootOrbs) {
    const lifeLeft = (orb.expiresAt - nowMs) / LOOT_LIFETIME_MS;
    const alpha = Math.max(0.2, lifeLeft);
    ctx.fillStyle = `rgba(255, 217, 102, ${alpha.toFixed(2)})`;
    ctx.beginPath();
    ctx.arc(
      Math.round(orb.x + offsetX),
      Math.round(orb.y + offsetY),
      orb.radius,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawEnemies(offsetX, offsetY) {
  ctx.save();
  ctx.fillStyle = ENEMY_COLOR;
  for (const enemy of enemies) {
    ctx.beginPath();
    ctx.arc(
      Math.round(enemy.x + offsetX),
      Math.round(enemy.y + offsetY),
      enemy.radius,
      0,
      Math.PI * 2
    );
    ctx.fill();
  }
  ctx.restore();
}

function drawPlayer(offsetX, offsetY) {
  ctx.save();
  if (bonk.active) {
    ctx.strokeStyle = BONK_COLOR;
    ctx.lineWidth = 4;
    const angle = Math.atan2(bonk.dirY, bonk.dirX);
    const halfArc = (BONK_ARC_DEG * Math.PI) / 360;
    ctx.beginPath();
    ctx.arc(
      Math.round(player.x + offsetX),
      Math.round(player.y + offsetY),
      BONK_REACH,
      angle - halfArc,
      angle + halfArc
    );
    ctx.stroke();
  }

  ctx.fillStyle = PLAYER_COLOR;
  ctx.beginPath();
  ctx.arc(
    Math.round(player.x + offsetX),
    Math.round(player.y + offsetY),
    player.radius,
    0,
    Math.PI * 2
  );
  ctx.fill();
  ctx.restore();
}

function drawHUD(nowMs) {
  ctx.save();
  ctx.fillStyle = "#f2f5ff";
  ctx.font = "8px 'Press Start 2P', monospace";
  ctx.textBaseline = "top";
  ctx.fillText("Mega Bonk", 8, 6);
  ctx.fillText(`Loot: ${player.loot}`, 8, 18);
  ctx.fillText(`Enemies: ${enemies.length}`, 8, 30);
  if (bonk.active) {
    ctx.fillStyle = "#ffef99";
    ctx.fillText("BONK!", CANVAS_WIDTH - 60, 6);
  }
  ctx.restore();
}

// === Quick debug helpers =============================================
// Helpful for experimentation: spawn a new enemy on click.
canvas.addEventListener("click", (event) => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const mouseX = (event.clientX - rect.left) * scaleX;
  const mouseY = (event.clientY - rect.top) * scaleY;
  const worldX = mouseX - (CANVAS_WIDTH / 2 - player.x);
  const worldY = mouseY - (CANVAS_HEIGHT / 2 - player.y);

  enemies.push({
    id: nextEnemyId++,
    x: worldX,
    y: worldY,
    radius: ENEMY_RADIUS,
    hp: ENEMY_HP,
  });
});

// Checkpoint 4: wait 6 seconds near a loot orb without picking it up.
// It should fade slightly and disappear when LOOT_LIFETIME_MS elapses.
