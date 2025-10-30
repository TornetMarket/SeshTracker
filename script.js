/* =========================================================
   FocusUI — script.js
   Mobile-native ritual timer + sesh tracker (local-only)
   - Tabs: Timer / Sesh / Log / Facts / Settings
   - Presets with wax types
   - Countdown engine (start / pause / reset)
   - Solo dab logging + Sesh multi-user logging
   - Stats aggregation
   - Toasts, modals, export, wipe
   ========================================================= */

(() => {
  /* ------------------------------
   * Shorthand / Utilities
   * ------------------------------ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const byId = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = (p = "id") =>
    `${p}_${Math.random().toString(36).slice(2, 7)}${Date.now().toString(36)}`;

  const fmt = {
    time(ms) {
      const t = Math.max(0, Math.round(ms / 1000));
      const m = Math.floor(t / 60);
      const s = t % 60;
      return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    },
    date(ts) {
      const d = new Date(ts);
      return d.toLocaleString([], { hour: "2-digit", minute: "2-digit", month: "short", day: "numeric" });
    },
  };

  /* ------------------------------
   * Toasts
   * ------------------------------ */
  const Toaster = (() => {
    const host = byId("toasts");
    function toast(msg, type = "info", ms = 2200) {
      if (!host) { alert(msg); return; }
      const el = document.createElement("div");
      el.className = `toast ${type}`;
      el.textContent = msg;
      host.appendChild(el);
      const kill = () => el.remove();
      setTimeout(kill, ms);
      el.addEventListener("click", kill);
    }
    return { toast };
  })();

  /* ------------------------------
   * Local Storage Wrapper
   * ------------------------------ */
  const Store = {
    read(key, fallback) {
      try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback)); }
      catch { return fallback; }
    },
    write(key, value) { localStorage.setItem(key, JSON.stringify(value)); },

    get presets() { return this.read("fu_presets", defaults.presets); },
    set presets(v) { this.write("fu_presets", v); },

    get settings() { return this.read("fu_settings", defaults.settings); },
    set settings(v) { this.write("fu_settings", v); },

    get logs() { return this.read("fu_logs", []); },
    set logs(v) { this.write("fu_logs", v); },

    get seshActive() { return this.read("fu_sesh_active", null); },
    set seshActive(v) { this.write("fu_sesh_active", v); },

    get wax() { return this.read("fu_wax", defaults.wax); },
    set wax(v) { this.write("fu_wax", v); },

    wipeAll() {
      ["fu_presets","fu_settings","fu_logs","fu_sesh_active","fu_wax"].forEach(k=>localStorage.removeItem(k));
    }
  };

  /* ------------------------------
   * Defaults
   * ------------------------------ */
  const defaults = {
    wax: [
      { id:"live-resin", name:"Live Resin" },
      { id:"rosin", name:"Rosin" },
      { id:"shatter", name:"Shatter" },
      { id:"wax", name:"Wax" },
      { id:"sugar", name:"Sugar" },
      { id:"diamonds", name:"Diamonds" },
      { id:"sauce", name:"Sauce" },
    ],
    presets: [
      { id: uid("pr"), name: "Live Resin – Cool", waxId:"live-resin", minutes:0, seconds:45 },
      { id: uid("pr"), name: "Live Resin – Hot",  waxId:"live-resin", minutes:1, seconds:15 },
      { id: uid("pr"), name: "Rosin – Smooth",    waxId:"rosin",      minutes:0, seconds:55 },
      { id: uid("pr"), name: "Diamonds – Punchy", waxId:"diamonds",   minutes:1, seconds:35 },
      { id: uid("pr"), name: "Shatter – Quick",   waxId:"shatter",    minutes:0, seconds:40 },
    ],
    settings: {
      sound: "ding",          // none | ding | bell
      haptics: "light",       // off | light | medium | heavy
      defaultWaxId: "live-resin",
      autoLogSolo: "on"       // on | off
    },
    facts: [
      "Heat your banger evenly — cold spots wreck flavor.",
      "Let it cool ~45–90s after torching to reduce harshness.",
      "Q-tip after every dab. Clean quartz = clean flavor.",
      "Lower temps preserve terps; higher temps punch harder.",
      "Keep your rig water fresh; stale water = stale hits.",
      "Carb caps increase vaporization efficiency at lower temps.",
    ]
  };

  /* ------------------------------
   * App State
   * ------------------------------ */
  const App = {
    // Timer
    timer: {
      running: false,
      startTs: 0,
      endTs: 0,
      remaining: 0,
      tickRaf: 0,
      activePreset: null,
      activeWaxId: null,
    },
    facts: defaults.facts.slice(),
  };

  /* ------------------------------
   * Modal helpers
   * ------------------------------ */
  function openDialog(id) {
    const d = byId(id);
    if (!d) return null;
    if (!d.open) d.showModal();
    return d;
  }
  function closeDialog(id) {
    const d = byId(id);
    if (d?.open) d.close();
  }
  // Wire [data-close] buttons (global)
  function initCloseButtons() {
    $$("[data-close]").forEach(btn =>
      btn.addEventListener("click", () => closeDialog(btn.dataset.close))
    );
  }

  /* ------------------------------
   * Tabs
   * ------------------------------ */
  function initTabs() {
    const views = {
      timer: byId("tab-timer"),
      sesh: byId("tab-sesh"),
      log: byId("tab-log"),
      facts: byId("tab-facts"),
      settings: byId("tab-settings"),
    };
    const buttons = $$(".tabbar .tab");
    function setTab(name) {
      buttons.forEach(b=>{
        const on = b.dataset.tab === name;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-selected", String(on));
      });
      Object.entries(views).forEach(([k,v])=>{
        const on = k === name;
        v.classList.toggle("is-active", on);
        v.hidden = !on;
      });
      byId("route-title").textContent =
        name === "log" ? "History & Stats" :
        name === "sesh" ? "Sesh Mode" :
        name.charAt(0).toUpperCase() + name.slice(1);
      history.replaceState(null, "", `#/${name}`);
    }
    buttons.forEach(b => b.addEventListener("click", ()=> setTab(b.dataset.tab)));
    const initial = (location.hash.replace("#/","") || "timer");
    setTab(["timer","sesh","log","facts","settings"].includes(initial) ? initial : "timer");
  }

  /* ------------------------------
   * Wax / Presets UI
   * ------------------------------ */
  function renderWaxSelects() {
    const wax = Store.wax;
    // timer wax modal
    const selWax = byId("wax-select");
    selWax.innerHTML = wax.map(w => `<option value="${w.id}">${w.name}</option>`).join("");
    // preset modal
    const selPresetWax = byId("preset-wax");
    selPresetWax.innerHTML = selWax.innerHTML;
    // sesh modals
    const seshWaxInit = byId("sesh-wax-initial");
    const optDefaultWax = byId("opt-default-wax");
    seshWaxInit.innerHTML = selWax.innerHTML;
    optDefaultWax.innerHTML = selWax.innerHTML;

    // set defaults from settings
    const defId = Store.settings.defaultWaxId || wax[0]?.id;
    selWax.value = defId;
    selPresetWax.value = defId;
    seshWaxInit.value = defId;
    optDefaultWax.value = defId;

    // label in timer card
    labelWax(defId);
  }

  function labelWax(waxId) {
    const wax = Store.wax.find(w=>w.id===waxId);
    byId("timer-wax-label").textContent = `Wax: ${wax ? wax.name : "—"}`;
    App.timer.activeWaxId = waxId;
  }

  function renderPresetGrid() {
    const grid = byId("preset-grid");
    const presets = Store.presets;
    grid.innerHTML = presets.map(p => `
      <button class="preset-tile" data-id="${p.id}" title="${p.name}">
        <div class="title">${p.name}</div>
        <div class="meta">${String(p.minutes).padStart(2,"0")}:${String(p.seconds).padStart(2,"0")}</div>
      </button>
    `).join("");
    $$("#preset-grid .preset-tile").forEach(btn=>{
      btn.addEventListener("click", ()=>{
        const p = presets.find(x=>x.id===btn.dataset.id);
        if (!p) return;
        App.timer.activePreset = { ...p };
        byId("preset-label").textContent = `Preset: ${p.name}`;
        setCountdown((p.minutes*60 + p.seconds)*1000);
      });
      // (Optional) long-press edit/delete could be added later
    });
  }

  /* ------------------------------
   * Timer Engine
   * ------------------------------ */
  const countdownEl = byId("countdown");

  function setCountdown(ms) {
    App.timer.remaining = ms;
    countdownEl.textContent = fmt.time(ms);
  }

  function tick() {
    if (!App.timer.running) return;
    const now = Date.now();
    const remain = App.timer.endTs - now;
    if (remain <= 0) {
      stopTimer(true);
      finishTimer();
      return;
    }
    App.timer.remaining = remain;
    countdownEl.textContent = fmt.time(remain);
    App.timer.tickRaf = requestAnimationFrame(tick);
  }

  function startTimer() {
    if (App.timer.running) return;
    if (!App.timer.remaining) setCountdown(60*1000); // default 1:00
    App.timer.running = true;
    App.timer.startTs = Date.now();
    App.timer.endTs = Date.now() + App.timer.remaining;
    tick();
    microHaptic();
  }

  function pauseTimer() {
    if (!App.timer.running) return;
    App.timer.running = false;
    cancelAnimationFrame(App.timer.tickRaf);
    App.timer.remaining = Math.max(0, App.timer.endTs - Date.now());
    microHaptic();
  }

  function stopTimer(resetLabel = false) {
    App.timer.running = false;
    cancelAnimationFrame(App.timer.tickRaf);
    App.timer.tickRaf = 0;
    if (resetLabel) {
      // keep remaining at 0 when finished
      App.timer.remaining = 0;
    }
  }

  async function finishTimer() {
    countdownEl.textContent = "00:00";
    const st = Store.settings;
    // Sound (placeholder simple beeps)
    if (st.sound !== "none") {
      try { await playTone(st.sound); } catch {}
    }
    // Haptics
    microHaptic("heavy");
    // Auto-log solo dab?
    if (st.autoLogSolo === "on") {
      logSoloDab(App.timer.activeWaxId || Store.settings.defaultWaxId, App.timer.activePreset);
    }
    Toaster.toast("Timer finished", "success");
  }

  function playTone(kind="ding") {
    return new Promise((resolve) => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.value = kind === "bell" ? 660 : 880;
      g.gain.value = 0.001;
      o.connect(g); g.connect(ctx.destination);
      o.start();
      const t0 = ctx.currentTime;
      g.gain.exponentialRampToValueAtTime(0.3, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (kind === "bell" ? 0.6 : 0.25));
      o.stop(t0 + (kind === "bell" ? 0.65 : 0.27));
      o.onended = ()=>{ ctx.close(); resolve(); };
    });
  }

  function microHaptic(level) {
    const set = Store.settings.haptics;
    const type = level || set;
    if (navigator.vibrate && set !== "off") {
      const pat = type === "heavy" ? [30] : type === "medium" ? [15] : [7];
      navigator.vibrate(pat);
    }
  }

  /* ------------------------------
   * Solo Logging
   * ------------------------------ */
  function logSoloDab(waxId, preset) {
    const logs = Store.logs;
    const wax = Store.wax.find(w=>w.id===waxId);
    const dur = preset ? (preset.minutes*60 + preset.seconds) : Math.round(App.timer.remaining/1000);
    logs.unshift({
      id: uid("log"),
      kind: "solo",
      when: Date.now(),
      waxId,
      waxName: wax ? wax.name : "Unknown",
      durationSec: preset ? (preset.minutes*60 + preset.seconds) : dur,
      presetName: preset?.name || null,
      count: 1,
    });
    Store.logs = logs.slice(0, 500); // cap
    renderStats();
    renderLogs();
  }

  /* ------------------------------
   * Sesh Mode
   * ------------------------------ */
  function startSesh(name, playersArr, waxId) {
    const s = {
      id: uid("sesh"),
      name: name || "Untitled Sesh",
      waxId: waxId,
      startedAt: Date.now(),
      endedAt: null,
      players: playersArr.map(n => ({ id: uid("p"), name: n.trim(), dabs: 0 })),
      totalDabs: 0
    };
    Store.seshActive = s;
    renderSesh();
    Toaster.toast("Sesh started", "success");
  }

  function endSesh(save = true) {
    const s = Store.seshActive;
    if (!s) return;
    s.endedAt = Date.now();
    if (save) {
      // convert to log entries (one per player + summary)
      const logs = Store.logs;
      const wax = Store.wax.find(w=>w.id===s.waxId);
      const waxName = wax ? wax.name : "Unknown";
      const total = s.players.reduce((a,b)=>a+b.dabs,0);
      logs.unshift({
        id: uid("log"),
        kind: "sesh",
        when: s.endedAt,
        waxId: s.waxId,
        waxName,
        seshName: s.name,
        players: s.players.map(p=>({ name:p.name, dabs:p.dabs })),
        count: total
      });
      Store.logs = logs.slice(0, 500);
      Toaster.toast("Sesh saved to history", "success");
    }
    Store.seshActive = null;
    renderSesh();
    renderStats();
    renderLogs();
  }

  function renderSesh() {
    const s = Store.seshActive;
    const board = byId("sesh-board");
    const summary = byId("sesh-summary");
    const btnResume = byId("btn-resume-sesh");
    const btnEnd = byId("btn-end-sesh");

    if (!s) {
      board.hidden = true;
      summary.textContent = "No active sesh.";
      btnResume.hidden = true;
      btnEnd.hidden = true;
      return;
    }

    board.hidden = false;
    btnResume.hidden = false;
    btnEnd.hidden = false;

    const wax = Store.wax.find(w=>w.id===s.waxId);
    const total = s.players.reduce((a,b)=>a+b.dabs,0);
    summary.textContent = `${s.name} — ${wax ? wax.name : "Wax"} — ${total} dab(s)`;

    const list = byId("player-list");
    list.innerHTML = s.players.map(p => `
      <li class="player-card" data-id="${p.id}">
        <div class="player-header">
          <div class="player-name">${p.name}</div>
          <div class="player-count">${p.dabs}</div>
        </div>
        <div class="row" style="margin-top:8px">
          <button class="player-btn" data-act="inc">+1</button>
          <button class="btn ghost sm" data-act="dec">-1</button>
          <button class="btn danger sm" data-act="del">Remove</button>
        </div>
      </li>
    `).join("");

    // Bind actions
    $$("#player-list [data-act='inc']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest(".player-card").dataset.id;
      const s = Store.seshActive; if (!s) return;
      const p = s.players.find(x=>x.id===id); if (!p) return;
      p.dabs += 1; s.totalDabs += 1;
      Store.seshActive = s; renderSesh();
    }));
    $$("#player-list [data-act='dec']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest(".player-card").dataset.id;
      const s = Store.seshActive; if (!s) return;
      const p = s.players.find(x=>x.id===id); if (!p) return;
      p.dabs = Math.max(0, p.dabs - 1);
      Store.seshActive = s; renderSesh();
    }));
    $$("#player-list [data-act='del']").forEach(b => b.addEventListener("click", e=>{
      const id = e.currentTarget.closest(".player-card").dataset.id;
      const s = Store.seshActive; if (!s) return;
      s.players = s.players.filter(x=>x.id!==id);
      Store.seshActive = s; renderSesh();
    }));
  }

  /* ------------------------------
   * Stats & Logs
   * ------------------------------ */
  function renderStats() {
    const logs = Store.logs;
    const totalDabs = logs.reduce((a,l)=> a + (l.count || 1), 0);
    const totalMins = Math.round(
      logs.filter(l=>l.kind==="solo")
          .reduce((a,l)=> a + (l.durationSec||0), 0) / 60
    );

    // Most used wax by count
    const waxCount = {};
    logs.forEach(l=>{
      const key = l.waxName || "Unknown";
      waxCount[key] = (waxCount[key] || 0) + (l.count || 1);
    });
    const mostWax = Object.entries(waxCount).sort((a,b)=>b[1]-a[1])[0]?.[0] || "—";

    byId("stat-total-dabs").textContent = String(totalDabs);
    byId("stat-total-mins").textContent = String(totalMins);
    byId("stat-most-wax").textContent = mostWax;
  }

  function renderLogs() {
    const ul = byId("log-list");
    const logs = Store.logs;
    if (!logs.length) {
      ul.innerHTML = `<li class="card"><div class="meta">No logs yet.</div></li>`;
      return;
    }
    ul.innerHTML = logs.slice(0, 60).map(l=>{
      if (l.kind === "sesh") {
        const players = (l.players || []).map(p=>`${p.name} (${p.dabs})`).join(", ");
        return `
          <li class="card">
            <div class="title">Sesh — ${l.seshName || "Unnamed"}</div>
            <div class="meta">${fmt.date(l.when)} · ${l.waxName} · Total: ${l.count}</div>
            <div class="meta">Players: ${players || "—"}</div>
          </li>
        `;
      } else {
        return `
          <li class="card">
            <div class="title">Solo Dab ${l.presetName ? `— ${l.presetName}` : ""}</div>
            <div class="meta">${fmt.date(l.when)} · ${l.waxName} · ${Math.round(l.durationSec||0)}s</div>
          </li>
        `;
      }
    }).join("");
  }

  /* ------------------------------
   * Facts
   * ------------------------------ */
  function renderFacts() {
    const ul = byId("facts-list");
    const facts = App.facts;
    ul.innerHTML = facts.map(f=>`<li class="card"><div>${f}</div></li>`).join("");
  }
  function shuffleFacts() {
    const a = App.facts;
    for (let i=a.length-1;i>0;i--) { const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
    renderFacts();
  }

  /* ------------------------------
   * Settings
   * ------------------------------ */
  function loadSettingsUI() {
    const s = Store.settings;
    byId("opt-sound").value = s.sound;
    byId("opt-haptics").value = s.haptics;
    byId("opt-default-wax").value = s.defaultWaxId;
    byId("opt-autolog").value = s.autoLogSolo;
  }

  function bindSettings() {
    byId("opt-sound").addEventListener("change", (e)=>{
      const s = Store.settings; s.sound = e.target.value; Store.settings = s;
      Toaster.toast("Sound updated", "success");
    });
    byId("opt-haptics").addEventListener("change", (e)=>{
      const s = Store.settings; s.haptics = e.target.value; Store.settings = s;
      Toaster.toast("Haptics updated", "success");
    });
    byId("opt-default-wax").addEventListener("change", (e)=>{
      const s = Store.settings; s.defaultWaxId = e.target.value; Store.settings = s;
      labelWax(s.defaultWaxId);
      Toaster.toast("Default wax set", "success");
    });
    byId("opt-autolog").addEventListener("change", (e)=>{
      const s = Store.settings; s.autoLogSolo = e.target.value; Store.settings = s;
      Toaster.toast("Auto-log updated", "success");
    });

    byId("btn-export").addEventListener("click", ()=>{
      const bundle = {
        presets: Store.presets,
        settings: Store.settings,
        logs: Store.logs,
        seshActive: Store.seshActive,
        wax: Store.wax
      };
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `focusui-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    byId("btn-wipe").addEventListener("click", ()=>{
      openDialog("wipe-modal");
    });
    byId("btn-wipe-confirm").addEventListener("click", ()=>{
      Store.wipeAll();
      closeDialog("wipe-modal");
      // rehydrate defaults
      renderWaxSelects();
      renderPresetGrid();
      renderStats();
      renderLogs();
      renderSesh();
      loadSettingsUI();
      renderFacts();
      Toaster.toast("All data wiped", "success");
    });
  }

  /* ------------------------------
   * Bind UI: Timer & Presets
   * ------------------------------ */
  function bindTimerUI() {
    byId("btn-start").addEventListener("click", startTimer);
    byId("btn-pause").addEventListener("click", pauseTimer);
    byId("btn-stop").addEventListener("click", ()=>{
      stopTimer(true);
      setCountdown(0);
      byId("preset-label").textContent = "Preset: —";
      Toaster.toast("Timer reset","info");
    });

    // “Log Dab” for manual logging
    byId("btn-finish-dab").addEventListener("click", ()=>{
      const waxId = App.timer.activeWaxId || Store.settings.defaultWaxId;
      logSoloDab(waxId, App.timer.activePreset || null);
      Toaster.toast("Dab logged","success");
    });

    // Wax picker
    byId("btn-select-wax").addEventListener("click", ()=>{
      const dlg = openDialog("wax-modal");
      byId("wax-select").value = App.timer.activeWaxId || Store.settings.defaultWaxId;
      dlg && dlg.addEventListener("close", ()=>{ /* noop */ }, { once:true });
    });
    byId("btn-apply-wax").addEventListener("click", ()=>{
      const id = byId("wax-select").value;
      labelWax(id);
      closeDialog("wax-modal");
    });

    // Add custom preset
    byId("btn-add-preset").addEventListener("click", ()=>{
      const s = Store.settings;
      byId("preset-name").value = "";
      byId("preset-min").value = 1;
      byId("preset-sec").value = 30;
      byId("preset-wax").value = s.defaultWaxId;
      openDialog("preset-modal");
    });
    byId("btn-save-preset").addEventListener("click", ()=>{
      const name = byId("preset-name").value.trim();
      let min = parseInt(byId("preset-min").value || "0", 10);
      let sec = parseInt(byId("preset-sec").value || "0", 10);
      const waxId = byId("preset-wax").value;
      if (!name) return Toaster.toast("Name required","error");
      min = Math.max(0, Math.min(59,min));
      sec = Math.max(0, Math.min(59,sec));
      const arr = Store.presets;
      arr.unshift({ id: uid("pr"), name, waxId, minutes:min, seconds:sec });
      Store.presets = arr;
      closeDialog("preset-modal");
      renderPresetGrid();
      Toaster.toast("Preset saved","success");
    });
  }

  /* ------------------------------
   * Bind UI: Sesh
   * ------------------------------ */
  function bindSeshUI() {
    byId("btn-new-sesh").addEventListener("click", ()=>{
      // seed from settings
      const defWax = Store.settings.defaultWaxId;
      byId("sesh-name").value = "";
      byId("sesh-players").value = "Richie, Partner";
      byId("sesh-wax-initial").value = defWax;
      openDialog("sesh-setup-modal");
    });

    byId("btn-sesh-create").addEventListener("click", ()=>{
      const name = byId("sesh-name").value.trim();
      const players = byId("sesh-players").value.split(",").map(s=>s.trim()).filter(Boolean);
      const wax = byId("sesh-wax-initial").value;
      if (!players.length) return Toaster.toast("Add at least one player","error");
      closeDialog("sesh-setup-modal");
      startSesh(name, players, wax);
    });

    byId("btn-resume-sesh").addEventListener("click", ()=>{
      if (Store.seshActive) { renderSesh(); Toaster.toast("Sesh resumed","info"); }
    });

    byId("btn-end-sesh").addEventListener("click", ()=>{
      openDialog("end-sesh-modal");
    });

    byId("btn-end-sesh-confirm").addEventListener("click", ()=>{
      closeDialog("end-sesh-modal");
      endSesh(true);
    });

    byId("btn-sesh-add-player").addEventListener("click", ()=>{
      byId("player-name").value = "";
      openDialog("player-modal");
    });
    byId("btn-player-add").addEventListener("click", ()=>{
      const name = byId("player-name").value.trim();
      if (!name) return Toaster.toast("Enter a name","error");
      const s = Store.seshActive; if (!s) return closeDialog("player-modal");
      s.players.push({ id: uid("p"), name, dabs: 0 });
      Store.seshActive = s;
      closeDialog("player-modal");
      renderSesh();
    });

    byId("btn-sesh-wax").addEventListener("click", ()=>{
      const s = Store.seshActive; if (!s) return;
      const wax = prompt("Wax used:", Store.wax.find(w=>w.id===s.waxId)?.name || "");
      if (wax) {
        // try map to existing id by name
        const found = Store.wax.find(w=>w.name.toLowerCase() === wax.toLowerCase());
        if (found) s.waxId = found.id;
        Store.seshActive = s;
        renderSesh();
      }
    });

    byId("btn-sesh-log-dab").addEventListener("click", ()=>{
      const s = Store.seshActive; if (!s) return Toaster.toast("No active sesh","error");
      // increment first player (or all) — choose first by default
      if (s.players[0]) s.players[0].dabs += 1;
      s.totalDabs += 1;
      Store.seshActive = s;
      microHaptic();
      renderSesh();
    });
  }

  /* ------------------------------
   * Bind UI: Logs / Facts
   * ------------------------------ */
  function bindLogFactsUI() {
    byId("btn-clear-logs").addEventListener("click", ()=>{
      Store.logs = [];
      renderStats();
      renderLogs();
      Toaster.toast("Logs cleared","success");
    });
    byId("btn-shuffle-facts").addEventListener("click", shuffleFacts);
  }

  /* ------------------------------
   * Boot
   * ------------------------------ */
  function boot() {
    initCloseButtons();
    initTabs();

    renderWaxSelects();
    renderPresetGrid();

    bindTimerUI();
    bindSeshUI();
    bindLogFactsUI();

    renderSesh();
    renderStats();
    renderLogs();

    // Facts
    renderFacts();

    // Settings
    loadSettingsUI();
    bindSettings();

    // Initial timer label/time
    const defPreset = Store.presets[0];
    if (defPreset) {
      App.timer.activePreset = { ...defPreset };
      byId("preset-label").textContent = `Preset: ${defPreset.name}`;
      setCountdown((defPreset.minutes*60 + defPreset.seconds) * 1000);
      labelWax(defPreset.waxId);
    } else {
      labelWax(Store.settings.defaultWaxId);
      setCountdown(60*1000);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
