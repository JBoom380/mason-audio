"use strict";
// Family listening page: chapter list by book, a resume point for each chapter, speed, skip, bookmarks, lock screen controls.
// Positions, speed and bookmarks stay in this browser (localStorage) until its website data is cleared. "Add to Home Screen"
// keeps them safe from Safari's 7-day storage rule. A shared link (#c=<chapter>&t=<seconds>) opens that place, paused.

const $ = (s) => document.querySelector(s);
const audio = $("#audio");
const RATES = [0.25, 0.5, 1, 1.5, 2];             // John 11/23/2026; 1x is the approved Voice 5 pace
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
let ready = false;                                // the file of cur is loaded and at its saved place: only then a save
let VOICES = [];                                  // library.json "voices" (John 11/23/2026: S1 and S7 next to Voice 5)
let voice = null;                                 // the voice in use; the first voice keeps the old storage keys
function isFirst() { return !VOICES.length || voice === VOICES[0].id; }
function first() { return VOICES.length ? VOICES[0].id : "v5"; }
function pkey(id) { return "pos:" + id; }       // one place for each chapter in all voices (John 11/23/2026): t is in voice v
function lastKey() { return "last"; }
function books() { const v = VOICES.find((x) => x.id === voice); return v ? v.books : []; }
function chap(id, v) {
  const vo = VOICES.find((x) => x.id === v);
  for (const b of vo ? vo.books : []) for (const c of b.chapters) if (c.id === id) return c;
  return null;
}
function mapTime(id, from, to, t) {               // the same passage, and the same share of it, in the other voice
  if (from === to) return t;
  const a = chap(id, from), b = chap(id, to);
  if (!a || !b) return t;
  const sa = a.starts || [], sb = b.starts || [];
  if (!sa.length || sa.length !== sb.length) return a.dur ? (t * b.dur) / a.dur : t;
  let k = 0;
  while (k + 1 < sa.length && sa[k + 1] <= t) k++;
  if (t < sa[0]) return sb[0] * (sa[0] ? t / sa[0] : 0);
  const ea = k + 1 < sa.length ? sa[k + 1] : a.dur, eb = k + 1 < sb.length ? sb[k + 1] : b.dur;
  const f = ea > sa[k] ? Math.min(1, (t - sa[k]) / (ea - sa[k])) : 0;
  return sb[k] + f * (eb - sb[k]);
}

function fmt(s) {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
function mins(s) { return s >= 3600 ? (s / 3600).toFixed(1) + " h" : Math.max(1, Math.round(s / 60)) + " min"; }
function pos(id) {                               // the saved place, in the voice in use
  const p = store.get(pkey(id), { t: 0, done: false });
  return Object.assign({}, p, { t: mapTime(id, p.v || first(), voice, p.t || 0) });
}
function msg(t) { $("#msg").textContent = t || ""; }
function rateNow() { const r = store.get("rate", 1); return RATES.includes(r) ? r : 1; }
function markRate() {
  for (const b of document.querySelectorAll(".rates button")) {
    const on = Number(b.dataset.rate) === rateNow();
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", on ? "true" : "false");
  }
}
function setRate(r) {
  store.set("rate", r);
  audio.defaultPlaybackRate = r;
  audio.playbackRate = r;
  markRate();
  posState();
  if (Math.abs(audio.playbackRate - r) > 0.001) msg(`This browser does not play at ${r}x.`);
}

function marks() { return store.get("marks", []); }
function link(c, t) {
  return location.origin + location.pathname + "#c=" + encodeURIComponent(c.id) + "&t=" + Math.floor(t) + (isFirst() ? "" : "&v=" + encodeURIComponent(voice));
}
async function share(c, t) {
  const url = link(c, t), text = `${c.title} (${c.book.title}) at ${fmt(t)}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Charlotte Mason audio", text, url }); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); msg("Link copied: " + text); } catch (e) { msg(url); }
}
function renderMarks() {
  const list = marks().filter((m) => flat.some((c) => c.id === m.c));   // bookmarks work in every voice
  const ul = $("#markList");
  ul.textContent = "";
  $("#marks").hidden = !list.length;
  for (const m of list.slice().reverse()) {
    const c = flat.find((x) => x.id === m.c);
    const li = document.createElement("li");
    li.className = "mk";
    li.innerHTML = `<button type="button" class="mk-go"><span class="mk-title"></span><span class="mk-meta"></span></button>` +
      `<button type="button" class="mk-act mk-share">Share</button><button type="button" class="mk-act mk-del">Delete</button>`;
    li.querySelector(".mk-title").textContent = c.title;
    const t = mapTime(c.id, m.v || first(), voice, m.t);
    li.querySelector(".mk-meta").textContent = `${c.book.title} · ${fmt(t)}`;
    li.querySelector(".mk-go").addEventListener("click", () => start(c, true, t));
    li.querySelector(".mk-share").addEventListener("click", () => share(c, t));
    li.querySelector(".mk-del").addEventListener("click", () => { store.set("marks", marks().filter((x) => x.id !== m.id)); renderMarks(); });
    ul.appendChild(li);
  }
}

function render() {
  const wrap = $("#books");
  wrap.textContent = "";
  const open = store.get("open", {});
  for (const b of books()) {
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
  const lastId = store.get(lastKey(), null);
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

function save(force) {                           // an emptied or new file reports time 0: that must not overwrite a saved place
  if (!cur || !ready || audio.getAttribute("src") !== cur.file || !isFinite(audio.currentTime)) return;
  const now = Date.now();
  if (!force && now - lastSave < 5000) return;
  lastSave = now;
  const d = isFinite(audio.duration) ? audio.duration : cur.dur;
  const done = d > 0 && audio.currentTime >= d - 10;
  const old = pos(cur.id);
  store.set(pkey(cur.id), { t: done ? 0 : audio.currentTime, v: voice, done: done || old.done, at: now });
  store.set(lastKey(), cur.id);
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

function start(c, play, atOverride) {
  if (cur && cur.id !== c.id) save(true);
  cur = c;
  const p = pos(c.id);
  const exact = atOverride != null;               // a bookmark or a shared link: that second
  const at = exact ? atOverride : p.done ? 0 : p.t || 0;
  ready = false;
  audio.src = c.file;
  audio.preload = "auto";
  const rate = rateNow();
  audio.defaultPlaybackRate = rate;
  audio.playbackRate = rate;
  audio.preservesPitch = true;
  audio.webkitPreservesPitch = true;
  const seekOnce = () => {
    audio.removeEventListener("loadedmetadata", seekOnce);
    ready = true;
    if (at > (exact ? 0 : 1) && at < (audio.duration || c.dur) - (exact ? 0.5 : 5)) audio.currentTime = at;
    audio.playbackRate = rateNow();
    paint();
    posState();
  };
  audio.addEventListener("loadedmetadata", seekOnce);
  if (play) audio.play().catch(() => { audio.pause(); playIcon(); if (!audio.error) msg("Tap Paused to start."); });
  $("#player").hidden = false;
  $("#nowTitle").textContent = c.title;
  $("#nowBook").textContent = c.book.title + " · " + c.book.subtitle;
  markRate();
  playIcon();
  store.set(lastKey(), c.id);
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
  if (!cur || audio.getAttribute("src") !== cur.file) return;      // no file of cur loaded: keep the saved place on screen
  const d = isFinite(audio.duration) ? audio.duration : (cur ? cur.dur : 0);
  if (!seeking) $("#seek").value = d ? Math.round((1000 * audio.currentTime) / d) : 0;
  $("#tCur").textContent = fmt(audio.currentTime);
  $("#tLeft").textContent = "-" + fmt(d - audio.currentTime);
}

function playIcon() {                            // the button shows the state: "Paused" (John 11/23/2026) or "Playing"
  const on = !audio.paused && !audio.error;
  $("#icPlay").toggleAttribute("hidden", on);    // an SVG element has no hidden property: set the attribute
  $("#icPause").toggleAttribute("hidden", !on);
  $("#playLabel").textContent = on ? "Playing" : "Paused";
  $("#play").setAttribute("aria-label", on ? "Playing. Tap to pause" : "Paused. Tap to play");
}

$("#play").addEventListener("click", () => {
  if (!cur) return;
  if (!audio.getAttribute("src")) { start(cur, true); return; }
  if (audio.paused) audio.play().catch(() => { audio.pause(); playIcon(); }); else audio.pause();
});
$("#back").addEventListener("click", () => skip(-BACK_S));
$("#fwd").addEventListener("click", () => skip(FWD_S));
$("#next").addEventListener("click", () => { const n = cur && next(cur); if (n) start(n, true); });
for (const b of document.querySelectorAll(".rates button")) b.addEventListener("click", () => setRate(Number(b.dataset.rate)));
$("#mark").addEventListener("click", () => {
  if (!cur) return;
  const t = ready && audio.getAttribute("src") === cur.file && isFinite(audio.currentTime) ? audio.currentTime : pos(cur.id).t || 0;
  const list = marks();
  list.push({ id: Date.now(), c: cur.id, t: Math.floor(t * 10) / 10, v: voice });
  store.set("marks", list);
  renderMarks();
  msg(`Bookmark saved: ${cur.title} at ${fmt(t)}.`);
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
  audio.pause();                                  // nothing plays: the button says Paused
  playIcon();
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
  VOICES = window.LIB.voices || [{ id: "v5", name: "Voice 5", books: window.LIB.books }];
  const h = new URLSearchParams(location.hash.slice(1));
  const want = h.get("v") || store.get("voice", null);
  voice = VOICES.some((v) => v.id === want) ? want : VOICES[0].id;
  renderVoices();
  useVoice();
  markRate();
  const shared = h.get("c") && flat.find((c) => c.id === h.get("c"));
  if (shared) {                                   // a shared bookmark: that chapter at that second, paused
    const t = Math.max(0, Number(h.get("t")) || 0);
    history.replaceState(null, "", location.pathname + location.search);
    start(shared, false, t);
    msg(`Shared place: ${shared.title} at ${fmt(t)}. Tap Paused to play.`);
  }
})();

function renderVoices() {                         // the Voice dropdown in the player (John 11/23/2026); hidden with one voice
  const sel = $("#voiceSel");
  sel.textContent = "";
  $("#voiceRow").hidden = VOICES.length < 2;
  for (const v of VOICES) {
    const o = document.createElement("option");
    o.value = v.id;
    o.textContent = v.name;
    sel.appendChild(o);
  }
  sel.value = voice;
}
$("#voiceSel").addEventListener("change", (e) => switchVoice(e.target.value));

function useVoice() {                             // the chapter list, bookmarks and resume point of the voice in use
  flat = [];
  for (const b of books()) for (const c of b.chapters) { c.book = b; flat.push(c); }
  cur = null;
  render();
  renderMarks();
  playIcon();
  const last = flat.find((c) => c.id === store.get(lastKey(), null));
  $("#player").hidden = !last;
  if (last) {
    cur = last;
    const p = pos(last.id);
    $("#nowTitle").textContent = last.title;
    $("#nowBook").textContent = last.book.title + " · " + last.book.subtitle;
    $("#tCur").textContent = fmt(p.done ? 0 : p.t);
    $("#tLeft").textContent = "-" + fmt(last.dur - (p.done ? 0 : p.t));
    $("#seek").value = last.dur ? Math.round((1000 * (p.done ? 0 : p.t)) / last.dur) : 0;
  }
}

function switchVoice(id) {                        // the new voice goes on at the same passage (John 11/23/2026), playing if it played
  if (id === voice) return;
  const was = cur, playing = !audio.paused;
  const t = was ? (ready && audio.getAttribute("src") === was.file ? audio.currentTime : pos(was.id).t || 0) : 0;
  save(true);
  audio.pause();
  ready = false;
  audio.removeAttribute("src");
  audio.load();
  const from = voice;
  voice = id;
  store.set("voice", id);
  renderVoices();
  useVoice();
  msg("");
  if (!was) return;
  const same = flat.find((c) => c.id === was.id);
  if (!same) {
    msg(`${was.title} is not ready in ${VOICES.find((v) => v.id === id).name} yet.`);
    return;
  }
  start(same, playing, mapTime(was.id, from, id, t));
}
