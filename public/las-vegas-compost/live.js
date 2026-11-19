/*
 * Las Vegas Compost routes: live mode.
 * Only runs when the page is opened with ?live in the address. Without it the page stays the
 * sample-data demo and this file does nothing.
 *
 * Data lives in Supabase (one database, many businesses; row-level security keeps each
 * business's rows to its own signed-in members). Maps, address lookup, drive times and
 * mileage come from Mapbox. Keys are not in this repo: they come from live-config.js, which
 * the build writes from environment variables (see supabase/README.md).
 */
(function(){
"use strict";
const params = new URLSearchParams(location.search);
if(!params.has("live")) return;

const CFG = Object.assign({supabaseUrl:"", supabaseKey:"", mapboxToken:"", permanentGeocoding:false}, window.LVC_CONFIG || {});
const SB_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.118.0/dist/umd/supabase.js";
const GL_JS = "https://cdn.jsdelivr.net/npm/mapbox-gl@3.34.1/dist/mapbox-gl.js";
const GL_CSS = "https://cdn.jsdelivr.net/npm/mapbox-gl@3.34.1/dist/mapbox-gl.css";
const MAP_STYLE = "mapbox://styles/mapbox/streets-v12";
const VEGAS = {lng:-115.15, lat:36.17};
const BUCKET = "stop-photos";
const COLORS = {brand:"#2C6B3E", ink:"#152018", amber:"#9A6500", amberSoft:"#FCEBC4", clay:"#A5412A", claySoft:"#F7DDD5", white:"#FFFFFF"};
const TABLES = ["facilities","drivers","routes","customers","route_stops","messages","route_runs"];
const PK = {facilities:["id"], drivers:["id"], routes:["id"], customers:["id"], route_stops:["route_id","customer_id"], messages:["id"], route_runs:["id"]};

let api = null, sb = null, user = null, biz = null, role = null;
let last = {};                 // table -> Map(key -> JSON of the row as last saved)
let lastSettings = "";
let timer = null, syncing = false, dirty = false, failCount = 0, reloadTimer = null, lastLoad = 0;
const signedUrls = new Map();  // storage path -> signed url
const legCache = new Map();    // "lat,lng>lat,lng" -> meters
const matrixCache = new Map(); // point-set signature -> {dur, dist}
const refined = new Map();     // route id -> order signature after the last drive-time pass
const dirCache = new Map();    // coords -> {meters, line}
const maps = new Map();        // route id -> {el, map, ready, fitSig, lineSig}

/* ---------- small helpers ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const iso = ms => ms ? new Date(ms).toISOString() : null;
const ms = t => t ? Date.parse(t) : null;
const ptKey = p => Number(p.lat).toFixed(5) + "," + Number(p.lng).toFixed(5);
const keyOf = (t, r) => PK[t].map(k => r[k]).join("|");
const sleep = n => new Promise(r => setTimeout(r, n));
function loadScript(src){ return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Couldn't load " + src)); document.head.appendChild(s); }); }
function loadCss(href){ if(document.querySelector(`link[href="${href}"]`)) return; const l = document.createElement("link"); l.rel = "stylesheet"; l.href = href; document.head.appendChild(l); }
const isManager = () => role === "owner" || role === "admin";
const localKey = () => "lvc-live-ui-" + (biz ? biz.id : "x");
function uiLocal(){ try{ return JSON.parse(localStorage.getItem(localKey()) || "{}"); }catch(e){ return {}; } }
function toast(t, b, i){ if(api) api.toast(t, b || "", i || "alert"); }

/* ---------- banner and screens ---------- */
function injectStyle(){
  const st = document.createElement("style");
  st.textContent = `
  body.live [data-act="sample-photo"], body.live [data-act="import-sample"], body.live [data-act="reset"]{display:none!important}
  .gl-map{width:100%;border-radius:var(--r-sm);overflow:hidden;background:var(--map-bg)}
  .gl-map .mapboxgl-ctrl-logo{transform:scale(.85);transform-origin:left bottom}
  .live-bar{display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap}
  .live-bar button{margin-left:4px}
  .live-sync{opacity:.85;font-variant-numeric:tabular-nums}
  .live-card{max-width:440px;margin:24px auto}`;
  document.head.appendChild(st);
}
function banner(){
  const el = $(".demo-banner"); if(!el) return;
  if(!user){ el.innerHTML = `<span>Las Vegas Compost routes</span>`; return; }
  el.innerHTML = `<div class="live-bar"><span>${esc(biz ? biz.name : "Las Vegas Compost")} · signed in as ${esc(user.email || "")}</span><span class="live-sync" id="live-sync"></span><button type="button" id="live-out">Sign out</button></div>`;
  $("#live-out").onclick = async () => { await flush(); await sb.auth.signOut(); location.hash = ""; location.reload(); };
}
function syncLabel(t){ const el = $("#live-sync"); if(el) el.textContent = t ? "· " + t : ""; }
function screen(html){
  document.body.classList.remove("driver-mode");
  document.querySelectorAll("[data-nav],[data-tabs],[data-role-switch]").forEach(n => { n.innerHTML = ""; });
  const v = $("#view"); if(v) v.innerHTML = `<div class="card pad stack live-card">${html}</div>`;
}
function setupMissing(){
  screen(`<h2>Live mode isn't set up here yet</h2><p class="muted">This copy of the site was built without the Supabase settings. The sample demo still works without <b>?live</b> in the address.</p>`);
}

function signInScreen(){
  return new Promise(resolve => {
    screen(`<h2>Sign in</h2><p class="muted">We'll email you a sign-in code. You can also tap the link in that email on this device.</p>
      <form id="lv-email" class="stack"><div class="field"><label for="lv-em">Email</label><input class="input" id="lv-em" type="email" required autocomplete="email" inputmode="email"></div><button class="btn primary" type="submit">Email me a code</button></form>
      <form id="lv-code" class="stack" hidden><div class="field"><label for="lv-otp">Code from the email</label><input class="input" id="lv-otp" required autocomplete="one-time-code" inputmode="numeric" pattern="[0-9]{6,10}" maxlength="10"></div><button class="btn primary" type="submit">Sign in</button><button class="btn ghost" type="button" id="lv-back">Use a different email</button></form>
      <p class="hint" id="lv-msg" aria-live="polite"></p>`);
    const msg = t => { $("#lv-msg").textContent = t; };
    let email = "";
    $("#lv-email").onsubmit = async e => {
      e.preventDefault(); email = $("#lv-em").value.trim().toLowerCase(); if(!email) return;
      msg("Sending…");
      const {error} = await sb.auth.signInWithOtp({email, options:{shouldCreateUser:true, emailRedirectTo: location.origin + location.pathname + location.search}});
      if(error){ msg(error.message || "Couldn't send the email. Try again in a minute."); return; }
      $("#lv-email").hidden = true; $("#lv-code").hidden = false; msg("Check " + email + " for the code."); $("#lv-otp").focus();
    };
    $("#lv-back").onclick = () => { $("#lv-email").hidden = false; $("#lv-code").hidden = true; msg(""); };
    $("#lv-code").onsubmit = async e => {
      e.preventDefault(); msg("Checking…");
      const {data, error} = await sb.auth.verifyOtp({email, token: $("#lv-otp").value.trim(), type:"email"});
      if(error || !data.session){ msg((error && error.message) || "That code didn't work. Check it, or send a new one."); return; }
      resolve(data.session);
    };
    const {data: sub} = sb.auth.onAuthStateChange((ev, session) => { if(ev === "SIGNED_IN" && session){ sub.subscription.unsubscribe(); resolve(session); } });
  });
}

/* ---------- start ---------- */
async function start(){
  injectStyle(); document.body.classList.add("live"); banner();
  if(!CFG.supabaseUrl || !CFG.supabaseKey){ setupMissing(); return false; }
  screen(`<p class="muted">Loading…</p>`);
  try{ await loadScript(SB_JS); }catch(e){ screen(`<h2>Couldn't load</h2><p class="muted">Check the connection and reload.</p>`); return false; }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:true}});
  let {data:{session}} = await sb.auth.getSession();
  if(!session) session = await signInScreen();
  user = session.user;
  const {error: invErr} = await sb.rpc("accept_invites");
  if(invErr) console.warn("accept_invites", invErr);
  const {data: list, error} = await sb.from("businesses").select("id,slug,name,settings").order("name");
  if(error){ screen(`<h2>Couldn't load your business</h2><p class="muted">${esc(error.message)}</p>`); return false; }
  if(!list.length){
    banner();
    screen(`<h2>No business on this account yet</h2><p class="muted">You're signed in as ${esc(user.email)}, but this email hasn't been added to a business. Ask the owner to add you, then reload.</p>`);
    return false;
  }
  const want = params.get("live");
  biz = list.find(b => b.slug === want) || list.find(b => b.id === localStorage.getItem("lvc-live-biz")) || list[0];
  try{ localStorage.setItem("lvc-live-biz", biz.id); }catch(e){}
  const {data: mem} = await sb.from("business_members").select("role").eq("business_id", biz.id).eq("user_id", user.id).maybeSingle();
  role = mem ? mem.role : "driver";
  banner();
  await reload(true);
  if(role === "driver" && !location.hash){ location.hash = "#driver"; }
  subscribe();
  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && Date.now() - lastLoad > 30000) scheduleReload(0); });
  window.addEventListener("beforeunload", e => { if(syncing || dirty || timer){ e.preventDefault(); e.returnValue = ""; } });
  return true;
}

/* ---------- load ---------- */
async function fetchAll(table, order){
  const out = []; const page = 1000;
  for(let from = 0; ; from += page){
    let qy = sb.from(table).select("*").eq("business_id", biz.id);
    if(order) qy = qy.order(order[0], {ascending: order[1]});
    const {data, error} = await qy.range(from, from + page - 1);
    if(error) throw error;
    out.push(...data);
    if(data.length < page || (table === "messages" && out.length >= 2000) || (table === "route_runs" && out.length >= 1000)) break;
  }
  return out;
}
async function fetchState(){
  const [bz, facilities, drivers, routes, customers, stops, messages, runs] = await Promise.all([
    sb.from("businesses").select("id,slug,name,settings").eq("id", biz.id).single(),
    fetchAll("facilities"), fetchAll("drivers", ["sort_order", true]), fetchAll("routes", ["sort_order", true]),
    fetchAll("customers"), fetchAll("route_stops", ["position", true]), fetchAll("messages", ["at", false]), fetchAll("route_runs", ["run_date", false])
  ]);
  if(bz.error) throw bz.error;
  biz = bz.data;
  const rows = {facilities, drivers, routes, customers, route_stops: stops, messages, route_runs: runs};
  await signPhotos(rows);
  return rows;
}
function buildState(rows){
  const ui = uiLocal();
  const set = biz.settings || {};
  const f = rows.facilities[0] || {id:"f1", name:"Facility", short_name:"Facility", address:"", city:"", lat:VEGAS.lat, lng:VEGAS.lng};
  const S = {
    v:4, live:true,
    facility: {id:f.id, name:f.name, short:f.short_name || f.name, address:f.address || "", city:f.city || "", lat:f.lat, lng:f.lng},
    drivers:{}, customers:{}, routes:{}, routeList:[], texts:[], history:[], confirmations:[],
    settings: {reminderOn: set.reminderOn !== false, reminderTime: set.reminderTime || "19:00", onTheWay: set.onTheWay || "next", templates: Object.assign({}, set.templates || {})},
    seenConfirmations: ui.seenConfirmations || 0, driverId: ui.driverId || null, driverRouteId: ui.driverRouteId || null
  };
  rows.drivers.forEach(d => { S.drivers[d.id] = {id:d.id, name:d.name, phone:d.phone || "", color:d.color || COLORS.brand, owner:!!d.is_owner, start:d.start || {kind:"facility"}}; });
  if(!S.driverId || !S.drivers[S.driverId]){ const mine = rows.drivers.find(d => d.user_id === user.id); S.driverId = mine && role === "driver" ? mine.id : null; }
  rows.customers.forEach(c => { S.customers[c.id] = {id:c.id, name:c.name, phone:c.phone || "", address:c.address || "", city:c.city || "", lat:c.lat ?? VEGAS.lat, lng:c.lng ?? VEGAS.lng, gate:c.gate_code || "", notes:c.notes || "", freq:c.frequency || "Weekly", routeId:c.route_id || null}; });
  rows.routes.forEach(r => { S.routes[r.id] = {id:r.id, name:r.name, driverId:r.driver_id, status:r.status, bucketsLoaded:r.buckets_loaded, facilityDone:r.facility_done, startedAt:ms(r.started_at), endedAt:ms(r.ended_at), stops:[]}; S.routeList.push(r.id); });
  rows.route_stops.forEach(x => { const rt = S.routes[x.route_id]; if(rt && S.customers[x.customer_id]) rt.stops.push({cid:x.customer_id, type:x.stop_type, status:x.status, photo:photoIn(x.photo), doneAt:ms(x.done_at), issue:x.issue}); });
  rows.messages.slice().reverse().forEach(m => { const t = {id:m.id, kind:m.kind, at:ms(m.at), body:m.body || ""}; if(m.customer_id) t.cid = m.customer_id; t.photo = photoIn(m.photo); if(m.recipient_count != null) t.count = m.recipient_count; S.texts.push(t); });
  rows.route_runs.slice().reverse().forEach(r => {
    const base = {id:r.id, routeId:r.route_id, routeName:r.route_name, driverId:r.driver_id, date:ms(r.run_date), total:r.total, ok:r.ok, issues:r.issues, miles:Number(r.miles) || 0};
    if(r.kind === "history") S.history.push(Object.assign(base, {photos: r.photos || []}));
    else S.confirmations.push(Object.assign(base, {endedAt:ms(r.ended_at), livePhotos:(r.photos || []).map(p => ({photo:photoIn(p.photo), cid:p.cid, at:p.at}))}));
  });
  return S;
}
function snapshot(S){
  const rows = rowsFrom(S); last = {};
  TABLES.forEach(t => { last[t] = new Map(rows[t].map(r => [keyOf(t, r), JSON.stringify(r)])); });
  lastSettings = JSON.stringify(S.settings);
}
async function reload(first){
  if(syncing || dirty || timer){ scheduleReload(1500); return; }
  let rows;
  try{ rows = await fetchState(); }catch(e){ console.error(e); if(first){ screen(`<h2>Couldn't load your data</h2><p class="muted">${esc(e.message || e)}</p>`); throw e; } return; }
  if(!first && (syncing || dirty || timer)){ scheduleReload(1500); return; }
  lastLoad = Date.now();
  const next = buildState(rows);
  const cur = api.S();
  if(!first && cur && JSON.stringify(dataOnly(cur)) === JSON.stringify(dataOnly(next))) return;
  if(cur && !first){ next.seenConfirmations = cur.seenConfirmations; next.driverId = cur.driverId; next.driverRouteId = cur.driverRouteId; }
  api.setS(next); snapshot(next);
  if(!first){ const a = document.activeElement; if(!(a && a.closest && a.closest("#view") && /INPUT|TEXTAREA|SELECT/.test(a.tagName))) api.render(); }
}
function dataOnly(S){ const r = rowsFrom(S); r.settings = S.settings; return r; }
function scheduleReload(delay){ clearTimeout(reloadTimer); reloadTimer = setTimeout(() => reload(false), delay); }
function subscribe(){
  const ch = sb.channel("biz-" + biz.id);
  ["routes","route_stops","messages","route_runs","customers"].forEach(t => ch.on("postgres_changes", {event:"*", schema:"public", table:t, filter:"business_id=eq." + biz.id}, () => scheduleReload(1200)));
  ch.subscribe();
}

/* ---------- photos ---------- */
function photoIn(p){
  if(!p) return null;
  if(p.kind === "storage") return {kind:"url", path:p.path, src: signedUrls.get(p.path) || ""};
  return p;
}
function photoOut(p){
  if(!p) return null;
  if(p.kind === "url") return {kind:"storage", path:p.path};
  if(p.kind === "data") return null; // not uploaded yet (never sent as a data URL)
  return p;
}
async function signPhotos(rows){
  const paths = new Set();
  const add = p => { if(p && p.kind === "storage" && !signedUrls.has(p.path)) paths.add(p.path); };
  rows.route_stops.forEach(x => add(x.photo)); rows.messages.forEach(m => add(m.photo));
  rows.route_runs.forEach(r => (r.photos || []).forEach(p => add(p && p.photo)));
  const list = [...paths];
  for(let i = 0; i < list.length; i += 100){
    const {data, error} = await sb.storage.from(BUCKET).createSignedUrls(list.slice(i, i + 100), 60*60*24*7);
    if(error){ console.warn(error); continue; }
    data.forEach(d => { if(d.signedUrl) signedUrls.set(d.path, d.signedUrl); });
  }
}
async function uploadPhotos(S){
  const pending = new Set();
  const visit = p => { if(p && p.kind === "data" && p.src) pending.add(p); };
  Object.values(S.routes).forEach(rt => rt.stops.forEach(x => visit(x.photo)));
  S.texts.forEach(t => visit(t.photo));
  S.confirmations.forEach(c => (c.livePhotos || []).forEach(lp => visit(lp.photo)));
  for(const p of pending){
    const blob = await (await fetch(p.src)).blob();
    const day = new Date().toISOString().slice(0, 10);
    const path = `${biz.id}/${day}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const {error} = await sb.storage.from(BUCKET).upload(path, blob, {contentType: blob.type || "image/jpeg", upsert:false});
    if(error) throw error;
    const src = p.src; p.kind = "url"; p.path = path; p.src = src; // keep showing the local copy until the next load
  }
}

/* ---------- Mapbox: addresses, drive times, directions ---------- */
async function mbx(url){
  const r = await fetch(url + (url.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(CFG.mapboxToken));
  if(!r.ok) throw new Error("Mapbox " + r.status);
  return r.json();
}
async function geocode(address, city){
  if(!CFG.mapboxToken || !address) return null;
  const base = {q: [address, city].filter(Boolean).join(", "), proximity: VEGAS.lng + "," + VEGAS.lat, country:"us", limit:"1"};
  if(CFG.permanentGeocoding) base.permanent = "true";
  for(const types of ["address", ""]){
    const qs = new URLSearchParams(Object.assign({}, base, types ? {types} : {}));
    const j = await mbx("https://api.mapbox.com/search/geocode/v6/forward?" + qs);
    const f = j.features && j.features[0];
    if(f && f.geometry){ const [lng, lat] = f.geometry.coordinates; return {lat, lng}; }
  }
  return null;
}
async function geocodePending(S){
  if(!CFG.mapboxToken) return false;
  const jobs = [];
  Object.values(S.customers).forEach(c => { if(c._geocode) jobs.push({o:c, addr:c.address, city:c.city, label:c.name}); });
  Object.values(S.drivers).forEach(d => { if(d._geocode && d.start && d.start.kind === "home") jobs.push({o:d.start, owner:d, addr:d.start.address, city:d.start.city, label:d.name}); });
  if(!jobs.length) return false;
  const missed = [];
  for(let i = 0; i < jobs.length; i += 5){
    await Promise.all(jobs.slice(i, i + 5).map(async j => {
      try{ const g = await geocode(j.addr, j.city); if(g){ j.o.lat = g.lat; j.o.lng = g.lng; } else missed.push(j.label); }
      catch(e){ console.warn(e); missed.push(j.label); }
      delete (j.owner || j.o)._geocode;
    }));
  }
  Object.values(S.routes).forEach(rt => { if(rt.status === "ready") api.optimizeRoute(S, rt); });
  if(missed.length) toast("Couldn't place " + missed.length + " address" + (missed.length > 1 ? "es" : "") + " on the map", missed.slice(0, 3).join(", ") + (missed.length > 3 ? "…" : "") + ". Check the street and city.", "pin");
  return true;
}
// Drive-time matrix for any number of points, asked for in blocks of up to 24 coordinates.
async function matrix(points){
  const n = points.length, C = 12;
  const dur = Array.from({length:n}, () => new Array(n).fill(null)), dist = Array.from({length:n}, () => new Array(n).fill(null));
  const blocks = []; for(let i = 0; i < n; i += C) blocks.push([...Array(Math.min(C, n - i)).keys()].map(k => k + i));
  for(const A of blocks) for(const B of blocks){
    const same = A === B, idx = same ? A : A.concat(B);
    const coords = idx.map(i => points[i].lng.toFixed(6) + "," + points[i].lat.toFixed(6)).join(";");
    const src = same ? "all" : A.map((_, k) => k).join(";"), dst = same ? "all" : B.map((_, k) => k + A.length).join(";");
    const j = await mbx(`https://api.mapbox.com/directions-matrix/v1/mapbox/driving/${coords}?sources=${src}&destinations=${dst}&annotations=duration,distance`);
    if(j.code !== "Ok") throw new Error("Matrix " + j.code);
    A.forEach((ai, r) => B.forEach((bi, c) => { dur[ai][bi] = j.durations[r][c]; dist[ai][bi] = j.distances[r][c]; }));
    await sleep(120);
  }
  for(let i = 0; i < n; i++) for(let k = 0; k < n; k++) if(i !== k && dist[i][k] != null) legCache.set(ptKey(points[i]) + ">" + ptKey(points[k]), dist[i][k]);
  return {dur, dist};
}
async function refineRoute(S, rt){
  const fixed = rt.stops.filter(x => x.status !== "pending"), free = rt.stops.filter(x => x.status === "pending");
  if(free.length < 3) return false;
  const anchor = fixed.length ? S.customers[fixed[fixed.length-1].cid] : api.startPoint(S, rt.driverId);
  // points in a fixed order (by customer id) so a cached matrix lines up whatever the stop order is
  const canon = free.slice().sort((a, b) => a.cid < b.cid ? -1 : a.cid > b.cid ? 1 : 0);
  const pts = [anchor, ...canon.map(x => S.customers[x.cid]), S.facility];
  if(pts.some(p => !p || !isFinite(p.lat) || !isFinite(p.lng))) return false;
  const setSig = [ptKey(anchor), ptKey(S.facility), ...canon.map(x => x.cid + "@" + ptKey(S.customers[x.cid]))].join(";");
  const orderSig = setSig + "#" + free.map(x => x.cid).join(",");
  if(refined.get(rt.id) === orderSig) return false;
  let M = matrixCache.get(setSig);
  if(!M){ M = await matrix(pts); matrixCache.set(setSig, M); }
  const n = pts.length, BIG = 1e9, d = (a, b) => M.dur[a][b] ?? BIG;
  const cost = ord => { let s = d(0, ord[0]); for(let i = 1; i < ord.length; i++) s += d(ord[i-1], ord[i]); return s + d(ord[ord.length-1], n-1); };
  let ord = free.map(x => canon.indexOf(x) + 1), best = cost(ord), improved = true, guard = 0;
  while(improved && guard++ < 40){
    improved = false;
    for(let i = 0; i < ord.length - 1; i++) for(let k = i + 1; k < ord.length; k++){
      const cand = ord.slice(0, i).concat(ord.slice(i, k + 1).reverse(), ord.slice(k + 1)); const c = cost(cand);
      if(c < best - 1){ ord = cand; best = c; improved = true; }
    }
    for(let i = 0; i < ord.length; i++) for(let k = 0; k < ord.length; k++){
      if(i === k) continue; const cand = ord.slice(); const [x] = cand.splice(i, 1); cand.splice(k, 0, x); const c = cost(cand);
      if(c < best - 1){ ord = cand; best = c; improved = true; }
    }
  }
  // the route may have changed while we waited for Mapbox
  const nowFree = rt.stops.filter(x => x.status === "pending");
  if(nowFree.length !== free.length || nowFree.some((x, i) => x !== free[i])) return false;
  const next = ord.map(i => canon[i - 1]);
  rt.stops = fixed.concat(next);
  refined.set(rt.id, setSig + "#" + next.map(x => x.cid).join(","));
  return next.some((x, i) => x !== free[i]);
}
async function refineRoutes(S){
  if(!CFG.mapboxToken) return false;
  let changed = false;
  for(const id of S.routeList){
    const rt = S.routes[id]; if(!rt || rt.status !== "ready") continue;
    try{ if(await refineRoute(S, rt)) changed = true; }catch(e){ console.warn("drive-time order skipped", e); }
  }
  return changed;
}
async function directions(points){
  const out = {meters:0, line:[]};
  for(let i = 0; i < points.length - 1; i += 24){
    const part = points.slice(i, i + 25); if(part.length < 2) break;
    const coords = part.map(p => p.lng.toFixed(6) + "," + p.lat.toFixed(6)).join(";");
    let r = dirCache.get(coords);
    if(!r){
      const j = await mbx(`https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?geometries=geojson&overview=full`);
      if(j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error("Directions " + j.code);
      r = {meters: j.routes[0].distance, line: j.routes[0].geometry.coordinates}; dirCache.set(coords, r);
    }
    out.meters += r.meters; out.line.push(...r.line);
  }
  return out;
}
// Mileage for routes finished on this device: measured along the roads, in the order driven.
async function fixRunMiles(S){
  if(!CFG.mapboxToken || !last.route_runs) return false;
  let changed = false;
  for(const c of S.confirmations){
    if(last.route_runs.has(c.id) || c._miles) continue;
    c._miles = true;
    const rt = S.routes[c.routeId]; if(!rt) continue;
    const pts = [api.startPoint(S, c.driverId || rt.driverId), ...rt.stops.filter(x => x.status !== "pending").map(x => S.customers[x.cid]).filter(Boolean), S.facility];
    try{ const r = await directions(pts); c.miles = Math.round(r.meters / 1609.344 * 10) / 10; changed = true; }catch(e){ console.warn("mileage kept as estimate", e); }
  }
  return changed;
}
function legMiles(a, b){
  if(!a || !b) return null;
  const m = legCache.get(ptKey(a) + ">" + ptKey(b));
  return m == null ? null : m / 1609.344;
}

/* ---------- maps ---------- */
let glLoading = null;
function loadGL(){ if(!glLoading){ loadCss(GL_CSS); glLoading = loadScript(GL_JS).then(() => { window.mapboxgl.accessToken = CFG.mapboxToken; }); } return glLoading; }
function mapSlot(route, opts){
  if(!CFG.mapboxToken) return null;
  const h = (opts && opts.h) || 380;
  return `<div class="map gl-map" data-gl-route="${esc(route.id)}" style="aspect-ratio:640/${h}" role="img" aria-label="Map of ${esc(route.name)} route with ${route.stops.length} stops"></div>`;
}
function routeGeo(S, rt){
  const st = api.startPoint(S, rt.driverId);
  const cur = rt.status === "active" ? rt.stops.findIndex(x => x.status === "pending") : -1;
  const feats = rt.stops.map((x, i) => {
    const c = S.customers[x.cid]; if(!c) return null;
    let fill = COLORS.white, stroke = COLORS.brand, text = COLORS.brand;
    if(x.type === "new"){ fill = COLORS.amberSoft; stroke = COLORS.amber; text = COLORS.amber; }
    if(x.type === "final"){ fill = COLORS.claySoft; stroke = COLORS.clay; text = COLORS.clay; }
    if(x.status === "done"){ fill = COLORS.brand; stroke = COLORS.brand; text = COLORS.white; }
    if(x.status === "issue"){ fill = COLORS.clay; stroke = COLORS.clay; text = COLORS.white; }
    return {type:"Feature", geometry:{type:"Point", coordinates:[c.lng, c.lat]}, properties:{label:String(i + 1), fill, stroke, text, r: i === cur ? 12 : 9}};
  }).filter(Boolean);
  feats.push({type:"Feature", geometry:{type:"Point", coordinates:[S.facility.lng, S.facility.lat]}, properties:{label:"F", fill:COLORS.ink, stroke:COLORS.ink, text:COLORS.white, r:10, name:S.facility.short || "Facility"}});
  if(st !== S.facility) feats.push({type:"Feature", geometry:{type:"Point", coordinates:[st.lng, st.lat]}, properties:{label:"S", fill:COLORS.ink, stroke:COLORS.ink, text:COLORS.white, r:10, name:"Start"}});
  const pts = [st, ...rt.stops.map(x => S.customers[x.cid]).filter(Boolean), S.facility];
  return {points:{type:"FeatureCollection", features:feats}, pts};
}
function lineFeature(coords){ return {type:"Feature", geometry:{type:"LineString", coordinates:coords}, properties:{}}; }
function drawRoute(m, rt){
  const S = api.S(); if(!m.ready || !rt) return;
  const g = routeGeo(S, rt);
  m.map.getSource("pts").setData(g.points);
  const fitSig = g.pts.map(ptKey).sort().join(";");
  if(m.fitSig !== fitSig){
    m.fitSig = fitSig;
    const b = new window.mapboxgl.LngLatBounds(); g.pts.forEach(p => b.extend([p.lng, p.lat]));
    m.map.fitBounds(b, {padding:36, duration:0, maxZoom:15});
  }
  const lineSig = g.pts.map(ptKey).join(";");
  if(m.lineSig !== lineSig){
    m.lineSig = lineSig;
    m.map.getSource("line").setData(lineFeature(g.pts.map(p => [p.lng, p.lat])));
    directions(g.pts).then(r => { if(m.lineSig === lineSig) m.map.getSource("line").setData(lineFeature(r.line)); }).catch(e => console.warn("route line kept straight", e));
  }
}
async function mount(slot){
  const id = slot.dataset.glRoute;
  const have = maps.get(id);
  if(have){ slot.replaceWith(have.el); have.map.resize(); drawRoute(have, api.S().routes[id]); maps.delete(id); maps.set(id, have); return; }
  slot.dataset.glMounted = "1";
  await loadGL();
  const map = new window.mapboxgl.Map({container: slot, style: MAP_STYLE, center:[VEGAS.lng, VEGAS.lat], zoom:10, attributionControl:true, cooperativeGestures:true});
  map.addControl(new window.mapboxgl.NavigationControl({showCompass:false}), "top-right");
  const m = {el: slot, map, ready:false, fitSig:"", lineSig:""};
  maps.set(id, m);
  while(maps.size > 6){ const [oldId, old] = maps.entries().next().value; old.map.remove(); maps.delete(oldId); }
  map.on("load", () => {
    map.addSource("line", {type:"geojson", data: lineFeature([])});
    map.addSource("pts", {type:"geojson", data:{type:"FeatureCollection", features:[]}});
    map.addLayer({id:"line", type:"line", source:"line", layout:{"line-join":"round", "line-cap":"round"}, paint:{"line-color":COLORS.brand, "line-width":4, "line-opacity":0.75}});
    map.addLayer({id:"dots", type:"circle", source:"pts", paint:{"circle-radius":["get","r"], "circle-color":["get","fill"], "circle-stroke-color":["get","stroke"], "circle-stroke-width":2}});
    map.addLayer({id:"nums", type:"symbol", source:"pts", layout:{"text-field":["get","label"], "text-size":11, "text-font":["DIN Pro Medium","Arial Unicode MS Regular"], "text-allow-overlap":true, "text-ignore-placement":true}, paint:{"text-color":["get","text"]}});
    map.addLayer({id:"names", type:"symbol", source:"pts", filter:["has","name"], layout:{"text-field":["get","name"], "text-size":12, "text-offset":[0,1.5], "text-anchor":"top", "text-font":["DIN Pro Medium","Arial Unicode MS Regular"]}, paint:{"text-color":COLORS.ink, "text-halo-color":COLORS.white, "text-halo-width":1.5}});
    m.ready = true;
    drawRoute(m, api.S().routes[id]);
  });
}
function afterRender(){
  if(!CFG.mapboxToken) return;
  document.querySelectorAll("[data-gl-route]:not([data-gl-mounted])").forEach(slot => { mount(slot).catch(e => { console.warn(e); slot.innerHTML = `<p class="muted" style="padding:16px">Map didn't load.</p>`; }); });
}

/* ---------- save ---------- */
function rowsFrom(S){
  const b = biz.id, R = {};
  const f = S.facility;
  R.facilities = [{business_id:b, id:f.id || "f1", name:f.name, short_name:f.short || null, address:f.address || null, city:f.city || null, lat:f.lat ?? null, lng:f.lng ?? null}];
  R.drivers = Object.values(S.drivers).map((d, i) => ({business_id:b, id:d.id, name:d.name, phone:d.phone || null, color:d.color || null, is_owner:!!d.owner, start:d.start || {kind:"facility"}, sort_order:i}));
  R.routes = S.routeList.filter(id => S.routes[id]).map((id, i) => { const r = S.routes[id]; return {business_id:b, id, name:r.name, driver_id:r.driverId || null, status:r.status, buckets_loaded:!!r.bucketsLoaded, facility_done:!!r.facilityDone, started_at:iso(r.startedAt), ended_at:iso(r.endedAt), sort_order:i}; });
  R.customers = Object.values(S.customers).map(c => ({business_id:b, id:c.id, name:c.name, phone:c.phone || null, address:c.address || null, city:c.city || null, lat:c.lat ?? null, lng:c.lng ?? null, gate_code:c.gate || null, notes:c.notes || null, frequency:c.freq || null, route_id:(c.routeId && S.routes[c.routeId]) ? c.routeId : null}));
  R.route_stops = [];
  S.routeList.forEach(id => { const r = S.routes[id]; if(!r) return; r.stops.forEach((x, i) => { if(S.customers[x.cid]) R.route_stops.push({business_id:b, route_id:id, customer_id:x.cid, position:i, stop_type:x.type, status:x.status, photo:photoOut(x.photo), done_at:iso(x.doneAt), issue:x.issue || null}); }); });
  R.messages = S.texts.map(t => ({business_id:b, id:t.id, kind:t.kind, customer_id:t.cid || null, at:iso(t.at) || new Date().toISOString(), body:t.body || null, photo:photoOut(t.photo), recipient_count:t.count ?? null}));
  R.route_runs = S.history.map(h => ({business_id:b, id:h.id, kind:"history", route_id:h.routeId || null, route_name:h.routeName || null, driver_id:h.driverId || null, run_date:iso(h.date), ended_at:null, total:h.total ?? null, ok:h.ok ?? null, issues:h.issues ?? null, miles:h.miles ?? null, photos:h.photos || null}))
    .concat(S.confirmations.map(c => ({business_id:b, id:c.id, kind:"confirmation", route_id:c.routeId || null, route_name:c.routeName || null, driver_id:c.driverId || null, run_date:iso(c.date), ended_at:iso(c.endedAt), total:c.total ?? null, ok:c.ok ?? null, issues:c.issues ?? null, miles:c.miles ?? null, photos:(c.livePhotos || []).map(p => ({photo:photoOut(p.photo), cid:p.cid, at:p.at}))})));
  return R;
}
const ORDER = ["facilities","drivers","routes","customers","route_stops","messages","route_runs"];
async function pushDiff(S){
  const rows = rowsFrom(S), manager = isManager();
  if(manager && JSON.stringify(S.settings) !== lastSettings){
    const {error} = await sb.from("businesses").update({settings:S.settings}).eq("id", biz.id);
    if(error) throw error; lastSettings = JSON.stringify(S.settings);
  }
  const plan = {};
  ORDER.forEach(t => {
    const prev = last[t] || new Map(), now = new Map(rows[t].map(r => [keyOf(t, r), r]));
    const changed = [], added = [], removed = [];
    now.forEach((r, k) => { const j = JSON.stringify(r); if(!prev.has(k)) added.push(r); else if(prev.get(k) !== j) changed.push(r); });
    prev.forEach((j, k) => { if(!now.has(k)) removed.push(JSON.parse(j)); });
    plan[t] = {changed, added, removed};
  });
  // deletes first, children before parents (a stop moving routes is a delete plus an insert)
  for(const t of ORDER.slice().reverse()){
    for(const r of plan[t].removed){
      let qy = sb.from(t).delete().eq("business_id", biz.id); PK[t].forEach(k => { qy = qy.eq(k, r[k]); });
      const {error} = await qy; if(error) throw error;
      last[t].delete(keyOf(t, r));
    }
  }
  for(const t of ORDER){
    const {changed, added} = plan[t];
    if(!changed.length && !added.length) continue;
    if(manager){
      const all = added.concat(changed);
      for(let i = 0; i < all.length; i += 500){ const {error} = await sb.from(t).upsert(all.slice(i, i + 500)); if(error) throw error; }
    } else {
      if(added.length){ const {error} = await sb.from(t).insert(added); if(error) throw error; }
      for(const r of changed){
        let qy = sb.from(t).update(r).eq("business_id", biz.id); PK[t].forEach(k => { qy = qy.eq(k, r[k]); });
        const {error} = await qy; if(error) throw error;
      }
    }
    if(!last[t]) last[t] = new Map();
    added.concat(changed).forEach(r => last[t].set(keyOf(t, r), JSON.stringify(r)));
  }
}
async function runSync(){
  timer = null;
  if(syncing){ dirty = true; return; }
  syncing = true; dirty = false; syncLabel("Saving…");
  try{
    const S = api.S(); let rerender = false;
    await uploadPhotos(S);
    if(await geocodePending(S)) rerender = true;
    if(isManager() && await refineRoutes(S)) rerender = true;
    if(await fixRunMiles(S)) rerender = true;
    await pushDiff(S);
    failCount = 0; syncLabel("Saved");
    if(rerender) api.render();
  }catch(e){
    console.error("save failed", e); failCount++;
    const denied = e && (e.code === "42501" || /row-level security|permission/i.test(e.message || ""));
    syncLabel(denied ? "Not saved" : "Not saved, retrying");
    if(failCount === 1 || denied) toast(denied ? "This change wasn't saved" : "Couldn't save just now", denied ? "Your account can't change that. Ask the owner." : "Check the connection. It will keep trying.", "alert");
    if(!denied) dirty = true;
  }finally{
    syncing = false;
    if(dirty) schedule(Math.min(30000, 1500 * Math.max(1, failCount)));
  }
}
function schedule(delay){ clearTimeout(timer); timer = setTimeout(runSync, delay); }
function save(S){
  try{ localStorage.setItem(localKey(), JSON.stringify({seenConfirmations:S.seenConfirmations, driverId:S.driverId, driverRouteId:S.driverRouteId})); }catch(e){}
  if(!biz) return;
  dirty = true; schedule(500);
}
async function flush(){ if(timer){ clearTimeout(timer); await runSync(); } let n = 0; while(syncing && n++ < 50) await sleep(100); }

window.LVC_LIVE = {
  attach(a){ api = a; }, start, save, mapSlot, afterRender, legMiles, flush,
  get ready(){ return !!biz; }, get role(){ return role; }
};
})();
