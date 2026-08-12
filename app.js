/**
 * app.js — GitHub Profile Pet main application.
 */
(function () {
  "use strict";

  const GH = window.GitHubPet.github;
  const Dragon = window.GitHubPet.Dragon;

  const LS_SETTINGS = "ghpet_settings_v1";
  const LS_DATA = "ghpet_data_v1";

  const LEVELS = ["EGG", "HATCHLING", "BABY", "CHILD", "TEEN", "YOUNG", "ADULT", "VETERAN", "ANCIENT", "LEGENDARY"];
  const XP_CURVE = [0, 100, 260, 500, 850, 1300, 1900, 2700, 3800, 5200]; // cumulative per level index
  const HEAT_COLORS = ["#141128", "#2e2a5e", "#5b3fa8", "#8b5cf6", "#d8b4fe"];

  const SPEECH = {
    content: ["PUSH SOME CODE!", "CHECK UR GRAPH...", "I'M WATCHING UR COMMITS", "TYPE FASTER, DEV", "COMMITS = SNACKS. YUM."],
    hungry: ["FEED ME, DEV.", "I CRAVE COMMITS.", "MY BELLY RUNS ON PUSHES", "SO... HUNGRY..."],
    sleepy: ["Zzz... SHIP IT TOMORROW...", "NIGHT MODE: ON", "Zzz... MORE STARS...", "SLEEPY... NEED NAP..."],
    happy: ["UR STREAK IS FIRE!", "STARS!! I LOVE STARS!!", "WOW. GREAT GRAPH.", "THIS PROFILE SLAPS!"],
    excited: ["LEVEL UP!! WOW!!", "STREAK x7!! LEGENDARY!!", "I'M BREATHING FIRE!!", "BOOSTED. MOOD. ENGAGED."],
    sleeping: ["Zzz... Zzz...", "Zzz... MORE COMMITS...", "Zzz... SHIP IT..."],
    pet: ["HEHE. YES.", "MORE PETS, MORE POWER.", "*PURR* I MEAN... *ROAR*"],
  };

  /* ---------- tiny helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = (n) => String(n).padStart(2, "0");
  const nowStr = () => { const d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds()); };

  const levelForXp = (xp) => {
    let lv = 1;
    for (let i = 0; i < XP_CURVE.length; i++) if (xp >= XP_CURVE[i]) lv = i + 1;
    return Math.min(lv, XP_CURVE.length);
  };

  /* ---------- state ---------- */
  const state = {
    settings: { petName: "SPARKY", login: "sargaprasadrs", token: "" },
    mode: "none", // proxy | browser | demo | none
    proxyHasToken: false,
    data: null, // { profile, stats, isDemo, fetchedAt }
    pet: {
      energy: 60, happiness: 60, fullness: 60,
      xp: 0, level: 1, sleeping: false, mood: "content",
    },
    lastSeen: Date.now(),
    speechTimer: 0,
    fireTimer: 0,
    loading: false,
  };

  let dragon = null;
  let lastFrame = performance.now();
  let clockTimer = null;

  /* ---------- sound (tiny WebAudio beeps) ---------- */
  const Sound = {
    ctx: null, on: false,
    init() {
      if (!this.ctx) {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { /* no audio */ }
      }
      if (this.ctx && this.ctx.state === "suspended") this.ctx.resume();
    },
    blip(freq, dur = 0.07, type = "square", vol = 0.05) {
      if (!this.on || !this.ctx) return;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
      osc.connect(gain).connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + dur);
    },
    click() { this.blip(520, 0.04); },
    feed() { this.blip(300, 0.09, "square", 0.06); setTimeout(() => this.blip(180, 0.1, "square", 0.05), 90); },
    play() { [420, 560, 700].forEach((f, i) => setTimeout(() => this.blip(f, 0.06), i * 70)); },
    levelup() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this.blip(f, 0.12, "triangle", 0.07), i * 110)); },
    sleep() { this.blip(220, 0.3, "sine", 0.05); },
  };

  /* ---------- localStorage ---------- */
  function persistSettings() {
    try { localStorage.setItem(LS_SETTINGS, JSON.stringify(state.settings)); } catch (e) {}
  }
  function loadSettings() {
    try {
      const raw = localStorage.getItem(LS_SETTINGS);
      if (raw) Object.assign(state.settings, JSON.parse(raw));
    } catch (e) {}
  }
  function saveCache() {
    try { if (state.data) localStorage.setItem(LS_DATA, JSON.stringify(state.data)); } catch (e) {}
  }
  function loadCache() {
    try {
      const raw = localStorage.getItem(LS_DATA);
      if (raw) { state.data = JSON.parse(raw); return true; }
    } catch (e) {}
    return false;
  }
  function savePetState() {
    const s = { pet: state.pet, lastSeen: Date.now() };
    try { localStorage.setItem("ghpet_pet_v1", JSON.stringify(s)); } catch (e) {}
  }
  function loadPetState() {
    try {
      const raw = localStorage.getItem("ghpet_pet_v1");
      if (!raw) return;
      const s = JSON.parse(raw);
      // decay while away (per hour: eng -2.2, hap -1.1, ful -3.4; asleep regens eng)
      const hours = Math.min(72, (Date.now() - (s.lastSeen || Date.now())) / 3600000);
      s.pet.energy = clamp(s.pet.energy - 2.2 * hours, 5, 100);
      s.pet.happiness = clamp(s.pet.happiness - 1.1 * hours, 5, 100);
      s.pet.fullness = clamp(s.pet.fullness - 3.4 * hours, 5, 100);
      s.pet.sleeping = false; // don't boot the pet asleep
      state.pet = s.pet;
      state.pet.mood = "content";
    } catch (e) {}
  }

  /* ---------- logging ---------- */
  const logEl = $("log");
  function log(msg, cls) {
    const span = document.createElement("span");
    span.className = cls || "";
    span.textContent = "[" + nowStr() + "] " + msg;
    logEl.appendChild(span);
    while (logEl.children.length > 40) logEl.removeChild(logEl.firstChild);
    logEl.scrollLeft = logEl.scrollWidth;
  }

  /* ---------- LEDs ---------- */
  function setLed(el, cls, label) {
    el.className = "led" + (cls ? " " + cls : "");
    el.innerHTML = "<i></i>" + (label || el.dataset.label || "");
  }

  /* ---------- pet simulation ---------- */
  function levelNames(lv) { return "L" + lv + " · " + LEVELS[lv - 1]; }

  function computeMood() {
    const p = state.pet;
    if (p.sleeping) return "sleeping";
    if (p.fullness < 25) return "hungry";
    if (p.energy < 20) return "sleepy";
    if (state.data && state.data.stats.currentStreak >= 7) return "excited";
    if (p.happiness >= 70) return "happy";
    return "content";
  }

  function say(mood) {
    const lines = SPEECH[mood] || SPEECH.content;
    const el = $("speech");
    el.style.animation = "none";
    void el.offsetWidth;
    el.style.animation = "";
    el.textContent = lines[Math.floor(Math.random() * lines.length)];
  }

  function tick(dt) {
    const p = state.pet;
    // decay per second (rates are per hour -> /3600)
    const hours = dt / 3600;
    p.energy = clamp(p.energy + (p.sleeping ? 6 : -2.2) * hours, 0, 100);
    p.happiness = clamp(p.happiness + (p.sleeping ? -0.5 : -1.1) * hours, 0, 100);
    p.fullness = clamp(p.fullness + (p.sleeping ? -5 : -3.4) * hours, 0, 100);

    p.mood = computeMood();
    state.speechTimer -= dt;
    if (state.speechTimer <= 0) {
      say(p.mood);
      state.speechTimer = 7 + Math.random() * 6;
    }

    // sleep anim
    if (p.sleeping) {
      dragon.playSleep();
      if (Math.random() < 0.02) dragon.spawn("zzz", 1, { fromTop: 20 });
    } else {
      dragon.wake();
    }
    // excited fire-breathing
    state.fireTimer -= dt;
    if (p.mood === "excited" && state.fireTimer <= 0) {
      dragon.spawn("fire", 3);
      state.fireTimer = 4 + Math.random() * 2;
    }

    updateHUD();
  }

  function updateHUD() {
    const p = state.pet;
    $("bar-energy").style.width = p.energy + "%";
    $("bar-happiness").style.width = p.happiness + "%";
    $("bar-fullness").style.width = p.fullness + "%";
    $("num-energy").textContent = Math.round(p.energy);
    $("num-happiness").textContent = Math.round(p.happiness);
    $("num-fullness").textContent = Math.round(p.fullness);
    const xpNeed = XP_CURVE[Math.min(p.level, XP_CURVE.length - 1)];
    const xpNext = p.level < XP_CURVE.length ? XP_CURVE[p.level] : xpNeed;
    const prog = clamp((p.xp - xpNeed) / Math.max(1, xpNext - xpNeed), 0, 1) * 100;
    $("bar-xp").style.width = prog + "%";
    $("num-xp").textContent = p.xp;
    $("level-badge").textContent = levelNames(p.level);
  }

  /* ---------- GitHub data ---------- */
  async function refreshData() {
    if (state.loading) return;
    state.loading = true;
    $("btn-refresh").disabled = true;
    $("btn-refresh").textContent = "FETCH...";
    log("FETCHING GITHUB GRAPHQL DATA...", "warn");

    try {
      let result;
      if (state.mode === "demo") {
        result = GH.demoProfile();
        log("DEMO MODE — SAMPLE DATA LOADED", "warn");
      } else if (state.mode === "proxy") {
        if (!state.proxyHasToken) throw { code: "NO_TOKEN", message: "Put GITHUB_TOKEN in .env and restart server.mjs (or use a browser token in Settings)." };
        result = await GH.fetchProfile(state.settings.login, { mode: "proxy" });
        log("GRAPHQL OK VIA PROXY (" + state.settings.login + ")", "ok");
      } else {
        result = await GH.fetchProfile(state.settings.login, { mode: "browser", token: state.settings.token });
        log("GRAPHQL OK VIA BROWSER TOKEN (" + state.settings.login + ")", "ok");
      }

      result.isDemo = state.mode === "demo";
      result.fetchedAt = Date.now();
      state.data = result;
      saveCache();
      setLed($("led-api"), "ok", "API");
      applyGitHubStats(result);
      renderDashboard(result);
      savePetState();
    } catch (err) {
      const code = err && err.code;
      // NO_TOKEN is a normal guided setup state, not a real error
      if (code !== "NO_TOKEN") console.error(err);
      setLed($("led-api"), "err", "API");
      if (code === "BAD_TOKEN") {
        log("AUTH FAILED — BAD TOKEN (see Settings)", "err");
        say("content");
      } else if (code === "NOT_FOUND") {
        log("USER NOT FOUND: @" + state.settings.login, "err");
      } else      if (code === "NO_TOKEN") {
        log("PROXY HAS NO TOKEN — add .env or use browser token", "err");
        if (!state.data) showSetup();
      } else {
        log("GRAPHQL ERROR: " + (err.message || err), "err");
      }
    } finally {
      state.loading = false;
      $("btn-refresh").disabled = false;
      $("btn-refresh").textContent = "DATA";
    }
  }

  function applyGitHubStats(data) {
    const s = data.stats;
    const p = state.pet;
    const compEnergy = clamp(35 + s.last7 * 3.2, 0, 100);
    const compHappy = clamp(40 + Math.min(s.followers, 50) * 0.4 + Math.min(s.stars, 80) * 0.35 + s.currentStreak * 3, 0, 100);
    const compFull = clamp(55 + s.today * 4, 0, 100);
    p.energy = Math.max(p.energy, compEnergy);
    p.happiness = Math.max(p.happiness, compHappy);
    p.fullness = Math.max(p.fullness, compFull);

    const xp = s.totalContrib + s.stars * 10 + s.followers * 10 + s.reviews * 5 + s.issues * 3;
    if (xp > p.xp) {
      const oldLevel = p.level;
      p.xp = xp;
      const newLevel = levelForXp(xp);
      p.level = newLevel;
      dragon.setLevel(newLevel);
      if (newLevel > oldLevel) levelUp(oldLevel, newLevel);
    } else {
      // sync level even if pet state was reset (e.g. cache present, pet state cleared)
      const lv = levelForXp(p.xp);
      if (lv !== p.level) { p.level = lv; dragon.setLevel(lv); }
    }
    p.mood = computeMood();
    updateHUD();
    savePetState();
  }

  function levelUp(oldLv, newLv) {
    log("LEVEL UP! " + levelNames(oldLv) + " > " + levelNames(newLv), "ok");
    dragon.playLevelUp();
    Sound.levelup();
    $("banner-sub").textContent = levelNames(newLv) + " · " + state.settings.petName + " GREW!";
    const b = $("banner");
    b.hidden = false;
    setTimeout(() => { b.hidden = true; }, 3200);
    say("excited");
  }

  /* ---------- dashboard ---------- */
  function renderDashboard(data) {
    const { profile, stats } = data;
    const fmtN = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, "") + "K" : String(n));

    if (profile.avatarUrl) $("avatar").src = profile.avatarUrl;
    $("profile-name").textContent = profile.name;
    $("profile-login").textContent = "@" + profile.login + (data.isDemo ? " · DEMO" : "");
    $("profile-login").href = profile.url || "https://github.com/" + profile.login;
    $("profile-bio").textContent = profile.bio || "—";

    $("chip-contrib").textContent = fmtN(stats.totalContrib);
    $("chip-streak").textContent = stats.currentStreak + "D";
    $("chip-stars").textContent = fmtN(stats.stars);
    $("chip-repos").textContent = fmtN(stats.repos);
    $("chip-followers").textContent = fmtN(stats.followers);
    const lang = stats.topLangs[0];
    $("chip-langs").textContent = lang ? lang.name : "—";
    $("chip-langs").title = stats.topLangs.map((l) => l.name + " (" + l.repos + ")").join("\n");

    $("heat-total").textContent = fmtN(stats.totalContrib);
    drawHeatmap(stats.weeks);

    const list = $("repo-list");
    list.innerHTML = "";
    if (!stats.recentRepos.length) {
      const li = document.createElement("li");
      li.className = "dim";
      li.textContent = "NO PUBLIC REPOS";
      list.appendChild(li);
    } else {
      for (const r of stats.recentRepos) {
        const li = document.createElement("li");
        const name = document.createElement("span");
        name.className = "repo-name";
        name.textContent = r.name;
        const langEl = document.createElement("span");
        langEl.className = "repo-lang";
        langEl.textContent = r.lang || "";
        const stars = document.createElement("span");
        stars.className = "repo-stars";
        stars.textContent = "S" + (r.stars || 0);
        li.append(name, langEl, stars);
        list.appendChild(li);
      }
    }
    log("DASHBOARD UPDATED — " + stats.totalContrib + " TOTAL CONTRIBUTIONS", "ok");
  }

  function drawHeatmap(weeks) {
    const canvas = $("heatmap");
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const n = weeks.length;
    if (!n) return;
    const cell = 16, gap = 2;
    const totalW = n * (cell + gap) - gap;
    const totalH = 7 * (cell + gap) - gap;
    const ox = Math.floor((canvas.width - totalW) / 2);
    const oy = Math.floor((canvas.height - totalH) / 2);
    for (let w = 0; w < n; w++) {
      const week = weeks[w];
      for (let d = 0; d < 7; d++) {
        const day = week[d];
        if (!day) continue;
        ctx.fillStyle = HEAT_COLORS[clamp(day.level || 0, 0, 4)];
        ctx.fillRect(ox + w * (cell + gap), oy + d * (cell + gap), cell, cell);
      }
    }
  }

  /* ---------- interactions ---------- */
  function feed() {
    Sound.init(); Sound.feed();
    const p = state.pet;
    p.fullness = clamp(p.fullness + 28, 0, 100);
    p.energy = clamp(p.energy + 12, 0, 100);
    p.sleeping = false;
    dragon.playEat();
    log("FED " + state.settings.petName + " — YUM.", "ok");
    say("content");
    updateHUD(); savePetState();
  }
  function play() {
    Sound.init(); Sound.play();
    const p = state.pet;
    p.happiness = clamp(p.happiness + 22, 0, 100);
    p.energy = clamp(p.energy - 5, 0, 100);
    p.sleeping = false;
    dragon.playDance();
    dragon.spawn("spark", 8);
    log("PLAYED WITH " + state.settings.petName + ".", "ok");
    updateHUD(); savePetState();
  }
  function toggleSleep() {
    Sound.init();
    const p = state.pet;
    p.sleeping = !p.sleeping;
    if (p.sleeping) { dragon.playSleep(); Sound.sleep(); log(state.settings.petName + " WENT TO SLEEP. Zzz...", "warn"); say("sleeping"); }
    else { dragon.wake(); Sound.click(); log(state.settings.petName + " WOKE UP!", "ok"); say("content"); }
    updateHUD(); savePetState();
  }
  function petDragon() {
    Sound.init(); Sound.click();
    const p = state.pet;
    p.happiness = clamp(p.happiness + 5, 0, 100);
    if (p.sleeping) { p.sleeping = false; dragon.wake(); }
    dragon.pet();
    say("pet");
    updateHUD(); savePetState();
  }

  /* ---------- modals ---------- */
  function showSetup() {
    $("setup-overlay").hidden = false;
    $("setup-login").value = state.settings.login;
  }
  function hideSetup() { $("setup-overlay").hidden = true; }

  function openSettings() {
    $("set-name").value = state.settings.petName;
    $("set-login").value = state.settings.login;
    $("set-token").value = state.settings.token;
    const st = $("settings-status");
    st.textContent = state.mode === "demo"
      ? "MODE: DEMO — connect to go live"
      : "MODE: " + state.mode.toUpperCase() + (state.mode === "proxy" && !state.proxyHasToken ? " (NO TOKEN IN .env)" : "");
    $("settings-modal").hidden = false;
  }
  function saveSettings() {
    state.settings.petName = $("set-name").value.trim() || "SPARKY";
    state.settings.login = $("set-login").value.trim() || state.settings.login;
    state.settings.token = $("set-token").value.trim();
    persistSettings();
    $("pet-name").textContent = state.settings.petName;
    hideSettings();
    log("SETTINGS SAVED — CONNECTING AS @" + state.settings.login, "warn");
    resolveMode().then((mode) => { if (mode !== "none") refreshData(); else showSetup(); });
  }
  function hideSettings() { $("settings-modal").hidden = true; }

  /* ---------- mode resolution ---------- */
  async function detectProxy() {
    try {
      const r = await fetch("/graphql", { method: "GET" });
      if (!r.ok) return null;
      const j = await r.json();
      if (j.mode === "proxy") { state.proxyHasToken = !!j.hasToken; return "proxy"; }
      return null;
    } catch (e) { return null; }
  }

  async function resolveMode() {
    const proxy = await detectProxy();
    if (proxy && state.proxyHasToken) {
      state.mode = "proxy";
      setLed($("led-mode"), "ok", "PROXY");
    } else if (state.settings.token) {
      state.mode = "browser";
      setLed($("led-mode"), "warn", "TOKEN");
    } else if (proxy) {
      // proxy exists but has no token yet — keep proxy so the error path can guide the user
      state.mode = "proxy";
      setLed($("led-mode"), "warn", "PROXY");
    } else if (state.data && !state.data.isDemo) {
      state.mode = "none";
      setLed($("led-mode"), "err", "OFF");
    } else {
      state.mode = "demo";
      setLed($("led-mode"), "warn", "DEMO");
    }
    return state.mode;
  }

  /* ---------- setup overlay wiring ---------- */
  function wireSetup() {
    $("btn-connect").addEventListener("click", () => {
      Sound.init(); Sound.click();
      $("setup-form").hidden = false;
    });
    $("btn-connect-go").addEventListener("click", async () => {
      Sound.init(); Sound.click();
      state.settings.login = $("setup-login").value.trim() || state.settings.login;
      const token = $("setup-token").value.trim();
      if (token) state.settings.token = token;
      persistSettings();
      hideSetup();
      await resolveMode();
      if (state.mode === "none") {
        log("NEED A TOKEN — use proxy (.env) or paste one in Settings", "err");
        showSetup();
        return;
      }
      refreshData();
    });
    $("btn-demo").addEventListener("click", async () => {
      Sound.init(); Sound.click();
      state.mode = "demo";
      hideSetup();
      setLed($("led-mode"), "warn", "DEMO");
      log("DEMO MODE ENGAGED — sample data only", "warn");
      await refreshData();
    });
  }

  /* ---------- main ---------- */
  function startClock() {
    clockTimer = setInterval(() => {
      $("clock").textContent = nowStr();
    }, 1000);
  }

  function animate(now) {
    const dt = Math.min(0.05, (now - lastFrame) / 1000);
    lastFrame = now;
    dragon.update(dt);
    dragon.render();
    requestAnimationFrame(animate);
  }

  async function boot() {
    log("SYSTEM BOOT OK — GITHUB PET v1.0", "ok");

    loadSettings();
    loadPetState();
    const haveCache = loadCache();

    $("pet-name").textContent = state.settings.petName;
    dragon = new Dragon($("pet-canvas"));
    dragon.setLevel(state.pet.level);
    dragon.update(0);
    dragon.render();

    updateHUD();

    // wire buttons
    $("btn-feed").addEventListener("click", feed);
    $("btn-play").addEventListener("click", play);
    $("btn-sleep").addEventListener("click", toggleSleep);
    $("btn-refresh").addEventListener("click", refreshData);
    $("pet-canvas").addEventListener("click", petDragon);
    $("btn-settings").addEventListener("click", () => { Sound.init(); openSettings(); });
    $("btn-save").addEventListener("click", saveSettings);
    $("btn-close").addEventListener("click", hideSettings);
    $("btn-sound").addEventListener("click", () => {
      Sound.init();
      Sound.on = !Sound.on;
      $("btn-sound").textContent = "SND";
      $("btn-sound").classList.toggle("on", Sound.on);
      log("SOUND " + (Sound.on ? "ON" : "OFF"), "warn");
      if (Sound.on) Sound.click();
    });
    wireSetup();

    // cached data - immediate dashboard
    if (haveCache && state.data) {
      renderDashboard(state.data);
      applyGitHubStats(state.data);
      setLed($("led-api"), "warn", "API");
    }

    const mode = await resolveMode();
    log("AUTH MODE: " + mode.toUpperCase(), mode === "none" ? "err" : "ok");

    if (mode === "none") {
      if (!haveCache) showSetup();
      else log("OFFLINE — using cached data. Connect in Settings.", "warn");
    } else if (mode === "demo" && !haveCache) {
      // no credentials anywhere: show the connect screen so the user knows they can go live
      showSetup();
      refreshData(); // demo data loads behind the overlay — pet is alive instantly
    } else {
      refreshData();
    }

    startClock();
    requestAnimationFrame(animate);
    setInterval(() => { tick(1); savePetState(); }, 1000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
