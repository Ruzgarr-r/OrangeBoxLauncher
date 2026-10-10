'use strict';

/* ------------------------------------------------------------------ *
 * Config / constants
 * ------------------------------------------------------------------ */

const ASSETS = '../assets/';
const POSTER_EXTENSIONS = ['jpg', 'png', 'webp'];

// Prompt icon shown under the selected game, depending on the last input device.
const KEY_ICON = {
  keyboard: `${ASSETS}key/enter.png`,
  playstation: `${ASSETS}key/x.png`,
  xbox: `${ASSETS}key/a.png`,
};

const DEFAULTS = {
  backgroundDelayMs: 2000,
  backgroundFadeMs: 1200,
  trailerDelayMs: 0,
  trailerFadeMs: 600,
  backgroundVolume: 0,
  trailerVolume: 0,
};

// Standard Gamepad mapping: 0 = bottom face button (A on Xbox, X/Cross on PlayStation).
const PAD_CONFIRM = 0;
const PAD_DPAD_LEFT = 14;
const PAD_DPAD_RIGHT = 15;
const STICK_THRESHOLD = 0.55;
const REPEAT_FIRST_MS = 380;
const REPEAT_NEXT_MS = 160;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const bg = document.getElementById('bg');
const dim = document.getElementById('dim');
const cardsEl = document.getElementById('cards');

let settings = { ...DEFAULTS };
const cards = []; // { game, root, video, promptImg, timer }
let selected = -1;
let inputMode = 'keyboard'; // 'keyboard' | 'playstation' | 'xbox'

let bgGameId = null;
let bgToken = 0;
let bgTimer = null;
let launchLocked = false;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));

function el(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

/* ------------------------------------------------------------------ *
 * Building the buttons
 * ------------------------------------------------------------------ */

// Tries ./assets/<id>.jpg, then .png, then .webp.
function loadPoster(img, id) {
  let attempt = 0;
  const tryNext = () => {
    if (attempt < POSTER_EXTENSIONS.length) {
      img.src = `${ASSETS}${id}.${POSTER_EXTENSIONS[attempt++]}`;
    } else {
      img.removeEventListener('error', tryNext);
    }
  };
  img.addEventListener('error', tryNext);
  tryNext();
}

function buildCard(game, index) {
  const root = el('div', 'card', cardsEl);
  root.setAttribute('role', 'option');
  root.setAttribute('aria-label', game.name);

  const media = el('div', 'media', root);

  const poster = el('img', 'poster', media);
  poster.alt = '';
  poster.draggable = false;
  loadPoster(poster, game.id);

  const video = el('video', 'trailer', media);
  video.src = `${ASSETS}trailers/${game.id}.mp4`;
  video.loop = true;
  video.playsInline = true;
  video.preload = 'metadata';
  video.volume = clamp01(settings.trailerVolume);
  video.muted = settings.trailerVolume <= 0;

  el('div', 'title', root).textContent = game.name;

  const prompt = el('div', 'prompt', root);
  const promptImg = el('img', 'key', prompt);
  promptImg.alt = '';
  promptImg.draggable = false;
  promptImg.src = KEY_ICON[inputMode];

  root.addEventListener('mouseenter', () => select(index));
  root.addEventListener('click', () => {
    select(index);
    launchSelected();
  });

  return { game, root, video, promptImg, timer: null };
}

/* ------------------------------------------------------------------ *
 * Selection
 * ------------------------------------------------------------------ */

function select(index, { instant = false } = {}) {
  if (index === selected || index < 0 || index >= cards.length) return;

  if (selected >= 0) {
    const previous = cards[selected];
    previous.root.classList.remove('selected');
    stopTrailer(previous);
  }

  selected = index;
  const card = cards[index];
  card.root.classList.add('selected');
  startTrailer(card);
  scheduleBackground(card.game, instant);
}

function move(step) {
  select(Math.min(cards.length - 1, Math.max(0, selected + step)));
}

/* ------------------------------------------------------------------ *
 * Trailer inside the button (poster <-> video cross-fade)
 * ------------------------------------------------------------------ */

function startTrailer(card) {
  clearTimeout(card.timer);
  card.timer = setTimeout(async () => {
    try {
      card.video.currentTime = 0;
      await card.video.play();
      if (cards[selected] === card) card.root.classList.add('trailer-on');
    } catch (err) {
      // Trailer missing or interrupted: the poster simply stays visible.
    }
  }, settings.trailerDelayMs);
}

function stopTrailer(card) {
  clearTimeout(card.timer);
  card.root.classList.remove('trailer-on');
  // Let the fade-out finish before pausing so the frame doesn't freeze mid-fade.
  card.timer = setTimeout(() => {
    card.video.pause();
    card.video.currentTime = 0;
  }, settings.trailerFadeMs + 50);
}

/* ------------------------------------------------------------------ *
 * Background video: wait -> fade to black -> swap video -> fade back in
 * ------------------------------------------------------------------ */

function scheduleBackground(game, instant) {
  clearTimeout(bgTimer);
  if (instant) {
    switchBackground(game, true);
    return;
  }
  bgTimer = setTimeout(() => switchBackground(game, false), settings.backgroundDelayMs);
}

function waitForBackground() {
  return new Promise((resolve) => {
    const timeout = setTimeout(finish, 4000); // never hang if the file is missing
    function finish() {
      clearTimeout(timeout);
      bg.removeEventListener('playing', finish);
      bg.removeEventListener('error', finish);
      resolve();
    }
    bg.addEventListener('playing', finish);
    bg.addEventListener('error', finish);
    bg.play().catch(finish);
  });
}

async function switchBackground(game, skipFadeOut) {
  const token = ++bgToken;

  if (bgGameId !== game.id) {
    if (!skipFadeOut) {
      dim.classList.add('on');
      await sleep(settings.backgroundFadeMs);
      if (token !== bgToken) return; // a newer switch took over
    }
    bgGameId = game.id;
    bg.src = `${ASSETS}${game.id}.mp4`;
    await waitForBackground();
    if (token !== bgToken) return;
  }

  dim.classList.remove('on');
}

/* ------------------------------------------------------------------ *
 * Launching
 * ------------------------------------------------------------------ */

function launchSelected() {
  const card = cards[selected];
  if (!card || launchLocked) return;

  launchLocked = true;
  card.root.classList.add('launching');
  setTimeout(() => {
    card.root.classList.remove('launching');
    launchLocked = false;
  }, 1500);

  window.launcher.launchGame(card.game.id);
}

/* ------------------------------------------------------------------ *
 * Input: keyboard, mouse (see buildCard) and gamepads
 * ------------------------------------------------------------------ */

function setInputMode(mode) {
  if (mode === inputMode) return;
  inputMode = mode;
  for (const card of cards) card.promptImg.src = KEY_ICON[mode];
}

function padFamily(pad) {
  const id = pad.id.toLowerCase();
  // Sony vendor id 054c covers DualShock 3 / 4 and DualSense.
  if (/054c|sony|playstation|dualshock|dualsense|sixaxis/.test(id)) return 'playstation';
  if (/045e|xbox|xinput|microsoft/.test(id)) return 'xbox';
  return 'xbox';
}

window.addEventListener('keydown', (event) => {
  switch (event.key) {
    case 'ArrowLeft':
      move(-1);
      break;
    case 'ArrowRight':
      move(1);
      break;
    case 'Enter':
      if (!event.repeat) launchSelected();
      break;
    default:
      return;
  }
  setInputMode('keyboard');
  event.preventDefault();
});

const padPrev = {}; // gamepad index -> { confirm, active }
let navDir = 0;
let navNext = 0;

function pollGamepads(now) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  let dir = 0;
  let dirFamily = inputMode;

  for (const pad of pads) {
    if (!pad || !pad.connected) continue;

    const family = padFamily(pad);
    const prev = padPrev[pad.index] || (padPrev[pad.index] = { confirm: false, active: false });
    const pressed = (i) => Boolean(pad.buttons[i] && pad.buttons[i].pressed);

    const confirm = pressed(PAD_CONFIRM);
    const axisX = pad.axes[0] || 0;
    let padDir = 0;
    if (pressed(PAD_DPAD_LEFT) || axisX < -STICK_THRESHOLD) padDir = -1;
    else if (pressed(PAD_DPAD_RIGHT) || axisX > STICK_THRESHOLD) padDir = 1;

    // Any fresh input from this pad switches the prompt icon (X for PlayStation, A for Xbox).
    const active = confirm || padDir !== 0 || Array.from(pad.buttons).some((b) => b.pressed);
    if (active && !prev.active) setInputMode(family);
    prev.active = active;

    if (confirm && !prev.confirm) launchSelected();
    prev.confirm = confirm;

    if (padDir !== 0) {
      dir = padDir;
      dirFamily = family;
    }
  }

  if (dir === 0) {
    navDir = 0;
  } else if (dir !== navDir) {
    navDir = dir;
    navNext = now + REPEAT_FIRST_MS;
    setInputMode(dirFamily);
    move(dir);
  } else if (now >= navNext) {
    navNext = now + REPEAT_NEXT_MS;
    move(dir);
  }

  requestAnimationFrame(pollGamepads);
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

async function init() {
  const config = await window.launcher.getConfig();
  settings = { ...DEFAULTS, ...config.settings };

  const rootStyle = document.documentElement.style;
  rootStyle.setProperty('--bg-fade', `${settings.backgroundFadeMs}ms`);
  rootStyle.setProperty('--trailer-fade', `${settings.trailerFadeMs}ms`);

  bg.volume = clamp01(settings.backgroundVolume);
  bg.muted = settings.backgroundVolume <= 0;

  config.games.forEach((game, index) => cards.push(buildCard(game, index)));

  // Half Life 2 (first game) is selected on start; its background starts without waiting.
  select(0, { instant: true });
  requestAnimationFrame(pollGamepads);
}

init();
