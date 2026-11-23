/*
 * Las Vegas Compost routes: walkthroughs.
 * Guided tours that highlight the real buttons and wait for the person to tap them.
 *  - "driver": for a new driver. Runs on a practice route (?live&practice): pretend customers,
 *    nothing is saved and no text is sent.
 *  - "owner": for the owner. Makes a TEST route around them and drives it with the full-screen
 *    directions, the way a driver would.
 * The menu opens by itself the first time the live app is opened on a phone, and from the
 * Tutorial button at the top any time after that.
 */
(function(){
"use strict";
let api = null;
const params = new URLSearchParams(location.search);
const OFFER_KEY = "lvc-tour-offered";

/* ---------- small helpers ---------- */
const q = s => document.querySelector(s);
const qa = s => Array.from(document.querySelectorAll(s));
const shown = el => !!el && el.getClientRects().length > 0;
const firstShown = s => qa(s).find(shown) || null;
const val = v => typeof v === "function" ? v() : v;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const LIVE = () => (api && api.live) || null;
const practice = () => !!(LIVE() && LIVE().practice);
const ownerCanTest = () => !!(LIVE() && !LIVE().practice && LIVE().ready && LIVE().role !== "driver");
const inDriver = () => document.body.classList.contains("driver-mode");
const full = () => q(".navbox.full");
const enabled = s => { const b = q(s); return !!b && !b.disabled; };
const startReady = () => enabled('[data-act="start-route"]');
const completeReady = () => enabled('[data-act="complete-stop"]');
const bucketsDone = () => { const i = q(".alert-buckets input"); return !i || i.checked; };
const headId = () => { const h = q('[data-tour="route-head"]'); return h ? h.dataset.id || "" : ""; };
const facility = () => { const S = api && api.S(); return esc(S && S.facility ? (S.facility.short || S.facility.name) : "the facility"); };
const HAND = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V10m0-1.5a1.5 1.5 0 0 1 3 0V11m0-1a1.5 1.5 0 0 1 3 0v4.5a6.5 6.5 0 0 1-6.5 6.5h-.6a6 6 0 0 1-4.5-2.1L4.6 16a1.6 1.6 0 0 1 2.3-2.2L9 15.5"/></svg>';

/* ---------- the steps ----------
 * sel: what to highlight (selector or function). center: no highlight, a card in the middle.
 * tap: wait for a tap on the highlighted part (tapSel narrows which part). until: with tap, wait
 * for this to become true before moving on. skipIf: skip the step. optional: skip it if the part
 * isn't on screen. buttons: custom buttons for the last step.
 */
const BUCKETS = {sel:".alert-buckets .check-row", tap:true, skipIf: bucketsDone, until: bucketsDone,
  title:"Grab the new buckets",
  text:"Some stops are new customers who need their first bucket. Load those before you leave, then tap here to check them off."};
const START_FROM = {sel:".start-card", tap: () => !startReady(), until: startReady,
  title:"Where are you starting from?",
  text: () => startReady()
    ? "Your stops are put in the shortest driving order from here. One is already picked for you. You can change it on a real route if you're starting somewhere else."
    : "Tap where you're starting from. Your stops get put in the shortest driving order from there.",
  waitText:"Finding your location…"};
const START_ROUTE = {sel:'[data-act="start-route"]', tap:true,
  until: () => !!full() || (!!q(".now-card") && (!q(".navbox") || Date.now() - T.tapAt > 10000)),
  title:"Start the route",
  text:"Ready to roll? Tap <b>Start route</b>. The directions open full screen, like Google Maps.",
  waitText:"Opening the directions…"};
const NAV = [
  {sel:".navbox.full .nav-banner", skipIf: () => !full(), title:"Your next turn",
    text:"The green bar shows your next turn and how far away it is. The app also says each turn out loud, so keep your volume up."},
  {sel:".navbox.full .nav-fabs", skipIf: () => !full(), pad:8, title:"Map buttons",
    text:"<b>X</b> closes the map. The <b>speaker</b> turns the voice on or off. The <b>route</b> button shows the whole drive (tap Re-center to follow you again)."},
  {sel:".navbox.full .nav-foot", skipIf: () => !full(), title:"Time left and your next stop",
    text:"How long until you get there and which stop it is. When you pull up, tap <b>I'm here · photo</b>. Google Maps is there as a backup."},
  {sel:'.navbox.full [data-nav="exit"]', tap:true, skipIf: () => !full(), until: () => !full(), pad:6, title:"See the stop details",
    text:"Tap <b>X</b> to close the map and see this stop's details."}
];
const STOP_HEAD = {sel:'[data-tour="stop-head"]', optional:true, title:"The stop you're on",
  text:"The customer's name and address, with Copy. Gate codes and notes show up right under it when a stop has them."};

const DRIVER = [
  {center:true, title:"Welcome to the driver app",
    text:"This is a practice route with pretend customers. Tap the real buttons as we go. Nothing is saved, and nobody gets a text."},
  {sel:'[data-tour="route-head"]', title:"Today's route", waitText:"Loading your practice route…",
    text:"Your route for the day: how many stops, how many miles, and where you start from."},
  BUCKETS,
  START_FROM,
  {sel:".stops > li:first-child", tap:true, tapSel:".copy-btn", optional:true, title:"Every stop's address",
    text:"Each stop shows its address with a Copy button, so you can paste it into a text or another app. Tap <b>Copy</b>."},
  {sel:".gmaps-card", optional:true, title:"Rather use Google Maps?",
    text:"This opens your stops in Google Maps, in order. Most days you'll use the app's own directions instead, which come next."},
  START_ROUTE,
  ...NAV,
  STOP_HEAD,
  {sel: () => firstShown('.now-card [data-act="navigate"]') || firstShown(".now-card .now-btns .btn.primary"), optional:true, title:"Directions any time",
    text:"<b>Navigate to this stop</b> opens the full-screen directions again. Rather use another app? Google Maps, Apple Maps and Waze are right under it."},
  {sel:".now-card .photo-drop", tap:true, until: completeReady, title:"Take the photo", tapHint:"Tap Use sample photo to keep going",
    text:"At every stop you take a photo of the bucket. For practice, tap <b>Use sample photo</b> (or take a real one)."},
  {sel:'[data-act="complete-stop"]', tap:true, settle:900, title:"Finish the stop",
    text:"Tap to finish the stop. In the real app this texts the customer the photo and lets the next customer know you're on the way."},
  {sel:'[data-act="skip-stop"]', optional:true, title:"Can't do a stop?",
    text:"Bucket not out, or the gate's locked? Tap this and pick a reason. The owner gets a note right away, and the customer isn't texted."},
  {sel:".up-next", optional:true, maxH:240, title:"The rest of your stops",
    text:"Your stops in driving order. Tap one to do it next, for example if a customer asks you to come back later."},
  {center:true, title:"You're ready to drive",
    text: () => `After your last stop, the app takes you to ${facility()} to dump the buckets. Check that off and tap <b>End route</b>. That's the whole day.`,
    buttons:[{label:"Exit practice", primary:true, run: () => { finish(); if(LIVE() && LIVE().exitPractice) LIVE().exitPractice(); }},
             {label:"Keep practicing", run: () => finish()}]}
];

const OWNER = [
  {center:true, title:"Test-drive a route",
    text:"You'll make a pretend TEST route around where you are, then drive it like one of your drivers. TEST stops have no phone numbers, so no texts go out."},
  {sel: () => firstShown('[data-act="role"][data-role="driver"]'), tap:true, skipIf: inDriver, until: inDriver, title:"Open the driver app",
    text:"Tap <b>Driver</b>. This is exactly what your drivers see on their phones."},
  {sel:'[data-act="driver-logout"]', tap:true, skipIf: () => !!q('[data-act="driver-login"]') || !!q(".test-bar"), until: () => !!q('[data-act="driver-login"]'),
    title:"Switch driver", text:"Tap <b>Switch driver</b> so you can pick yourself."},
  {sel:".driver-pick", tap:true, tapSel:'[data-act="driver-login"]', maxH:320, skipIf: () => !q('[data-act="driver-login"]'), until: () => !q('[data-act="driver-login"]'),
    title:"Pick yourself", text:"Tap your name. The test route goes to a “(test)” copy of you, so your real routes aren't touched."},
  {sel:".test-bar", tap:true, tapSel:'[data-act="test-route-near"],[data-act="test-route-area"]', onTap: () => { T.mark = headId(); },
    until: () => T.tapped && !!q('[data-tour="route-head"][data-test="1"]') && headId() !== T.mark,
    title:"Make a test route",
    text:"Tap <b>Test route near me</b>. It puts 7 TEST stops at real addresses 1 to 5 miles around you. Allow your location if the phone asks.",
    waitText:"Making your test route. Finding real addresses for 7 stops…",
    missingFree:true, missingText:"Test routes can't be made while this driver has a real route going. Tap <b>Switch driver</b> at the top and pick another name."},
  BUCKETS,
  START_FROM,
  {sel:".stops", maxH:230, optional:true, title:"Your stops, in order",
    text:"The stops are put in the shortest driving order. Each one has its address and a Copy button."},
  {sel:".gmaps-card", optional:true, title:"Google Maps, if a driver prefers it",
    text:"Opens the stops in Google Maps, 10 at a time. The app still keeps track of every stop."},
  START_ROUTE,
  ...NAV,
  STOP_HEAD,
  {sel:".now-card .photo-drop", optional:true, title:"The photo",
    text:"At each stop the driver takes a photo of the bucket. On a test route, a photo of anything works."},
  {sel:'[data-act="complete-stop"]', optional:true, title:"Mark serviced",
    text:"Then they tap <b>Mark serviced</b>. On a real route the customer gets a text with the photo. TEST stops have no phone number, so nothing is sent."},
  {sel: () => firstShown('[data-act="role"][data-role="owner"]'), optional:true, title:"Watch it from the owner side",
    text:"Switch to <b>Owner</b> any time to see this route's progress live on Today and Routes, the same way you'll watch your drivers."},
  {sel:".test-bar", optional:true, maxH:220, title:"Clean up when you're done",
    text:"When you're finished testing, come back here and tap <b>Clear test routes</b>."},
  {center:true, title:"Now go drive it",
    text:"Tap <b>Start driving</b> and head to stop 1. The map follows you and says each turn. At each stop, take a photo and mark it serviced, and the directions open for the next one.",
    buttons:[{label:"Start driving", primary:true, run: () => { finish(); if(LIVE() && LIVE().navigate) LIVE().navigate(); }},
             {label:"Done", run: () => finish()}]}
];
const TOURS = {driver: DRIVER, owner: OWNER};

/* ---------- engine ---------- */
let T = null, ui = null, tickTimer = null, raf = 0;

function injectStyle(){
  if(q("#tour-style")) return;
  const st = document.createElement("style"); st.id = "tour-style";
  st.textContent = `
  .tour{position:fixed;inset:0;z-index:55;pointer-events:none}
  body.touring .toasts{z-index:54}
  .tour-dim{position:fixed;inset:0;background:rgba(6,12,8,.62);display:none}
  .tour.nohole .tour-dim{display:block}
  .tour.free .tour-dim{display:none}
  .tour-hole{position:fixed;display:none;border-radius:14px;box-shadow:0 0 0 200vmax rgba(6,12,8,.62);pointer-events:none}
  .tour-hole.tap{outline:3px solid #8FE3A2;outline-offset:2px;animation:tourPulse 1.4s ease-in-out infinite}
  .tour-hole.nudge{animation:tourNudge .5s ease}
  @keyframes tourPulse{0%,100%{outline-color:rgba(143,227,162,1)}50%{outline-color:rgba(143,227,162,.3)}}
  @keyframes tourNudge{0%,100%{transform:none}25%{transform:translateX(-6px)}75%{transform:translateX(6px)}}
  .tour-block{position:fixed;display:none;pointer-events:auto;background:transparent;-webkit-tap-highlight-color:transparent}
  .tour-bubble{position:fixed;pointer-events:auto;background:var(--surface,#fff);color:var(--ink,#152018);border-radius:16px;box-shadow:0 14px 44px rgba(0,0,0,.38);padding:12px 16px 14px;font-size:15px;line-height:1.45;max-height:calc(100vh - 24px);overflow:auto}
  .tb-top{display:flex;align-items:center;justify-content:space-between;gap:10px}
  .tb-count{font-size:12px;font-weight:800;letter-spacing:.04em;color:var(--muted,#5B685E);text-transform:uppercase}
  .tb-x{border:0;background:transparent;color:var(--muted,#5B685E);font:inherit;font-size:13px;font-weight:700;padding:6px 0 6px 10px;cursor:pointer}
  .tb-bar{height:4px;border-radius:4px;background:var(--surface-2,#E8EDE4);margin:6px 0 10px;overflow:hidden}
  .tb-bar i{display:block;height:100%;background:var(--brand,#2C6B3E);border-radius:4px}
  .tb-title{font-size:18px;font-weight:800;line-height:1.2;margin:0 0 4px;font-family:var(--display,inherit)}
  .tb-text{margin:0}
  .tb-tap,.tb-wait{display:flex;gap:8px;align-items:center;margin-top:10px;font-weight:800;font-size:14px;color:var(--brand-strong,#1F5230)}
  .tb-tap svg{flex:none}
  .tb-spin{width:16px;height:16px;border-radius:50%;border:2.5px solid currentColor;border-right-color:transparent;animation:tourSpin .8s linear infinite;flex:none}
  @keyframes tourSpin{to{transform:rotate(360deg)}}
  .tb-foot{display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap}
  .tb-btn{border:1.5px solid var(--line,#D3DBCF);background:var(--surface,#fff);color:var(--ink,#152018);border-radius:11px;padding:10px 16px;font:inherit;font-weight:800;font-size:15px;cursor:pointer}
  .tb-btn.primary{background:var(--brand,#2C6B3E);border-color:var(--brand,#2C6B3E);color:var(--on-brand,#fff)}
  .tm-scrim{position:fixed;inset:0;z-index:90;background:rgba(6,12,8,.5)}
  .tm-sheet{position:fixed;z-index:91;left:0;right:0;bottom:0;margin:0 auto;max-width:520px;max-height:90vh;overflow:auto;background:var(--surface,#fff);color:var(--ink,#152018);border-radius:20px 20px 0 0;padding:18px 18px calc(16px + env(safe-area-inset-bottom,0px));box-shadow:0 -10px 40px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:12px}
  @media (min-width:700px){.tm-sheet{bottom:auto;top:50%;transform:translateY(-50%);border-radius:20px}}
  .tm-sheet h2{font-size:21px;line-height:1.2;margin:0}
  .tm-sheet p{margin:0;color:var(--muted,#5B685E);font-size:14px}
  .tm-opt{display:flex;gap:12px;align-items:flex-start;width:100%;text-align:left;border:1.5px solid var(--line,#D3DBCF);background:var(--surface,#fff);border-radius:14px;padding:14px;cursor:pointer;color:inherit;font:inherit}
  .tm-opt:hover{border-color:var(--brand,#2C6B3E)}
  .tm-opt b{display:block;font-size:16px}
  .tm-opt .s{display:block;color:var(--muted,#5B685E);font-size:13.5px;margin-top:2px;line-height:1.4}
  .tm-ic{flex:none;width:40px;height:40px;border-radius:12px;background:var(--brand-soft,#DCEADB);color:var(--brand-strong,#1F5230);display:grid;place-items:center}
  .tm-ic svg{width:22px;height:22px}
  .tm-close{align-self:center;border:0;background:transparent;color:var(--muted,#5B685E);font:inherit;font-weight:700;font-size:15px;padding:8px 14px;cursor:pointer}
  @media (prefers-reduced-motion:reduce){.tour-hole.tap,.tour-hole.nudge,.tb-spin{animation:none}}`;
  document.head.appendChild(st);
}

function build(){
  injectStyle();
  const root = document.createElement("div");
  root.className = "tour"; root.setAttribute("data-tour-ui", "");
  root.innerHTML = `<div class="tour-dim"></div><div class="tour-hole"></div><div class="tour-block"></div><div class="tour-block"></div><div class="tour-block"></div><div class="tour-block"></div><div class="tour-bubble" role="dialog" aria-live="polite" aria-label="Walkthrough"></div>`;
  document.body.appendChild(root);
  ui = {root, hole: root.querySelector(".tour-hole"), blocks: Array.from(root.querySelectorAll(".tour-block")), bubble: root.querySelector(".tour-bubble")};
  ui.blocks.forEach(b => b.addEventListener("click", nudge));
  ui.bubble.addEventListener("click", e => {
    const b = e.target.closest("[data-tb]"); if(!b || !T) return;
    e.stopPropagation();
    const k = b.dataset.tb;
    if(k === "end") finish();
    else if(k === "next") next();
    else { const x = (T.st.buttons || [])[+k]; if(x) x.run(); }
  });
}
function nudge(){
  if(!ui) return;
  const h = ui.hole; h.classList.remove("nudge"); void h.offsetWidth; h.classList.add("nudge");
  const nb = ui.bubble.querySelector('[data-tb="next"]'); if(nb) nb.focus();
}
function find(sel){
  if(!sel) return null;
  const el = typeof sel === "function" ? sel() : firstShown(sel);
  return el && shown(el) ? el : null;
}
function inFixed(el){
  for(let n = el; n && n !== document.body; n = n.parentElement){ const p = getComputedStyle(n).position; if(p === "fixed" || p === "sticky") return true; }
  return false;
}

// fresh: the page was just opened for this tour. Otherwise the driver tour reloads a new practice route first.
function start(key, fresh){
  if(!TOURS[key]) return;
  if(key === "driver" && !(fresh && practice())){ goPractice(); return; }
  closeMenu(); stop();
  T = {key, steps: TOURS[key], i: -1};
  build();
  document.body.classList.add("touring");
  document.addEventListener("click", onDocClick, true);
  document.addEventListener("keydown", onKey);
  window.addEventListener("scroll", onMove, {passive:true});
  window.addEventListener("resize", onMove);
  tickTimer = setInterval(tick, 200);
  next();
}
function stop(){
  clearInterval(tickTimer); tickTimer = null;
  document.removeEventListener("click", onDocClick, true);
  document.removeEventListener("keydown", onKey);
  window.removeEventListener("scroll", onMove);
  window.removeEventListener("resize", onMove);
  if(ui){ ui.root.remove(); ui = null; }
  document.body.classList.remove("touring");
  T = null;
}
function finish(){
  const k = T && T.key;
  stop();
  try{ if(k) localStorage.setItem("lvc-tour-done-" + k, String(Date.now())); }catch(e){}
}
function next(){
  if(!T) return;
  T.i++;
  while(T.i < T.steps.length && T.steps[T.i].skipIf && T.steps[T.i].skipIf()) T.i++;
  if(T.i >= T.steps.length){ finish(); return; }
  const st = T.steps[T.i];
  Object.assign(T, {st, at: Date.now(), tapped:false, tapAt:0, scrolled:false, advancing:false, sig:"", mark:""});
  T.tap = !!val(st.tap);
  T.text = val(st.text);
  if(ui){ ui.hole.style.transition = "left .28s ease, top .28s ease, width .28s ease, height .28s ease"; setTimeout(() => { if(ui) ui.hole.style.transition = ""; }, 320); }
  tick();
}
function onMove(){ if(!raf) raf = requestAnimationFrame(() => { raf = 0; if(T && ui) layout(find(T.st.center ? null : T.st.sel)); }); }
function onKey(e){ if(e.key === "Escape" && T) finish(); }
function onDocClick(e){
  if(!T || !T.tap || T.tapped || (ui && ui.root.contains(e.target))) return;
  const st = T.st, el = find(st.sel);
  if(!el || !el.contains(e.target)) return;
  if(st.tapSel){ const hit = e.target.closest(st.tapSel); if(!hit || !el.contains(hit)) return; }
  if(st.onTap) st.onTap();
  T.tapped = true; T.tapAt = Date.now(); T.sig = "";
  if(!st.until) setTimeout(() => { if(T && T.st === st) next(); }, st.settle || 450);
}
function tick(){
  if(!T || !ui) return;
  const st = T.st;
  if(T.tap && st.until && !T.advancing && st.until()){
    T.advancing = true; T.sig = "";
    setTimeout(() => { if(T && T.st === st) next(); }, st.settle || 450);
  }
  const el = st.center ? null : find(st.sel);
  if(!st.center && !el && st.optional && !T.tapped && Date.now() - T.at > (st.wait || 1200)){ next(); return; }
  if(el && !T.scrolled){
    T.scrolled = true;
    const r = el.getBoundingClientRect(), H = window.innerHeight;
    if(!inFixed(el) && (r.top < 80 || r.bottom > H - 120)){
      const big = r.height > H * 0.45;
      window.scrollTo({top: Math.max(0, window.scrollY + r.top - (big ? 96 : Math.max(96, (H - r.height) / 2 - 40))), behavior:"smooth"});
    }
  }
  layout(el);
}
function setBox(b, x, y, w, h){
  if(w <= 0 || h <= 0){ b.style.display = "none"; return; }
  Object.assign(b.style, {display:"block", left: x + "px", top: y + "px", width: w + "px", height: h + "px"});
}
function layout(el){
  const st = T.st, W = window.innerWidth, H = window.innerHeight;
  let r = null;
  if(el){
    const b = el.getBoundingClientRect(), p = st.pad != null ? st.pad : 6;
    let top = b.top - p, bottom = b.bottom + p;
    if(st.maxH && bottom - top > st.maxH) bottom = top + st.maxH;
    r = {l: Math.max(4, b.left - p), t: Math.max(4, top), r: Math.min(W - 4, b.right + p), b: Math.min(H - 4, bottom)};
    if(r.r - r.l < 14 || r.b - r.t < 14) r = null;
  }
  const free = !st.center && !el && !!st.missingFree && !T.tapped && Date.now() - T.at > 1500;
  ui.root.classList.toggle("nohole", !r);
  ui.root.classList.toggle("free", free);
  if(r) setBox(ui.hole, r.l, r.t, r.r - r.l, r.b - r.t); else ui.hole.style.display = "none";
  ui.hole.classList.toggle("tap", !!(r && T.tap && !T.tapped));
  const B = ui.blocks;
  if(free) B.forEach(b => { b.style.display = "none"; });
  else if(r && T.tap){ setBox(B[0], 0, 0, W, r.t); setBox(B[1], 0, r.b, W, H - r.b); setBox(B[2], 0, r.t, r.l, r.b - r.t); setBox(B[3], r.r, r.t, W - r.r, r.b - r.t); }
  else { setBox(B[0], 0, 0, W, H); B[1].style.display = B[2].style.display = B[3].style.display = "none"; }
  paintBubble(el, r, free);
}
function paintBubble(el, r, free){
  const st = T.st, b = ui.bubble, n = T.steps.length;
  const missing = !st.center && !el;
  const waiting = (T.tapped && !!st.until) || (missing && !free);
  const sig = [T.i, missing, free, T.tapped, T.advancing].join("|");
  if(sig !== T.sig){
    T.sig = sig;
    const text = free ? st.missingText : (waiting && st.waitText && (T.tapped || missing)) ? st.waitText : missing ? "One moment…" : T.text;
    const tapping = T.tap && !T.tapped && !missing;
    const btns = st.buttons
      ? st.buttons.map((x, k) => `<button type="button" class="tb-btn${x.primary ? " primary" : ""}" data-tb="${k}">${esc(x.label)}</button>`).join("")
      : (!T.tap && !missing ? `<button type="button" class="tb-btn primary" data-tb="next">Next</button>` : "");
    b.innerHTML = `<div class="tb-top"><span class="tb-count">Step ${Math.min(T.i + 1, n)} of ${n}</span><button type="button" class="tb-x" data-tb="end">End tour</button></div>
      <div class="tb-bar"><i style="width:${Math.round((T.i + 1) / n * 100)}%"></i></div>
      <h3 class="tb-title">${esc(val(st.title))}</h3>
      <p class="tb-text">${text}</p>
      ${tapping ? `<div class="tb-tap">${HAND}<span>${esc(st.tapHint || "Tap the highlighted part to keep going")}</span></div>` : ""}
      ${waiting && !T.advancing ? `<div class="tb-wait"><span class="tb-spin"></span><span>Waiting…</span></div>` : ""}
      ${btns ? `<div class="tb-foot">${btns}</div>` : ""}`;
  }
  const W = window.innerWidth, H = window.innerHeight, bw = Math.min(380, W - 24), m = 12;
  b.style.width = bw + "px";
  const bh = b.offsetHeight;
  let top, left;
  if(!r){ left = (W - bw) / 2; top = free ? 70 : (H - bh) / 2; }
  else {
    left = Math.min(W - bw - m, Math.max(m, (r.l + r.r) / 2 - bw / 2));
    if(H - r.b - 20 >= bh + m) top = r.b + m;               // below the highlight
    else if(r.t - 16 >= bh + m) top = r.t - m - bh;        // above it
    else top = (r.t + r.b) / 2 > H / 2 ? 16 : H - bh - 20; // no room: the side away from it
  }
  b.style.left = Math.round(left) + "px";
  b.style.top = Math.round(Math.max(12, Math.min(top, H - bh - 12))) + "px";
}

/* ---------- menu ---------- */
function closeMenu(){ qa(".tm-scrim,.tm-sheet").forEach(n => n.remove()); }
function menu(auto){
  injectStyle(); closeMenu();
  if(T) stop();
  const ic = n => api && api.ic ? api.ic(n) : "";
  const opts = [{key:"driver", icon:"truck", title:"New driver walkthrough",
    sub: practice() ? "Start the practice route over and tap through every screen, step by step. About 3 minutes."
                    : "Practice on a pretend route and tap through every screen. Nothing is saved or texted. About 3 minutes."}];
  if(ownerCanTest()) opts.push({key:"owner", icon:"nav", title:"Test-drive a route yourself",
    sub:"Make a TEST route around you and drive it with the full-screen directions, like your drivers will. No texts go out."});
  const scrim = document.createElement("div"); scrim.className = "tm-scrim";
  const sheet = document.createElement("div"); sheet.className = "tm-sheet"; sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "Walkthroughs");
  sheet.innerHTML = `<div><h2>${auto ? "Welcome! Want a quick walkthrough?" : "Walkthroughs"}</h2>
    <p style="margin-top:4px">${auto ? "Pick one to learn the app by tapping through it. You can open these again from <b>Tutorial</b> at the top." : "Learn the app by tapping through it, step by step."}</p></div>
    ${opts.map(o => `<button type="button" class="tm-opt" data-tour-start="${o.key}"><span class="tm-ic">${ic(o.icon)}</span><span><b>${esc(o.title)}</b><span class="s">${esc(o.sub)}</span></span></button>`).join("")}
    <button type="button" class="tm-close" data-tour-close>${auto ? "Not now" : "Close"}</button>`;
  scrim.addEventListener("click", closeMenu);
  sheet.addEventListener("click", e => {
    const s = e.target.closest("[data-tour-start]"); if(s){ start(s.dataset.tourStart); return; }
    if(e.target.closest("[data-tour-close]")) closeMenu();
  });
  document.body.appendChild(scrim); document.body.appendChild(sheet);
  const first = sheet.querySelector(".tm-opt"); if(first && window.innerWidth > 640) first.focus();
}

// The driver walkthrough always starts on a fresh practice route.
function goPractice(){
  const p = new URLSearchParams(location.search);
  if(!p.has("live")) p.set("live", "");
  p.set("practice", ""); p.set("tour", "driver");
  const url = location.pathname + "?" + p.toString().replace(/=(?=&|$)/g, "") + "#driver";
  const go = () => {
    if(url.split("#")[0] === (location.pathname + location.search)){ location.hash = "#driver"; location.reload(); }
    else location.href = url;
  };
  const L = LIVE();
  if(L && L.flush && !L.practice) Promise.resolve(L.flush()).catch(() => {}).finally(go); else go();
}

// Called once the app has drawn its first screen.
function ready(){
  if(practice() && params.get("tour") === "driver"){
    const p = new URLSearchParams(location.search); p.delete("tour");
    history.replaceState(null, "", location.pathname + "?" + p.toString().replace(/=(?=&|$)/g, "") + location.hash);
    setTimeout(() => start("driver", true), 500);
    return;
  }
  if(!LIVE() || practice()) return;
  let seen = false; try{ seen = !!localStorage.getItem(OFFER_KEY); }catch(e){}
  if(seen) return;
  try{ localStorage.setItem(OFFER_KEY, String(Date.now())); }catch(e){}
  setTimeout(() => { if(!T && !q(".drawer.on")) menu(true); }, 700);
}

window.LVC_TOUR = {attach(a){ api = a; }, ready, menu, start, finish, get running(){ return T ? T.key : null; }};
})();
