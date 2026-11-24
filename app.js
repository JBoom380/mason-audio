"use strict";
// Private family listening page: chapter list by book, a resume point for each chapter, speed, skip, lock screen controls.
// Positions stay on this phone (localStorage). "Add to Home Screen" keeps them safe from Safari's 7-day storage rule.

const $ = (s) => document.querySelector(s);
const audio = $("#audio");
const RATES = [1, 1.1, 1.25, 1.5, 0.8, 0.9];
const BACK_S = 15;
const FWD_S = 30;
const store = {
  get(k, d) { try { const v = localStorage.getItem("cm:" + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("cm:" + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
};
let flat = [];
let cur = null;
let lastSave = 0;
let seeking = false;

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function mins(s) { return s >= 3600 ? (s / 3600).toFixed(1) + " h" : Math.max(1, Math.round(s / 60)) + " min"; }
function pos(id) { return store.get("pos:" + id, { t: 0, done: false }); }
function msg(t) { $("#msg").textContent = t || ""; }

function render() {
  const wrap = $("#books");
  wrap.textContent = "";
  const open = store.get("open", {});
  for (const b of window.LIB.books) {
    const d = document.createElement("details");
    d.className = "book";
    d.open = !!open[b.id];
    d.addEventListener("toggle", () => { const o = store.get("open", {}); o[b.id] = d.open; store.set("open", o); });
    const total = b.chapters.reduce((a, c) => a + (c.dur || 0), 0);
    const doneN = b.chapters.filter((c) => pos(c.id).done).length;
    const s = document.createElement("summary");
    s.innerHTML = `<span class="b-title"></span><span class="b-meta"></span>`;
    s.querySelector(".b-title").textContent = b.title;
    s.querySelector(".b-meta").textContent = `${b.subtitle} · ${b.chapters.length} parts · ${mins(total)} · ${doneN} heard`;
    d.appendChild(s);
    let group = null;
    for (const c of b.chapters) {
      if (c.group && c.group !== group) {
        group = c.group;
        const g = document.createElement("div");
        g.className = "group";
        g.textContent = group;
        d.appendChild(g);
      }
      const p = pos(c.id);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ch" + (cur && cur.id === c.id ? " playing" : "");
      btn.dataset.id = c.id;
      btn.innerHTML = `<span class="ch-title"></span><span class="ch-meta"><span class="len"></span><span class="prog"><i></i></span><span class="state"></span></span>`;
      btn.querySelector(".ch-title").textContent = c.title;
      btn.querySelector(".len").textContent = mins(c.dur || 0);
      btn.querySelector(".prog > i").style.width = (p.done ? 100 : Math.min(100, (100 * p.t) / (c.dur || 1))) + "%";
      btn.querySelector(".state").textContent = p.done ? "Heard" : p.t > 5 ? fmt(p.t) : "";
      if (p.done) btn.querySelector(".state").className = "state done-mark";
      btn.addEventListener("click", () => start(c, true));
      d.appendChild(btn);
    }
    wrap.appendChild(d);
  }
  const lastId = store.get("last", null);
  const last = flat.find((c) => c.id === lastId);
  if (last && !audio.getAttribute("src")) {
    const p = pos(last.id);
    $("#cont").hidden = false;
    $("#contTitle").textContent = last.title;
    $("#contMeta").textContent = `${last.book.title} · ${p.done ? "heard" : fmt(p.t) + " of " + fmt(last.dur)}`;
    $("#contBtn").onclick = () => start(p.done ? next(last) || last : last, true);
  } else {
    $("#cont").hidden = true;
  }
}

function next(c) { const i = flat.indexOf(c); return i >= 0 && i + 1 < flat.length ? flat[i + 1] : null; }

function save(force) {
  if (!cur || !isFinite(audio.currentTime)) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  const d = isFinite(audio.duration) ? audio.duration : cur.dur;
  const done = d > 0 && audio.currentTime >= d - 10;
  const old = pos(cur.id);
  store.set("pos:" + cur.id, { t: done ? 0 : audio.currentTime, done: done || old.done, at: now });
  store.set("last", cur.id);
}

function setSession() {
  if (!("mediaSession" in navigator) || !cur) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: cur.title, artist: "Charlotte M. Mason", album: cur.book.title,
      artwork: [{ src: "icon-512.png", sizes: "512x512", type: "image/png" }],
    });
  } catch (e) { /* older Safari */ }
  const h = (a, f) => { try { navigator.mediaSession.setActionHandler(a, f); } catch (e) { /* action not supported */ } };
  h("play", () => audio.play());
  h("pause", () => audio.pause());
  h("seekbackward", (e) => skip(-((e && e.seekOffset) || BACK_S)));
  h("seekforward", (e) => skip((e && e.seekOffset) || FWD_S));
  h("seekto", (e) => { audio.currentTime = e.seekTime; posState(); save(true); });
  h("previoustrack", null);                   // keeps the 15 and 30 second skip buttons on the lock screen
  h("nexttrack", null);
}

function posState() {
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState || !isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({ duration: audio.duration, playbackRate: audio.playbackRate, position: Math.min(audio.currentTime, audio.duration) });
  } catch (e) { /* ignore */ }
}

function start(c, play) {
  if (cur && cur.id !== c.id) save(true);
  cur = c;
  const p = pos(c.id);
  const at = p.done ? 0 : p.t || 0;
  audio.src = c.file;
  audio.preload = "auto";
  const rate = store.get("rate", 1);
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  const seekOnce = () => {
    audio.removeEventListener("loadedmetadata", seekOnce);
    if (at > 1 && at < (audio.duration || c.dur) - 5) audio.currentTime = at;
    audio.playbackRate = store.get("rate", 1);
    posState();
  };
  audio.addEventListener("loadedmetadata", seekOnce);
  if (play) audio.play().catch(() => msg("Tap play to start."));
  $("#player").hidden = false;
  $("#nowTitle").textContent = c.title;
  $("#nowBook").textContent = c.book.title + " · " + c.book.subtitle;
  $("#rate").textContent = store.get("rate", 1) + "x";
  store.set("last", c.id);
  setSession();
  render();
}

function skip(d) {
  if (!cur) return;
  const dur = isFinite(audio.duration) ? audio.duration : cur.dur;
  audio.currentTime = Math.max(0, Math.min(dur - 0.5, audio.currentTime + d));
  posState();
  save(true);
}

function paint() {
  const d = isFinite(audio.duration) ? audio.duration : (cur ? cur.dur : 0);
  if (!seeking) $("#seek").value = d ? Math.round((1000 * audio.currentTime) / d) : 0;
  $("#tCur").textContent = fmt(audio.currentTime);
  $("#tLeft").textContent = "-" + fmt(d - audio.currentTime);
}

function playIcon() {
  const on = !audio.paused;
  $("#icPlay").hidden = on;
  $("#icPause").hidden = !on;
  $("#play").setAttribute("aria-label", on ? "Pause" : "Play");
}

$("#play").addEventListener("click", () => {
  if (!cur) return;
  if (!audio.getAttribute("src")) { start(cur, true); return; }
  if (audio.paused) audio.play().catch(() => {}); else audio.pause();
});
$("#back").addEventListener("click", () => skip(-BACK_S));
$("#fwd").addEventListener("click", () => skip(FWD_S));
$("#next").addEventListener("click", () => { const n = cur && next(cur); if (n) start(n, true); });
$("#rate").addEventListener("click", () => {
  const r = RATES[(RATES.indexOf(store.get("rate", 1)) + 1) % RATES.length];
  store.set("rate", r);
  audio.defaultPlaybackRate = r;
  audio.playbackRate = r;
  $("#rate").textContent = r + "x";
  posState();
});
$("#seek").addEventListener("input", () => {
  seeking = true;
  const d = isFinite(audio.duration) ? audio.duration : cur.dur;
  $("#tCur").textContent = fmt((d * $("#seek").value) / 1000);
});
$("#seek").addEventListener("change", () => {
  const d = isFinite(audio.duration) ? audio.duration : cur.dur;
  audio.currentTime = (d * $("#seek").value) / 1000;
  seeking = false;
  posState();
  save(true);
});
audio.addEventListener("timeupdate", () => { paint(); save(false); });
audio.addEventListener("play", () => { playIcon(); msg(""); });
audio.addEventListener("pause", () => { playIcon(); save(true); render(); });
audio.addEventListener("ratechange", posState);
audio.addEventListener("ended", () => {
  save(true);
  const n = next(cur);
  if (n) start(n, true); else render();
});
audio.addEventListener("error", async () => {
  try {
    const r = await fetch("library.json", { method: "HEAD", cache: "no-store" });
    if (r.status === 401) { location.href = "./"; return; }
  } catch (e) { /* offline */ }
  msg("This part did not load. Check the connection, then tap it again.");
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") save(true); });
window.addEventListener("pagehide", () => save(true));

(async function init() {
  try {
    const r = await fetch("library.json", { cache: "no-cache" });
    if (r.status === 401) { location.href = "./"; return; }
    window.LIB = await r.json();
  } catch (e) {
    msg("The list did not load. Check the connection.");
    return;
  }
  for (const b of window.LIB.books) for (const c of b.chapters) { c.book = b; flat.push(c); }
  render();
  const last = flat.find((c) => c.id === store.get("last", null));
  if (last) {
    cur = last;
    const p = pos(last.id);
    $("#player").hidden = false;
    $("#nowTitle").textContent = last.title;
    $("#nowBook").textContent = last.book.title + " · " + last.book.subtitle;
    $("#rate").textContent = store.get("rate", 1) + "x";
    $("#tCur").textContent = fmt(p.done ? 0 : p.t);
    $("#tLeft").textContent = "-" + fmt(last.dur - (p.done ? 0 : p.t));
  }
})();
