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
const NAV_STYLE = "mapbox://styles/mapbox/navigation-day-v1";
const PIN = {regular:"#1E8E3E", new:"#E37400", final:"#D93025", done:"#9AA0A6", issue:"#A50E0E", dark:"#202124", blue:"#1A73E8"};
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
  .live-card{max-width:440px;margin:24px auto}
  .gpin{position:relative;width:28px;height:38px;filter:drop-shadow(0 2px 2px rgba(0,0,0,.3))}
  .gpin svg{width:100%;height:100%;display:block}
  .gpin span{position:absolute;left:0;right:0;top:5px;text-align:center;color:#fff;font:700 12px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif}
  .gpin.cur{width:38px;height:51px}
  .gpin.cur span{top:8px;font-size:15px}
  .gsq{width:24px;height:24px;border-radius:7px;color:#fff;font:700 12px/20px system-ui,-apple-system,sans-serif;text-align:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)}
  .gsq.start{border-radius:50%}
  .me-dot{width:20px;height:20px;border-radius:50%;background:#1A73E8;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.12),0 1px 5px rgba(0,0,0,.35);position:relative}
  .me-dot::after{content:"";position:absolute;inset:-14px;border-radius:50%;background:rgba(26,115,232,.22);animation:lvc-pulse 2s ease-out infinite}
  @keyframes lvc-pulse{0%{transform:scale(.35);opacity:1}100%{transform:scale(1.3);opacity:0}}
  @media (prefers-reduced-motion:reduce){.me-dot::after{animation:none;opacity:.6}}
  .navbox{border-radius:18px;overflow:hidden;border:1px solid var(--line);background:var(--surface);box-shadow:var(--shadow)}
  .nav-banner{display:flex;gap:12px;align-items:center;background:#0B6E3A;color:#fff;padding:12px 14px;min-height:78px}
  .navbox.arrived .nav-banner{background:#1A73E8}
  .nb-icon{flex:none;width:58px;display:flex;flex-direction:column;align-items:center;gap:3px}
  .nb-icon svg{width:38px;height:38px}
  .nb-dist{font-size:14px;font-weight:800;white-space:nowrap}
  .nb-text{min-width:0}
  .nb-instr{font-size:19px;font-weight:800;line-height:1.2;overflow-wrap:anywhere}
  .nb-sub{font-size:13px;opacity:.92;margin-top:3px;font-weight:600;overflow-wrap:anywhere}
  .nav-map-wrap{position:relative}
  .navbox .gl-map.nav-map{height:min(52vh,440px);border-radius:0}
  .nav-recenter{position:absolute;left:10px;bottom:34px;z-index:2;display:flex;gap:6px;align-items:center;background:#fff;color:#1A73E8;border:0;border-radius:999px;padding:9px 15px;font-weight:800;font-size:14px;box-shadow:0 1px 6px rgba(0,0,0,.3);cursor:pointer}
  .nav-recenter[hidden]{display:none}
  .nav-recenter svg{width:16px;height:16px}
  .nav-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px}
  .nf-eta{display:flex;flex-direction:column;min-width:0}
  .nf-eta b{font-size:21px;color:var(--brand-strong);line-height:1.15}
  .nf-eta span{font-size:13px;color:var(--muted);font-weight:600}
  .nf-go{flex:none}`;
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
    screen(`<h2>Sign in</h2><p class="muted">We'll email you a sign-in code. Enter it here to sign in.</p>
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
  const starts = ui.routeStarts || {}; // where a route was started from, saved on this device only
  Object.keys(starts).forEach(id => { const p = starts[id]; if(S.routes[id] && p && isFinite(p.lat) && isFinite(p.lng)) S.routes[id].liveStart = p; });
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
  if(cur && !first){
    next.seenConfirmations = cur.seenConfirmations; next.driverId = cur.driverId; next.driverRouteId = cur.driverRouteId;
    Object.keys(next.routes).forEach(id => { const o = cur.routes && cur.routes[id]; if(o && o.liveStart && !next.routes[id].liveStart) next.routes[id].liveStart = o.liveStart; });
  }
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
// Nearest real street address to a point (used for test routes).
async function reverseGeocode(p){
  if(!CFG.mapboxToken) return null;
  const qs = new URLSearchParams({longitude: Number(p.lng).toFixed(6), latitude: Number(p.lat).toFixed(6), types:"address", limit:"1", country:"us"});
  if(CFG.permanentGeocoding) qs.set("permanent", "true");
  const j = await mbx("https://api.mapbox.com/search/geocode/v6/reverse?" + qs);
  const f = j.features && j.features[0]; if(!f || !f.properties) return null;
  const pr = f.properties, cx = pr.context || {};
  const xy = pr.coordinates && isFinite(pr.coordinates.longitude) ? [pr.coordinates.longitude, pr.coordinates.latitude] : (f.geometry && f.geometry.coordinates);
  const address = pr.name || String(pr.full_address || "").split(",")[0];
  if(!xy || !address) return null;
  const place = cx.place && cx.place.name, region = cx.region && (cx.region.region_code || cx.region.name), zip = cx.postcode && cx.postcode.name;
  const city = place ? place + (region ? ", " + region : "") + (zip ? " " + zip : "") : String(pr.place_formatted || "").replace(/, United States$/, "");
  return {address, city, lat: xy[1], lng: xy[0]};
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
  const anchor = fixed.length ? S.customers[fixed[fixed.length-1].cid] : api.routeStart(S, rt);
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
    const pts = [(rt.liveStart ? api.routeStart(S, rt) : api.startPoint(S, c.driverId || rt.driverId)), ...rt.stops.filter(x => x.status !== "pending").map(x => S.customers[x.cid]).filter(Boolean), S.facility];
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
  const st = api.routeStart(S, rt);
  const cur = rt.status === "active" ? rt.stops.findIndex(x => x.status === "pending") : -1;
  const pins = [];
  rt.stops.forEach((x, i) => {
    const c = S.customers[x.cid]; if(!c || !isFinite(c.lat) || !isFinite(c.lng)) return;
    const color = x.status === "done" ? PIN.done : x.status === "issue" ? PIN.issue : (PIN[x.type] || PIN.regular);
    pins.push({kind:"stop", lng:c.lng, lat:c.lat, label: x.status === "done" ? "✓" : x.status === "issue" ? "!" : String(i + 1), color, cur: i === cur, title: c.name + (c.address ? " · " + c.address : "")});
  });
  pins.push({kind:"facility", lng:S.facility.lng, lat:S.facility.lat, label:"F", color:PIN.dark, title:S.facility.name});
  if(st !== S.facility) pins.push({kind:"start", lng:st.lng, lat:st.lat, label:"S", color: st.here ? PIN.blue : PIN.dark, title: st.here ? "Where you started" : "Start"});
  const pts = [st, ...rt.stops.map(x => S.customers[x.cid]).filter(Boolean), S.facility];
  return {pins, pts};
}
function lineFeature(coords){ return {type:"Feature", geometry:{type:"LineString", coordinates:coords}, properties:{}}; }
function pinEl(p){
  const el = document.createElement("div");
  el.title = p.title || "";
  if(p.kind !== "stop"){ el.className = "gsq " + p.kind; el.style.background = p.color; el.textContent = p.label; return el; }
  el.className = "gpin" + (p.cur ? " cur" : "");
  el.innerHTML = `<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 38.6S27.6 24.7 27.6 14.6A12.6 12.6 0 0 0 2.4 14.6C2.4 24.7 15 38.6 15 38.6z" fill="${p.color}" stroke="#fff" stroke-width="2"/></svg><span>${esc(p.label)}</span>`;
  return el;
}
// Draws map pins as HTML markers (teardrop pins with the stop number, like Google Maps).
function setPins(m, pins){
  const sig = JSON.stringify(pins.map(p => [p.kind, p.label, p.color, !!p.cur, +Number(p.lat).toFixed(5), +Number(p.lng).toFixed(5)]));
  if(m.pinSig === sig) return; m.pinSig = sig;
  (m.markers || []).forEach(mk => mk.remove());
  m.markers = pins.slice().sort((a, b) => (a.cur ? 1 : 0) - (b.cur ? 1 : 0))
    .map(p => new window.mapboxgl.Marker({element: pinEl(p), anchor: p.kind === "stop" ? "bottom" : "center"}).setLngLat([p.lng, p.lat]).addTo(m.map));
}
// The driver's own location: a blue dot, like Google Maps.
let here = null, geoErr = 0;
function placeMe(m){
  if(!m.map || !here) return;
  if(!m.me){ const el = document.createElement("div"); el.className = "me-dot"; el.title = "You"; m.me = new window.mapboxgl.Marker({element: el}); }
  m.me.setLngLat([here.lng, here.lat]);
  if(!m.meOn){ m.me.addTo(m.map); m.meOn = true; }
}
function addLineLayers(map, src){
  map.addLayer({id:src + "-case", type:"line", source:src, layout:{"line-join":"round", "line-cap":"round"}, paint:{"line-color":"#1557B0", "line-width":9, "line-opacity":0.95}});
  map.addLayer({id:src + "-line", type:"line", source:src, layout:{"line-join":"round", "line-cap":"round"}, paint:{"line-color":"#4285F4", "line-width":5.5}});
}
function drawRoute(m, rt){
  const S = api.S(); if(!m.ready || !rt) return;
  const g = routeGeo(S, rt);
  setPins(m, g.pins); placeMe(m);
  const fitSig = g.pts.map(ptKey).sort().join(";");
  if(m.fitSig !== fitSig){
    m.fitSig = fitSig;
    const b = new window.mapboxgl.LngLatBounds(); g.pts.forEach(p => b.extend([p.lng, p.lat]));
    m.map.fitBounds(b, {padding:{top:50, bottom:30, left:36, right:36}, duration:0, maxZoom:15});
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
  const m = {el: slot, map, ready:false, fitSig:"", lineSig:"", pinSig:"", markers:[]};
  maps.set(id, m);
  while(maps.size > 6){ const [oldId, old] = maps.entries().next().value; old.map.remove(); maps.delete(oldId); }
  map.on("load", () => {
    map.addSource("line", {type:"geojson", data: lineFeature([])});
    addLineLayers(map, "line");
    m.ready = true;
    drawRoute(m, api.S().routes[id]);
  });
}

/* ---------- driving view: Google Maps-style directions to the next stop ---------- */
const navs = new Map(); // route id -> nav state (one live map per route, kept across re-renders)
const SVG = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const TURN = {
  straight:'<path d="M12 21V4M6 10l6-6 6 6"/>',
  right:'<path d="M6 21v-8a4 4 0 0 1 4-4h10M15 4l5 5-5 5"/>',
  left:'<path d="M18 21v-8a4 4 0 0 0-4-4H4M9 4 4 9l5 5"/>',
  slightRight:'<path d="M8 21v-7l9-9M10 5h7v7"/>',
  slightLeft:'<path d="M16 21v-7L7 5M14 5H7v7"/>',
  uturn:'<path d="M7 21V9a5 5 0 0 1 10 0v6M13 11l4 4 4-4"/>',
  round:'<circle cx="12" cy="10" r="5"/><path d="M12 15v6M17 10h3"/>',
  arrive:'<path d="M12 21s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>'
};
const RECENTER = SVG('<path d="M12 2 4.5 20.5 12 17l7.5 3.5z"/>');
function turnIcon(st){
  const m = st.mod || "", t = st.type || "";
  if(t === "arrive") return SVG(TURN.arrive);
  if(t === "roundabout" || t === "rotary" || t === "roundabout turn") return SVG(TURN.round);
  if(/uturn/.test(m)) return SVG(TURN.uturn);
  if(m === "right" || m === "sharp right") return SVG(TURN.right);
  if(m === "left" || m === "sharp left") return SVG(TURN.left);
  if(m === "slight right") return SVG(TURN.slightRight);
  if(m === "slight left") return SVG(TURN.slightLeft);
  return SVG(TURN.straight);
}
function shortSt(t){
  return String(t || "")
    .replace(/\b(West|East|North|South)\b(?= [A-Z0-9])/g, w => w[0])
    .replace(/ (Road|Street|Avenue|Boulevard|Drive|Lane|Parkway|Court|Highway|Circle|Place|Terrace)\b/g, (x, w) => " " + ({Road:"Rd", Street:"St", Avenue:"Ave", Boulevard:"Blvd", Drive:"Dr", Lane:"Ln", Parkway:"Pkwy", Court:"Ct", Highway:"Hwy", Circle:"Cir", Place:"Pl", Terrace:"Ter"})[w]);
}
function havM(a, b){
  const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const x = Math.sin(dLat/2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
// How far (meters) a point is from a route line.
function offLine(line, p){
  if(!line || line.length < 2) return 0;
  const kx = 111320 * Math.cos(p.lat * Math.PI / 180), ky = 110540;
  let best = Infinity;
  for(let i = 0; i < line.length - 1; i++){
    const ax = (line[i][0] - p.lng) * kx, ay = (line[i][1] - p.lat) * ky, bx = (line[i+1][0] - p.lng) * kx, by = (line[i+1][1] - p.lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx*dx + dy*dy;
    const t = L ? Math.max(0, Math.min(1, -(ax*dx + ay*dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + t*dx, ay + t*dy));
  }
  return best;
}
function fmtDist(m){
  const ft = m * 3.28084;
  if(ft < 1000) return (ft < 100 ? Math.max(10, Math.round(ft / 10) * 10) : Math.round(ft / 50) * 50) + " ft";
  const mi = m / 1609.344;
  return (mi < 10 ? mi.toFixed(1) : Math.round(mi)) + " mi";
}
async function navDirections(from, to){
  const coords = `${from.lng.toFixed(6)},${from.lat.toFixed(6)};${Number(to.lng).toFixed(6)},${Number(to.lat).toFixed(6)}`;
  const j = await mbx(`https://api.mapbox.com/directions/v5/mapbox/driving-traffic/${coords}?steps=true&geometries=geojson&overview=full`);
  if(j.code !== "Ok" || !j.routes || !j.routes[0]) throw new Error("Directions " + j.code);
  const r = j.routes[0], leg = r.legs[0] || {steps:[]};
  const steps = leg.steps.map(x => ({instr: x.maneuver.instruction || "", type: x.maneuver.type || "", mod: x.maneuver.modifier || "", dist: x.distance || 0, loc: {lng: x.maneuver.location[0], lat: x.maneuver.location[1]}}));
  return {duration: r.duration, distance: r.distance, line: r.geometry.coordinates, steps, from: {lat: from.lat, lng: from.lng}};
}
// Meters and seconds left, from where the driver is now.
function remaining(n){
  const st = n.res.steps, k = Math.min(n.k, st.length - 1);
  let m = here ? havM(here, st[k].loc) : 0;
  for(let i = k; i < st.length; i++) m += st[i].dist;
  m = Math.min(m, n.res.distance || m);
  const secs = n.res.distance ? n.res.duration * (m / n.res.distance) : n.res.duration;
  return {m, secs};
}
function bannerHtml(n, t){
  const where = esc(t.address || t.name || "the next stop");
  if(n && n.arrived) return `<div class="nb-icon">${SVG(TURN.arrive)}</div><div class="nb-text"><div class="nb-instr">You're here</div><div class="nb-sub">${where}. Take the photo below.</div></div>`;
  if(!here) return `<div class="nb-icon">${SVG(TURN.straight)}</div><div class="nb-text"><div class="nb-instr">Head to ${esc(shortSt(t.address ? t.address.split(",")[0] : t.name))}</div><div class="nb-sub">${geoErr === 1 ? "Location is off. Allow it for this site to see your turns here." : "Finding your location…"}</div></div>`;
  if(!n || !n.res || !n.res.fromHere) return `<div class="nb-icon">${SVG(TURN.straight)}</div><div class="nb-text"><div class="nb-instr">Getting directions…</div><div class="nb-sub">${where}</div></div>`;
  const st = n.res.steps, k = Math.min(n.k, st.length - 1), s = st[k], then = st[k + 1];
  const instr = s.type === "arrive" ? "Arrive at " + (t.address ? t.address.split(",")[0] : "the stop") : s.instr;
  return `<div class="nb-icon">${turnIcon(s)}<div class="nb-dist">${fmtDist(havM(here, s.loc))}</div></div>
    <div class="nb-text"><div class="nb-instr">${esc(shortSt(instr))}</div><div class="nb-sub">${then && then.type !== "arrive" ? "Then " + esc(shortSt(then.instr)).replace(/^\w/, c => c.toLowerCase()) : where}</div></div>`;
}
function footHtml(n, t){
  const L = api.navLinks(t);
  let left = `<div class="nf-eta"><b>${esc(t.name || "Next stop")}</b><span>${esc(t.address || "")}</span></div>`;
  if(n && n.res && n.res.fromHere && !n.arrived && here){
    const r = remaining(n), mins = Math.max(1, Math.round(r.secs / 60)), mi = r.m / 1609.344;
    const at = new Date(Date.now() + r.secs * 1000).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
    left = `<div class="nf-eta"><b>${mins} min</b><span>${mi < 0.1 ? "under 0.1" : mi.toFixed(1)} mi · arrive ${esc(at)}</span></div>`;
  }
  return left + `<a class="btn primary nf-go" href="${esc(L.google)}" target="_blank" rel="noopener">${RECENTER}Google Maps</a>`;
}
function navSlot(rt, t){
  if(!CFG.mapboxToken || !t || !isFinite(t.lat) || !isFinite(t.lng)) return null;
  const n = navs.get(rt.id), same = n && n.target && n.target.key === t.key ? n : null;
  return `<div class="navbox" data-gl-nav="${esc(rt.id)}" data-target="${esc(JSON.stringify(t))}">
    <div class="nav-banner" data-nav="banner" aria-live="polite">${bannerHtml(same, t)}</div>
    <div class="nav-map-wrap"><div class="gl-map nav-map" data-nav="map" role="img" aria-label="Map with directions to ${esc(t.name || "the next stop")}"></div><button type="button" class="nav-recenter" data-nav="recenter" hidden>${RECENTER}Re-center</button></div>
    <div class="nav-foot" data-nav="foot">${footHtml(same, t)}</div>
  </div>`;
}
function setTarget(n, t){
  if(!n.target || n.target.key !== t.key){ n.res = null; n.k = 1; n.userMoved = false; n.fitKey = ""; n.arrived = false; n.failAt = 0; }
  n.target = t;
}
function updateNavUI(n){
  if(!n.el || !n.target) return;
  const b = n.el.querySelector('[data-nav="banner"]'), f = n.el.querySelector('[data-nav="foot"]');
  if(b) b.innerHTML = bannerHtml(n, n.target);
  if(f) f.innerHTML = footHtml(n, n.target);
  n.el.classList.toggle("arrived", !!n.arrived);
}
function drawNav(n){
  if(!n.ready) return;
  const t = n.target;
  setPins(n, [t.key === "facility" ? {kind:"facility", lng:t.lng, lat:t.lat, label:"F", color:PIN.dark, title:t.name} : {kind:"stop", lng:t.lng, lat:t.lat, label:t.label, color:PIN[t.type] || PIN.regular, cur:true, title:t.name}]);
  n.map.getSource("nav").setData(lineFeature(n.res ? n.res.line : []));
  placeMe(n);
}
function wantRoute(n){
  if(n.busy || n.arrived) return false;
  if(n.failAt && Date.now() - n.failAt < 15000) return false;
  if(!n.res || n.res.key !== n.target.key) return !!(here || n.target.from);
  if(!here) return false;
  if(!n.res.fromHere) return true;
  const since = Date.now() - n.reqAt, moved = havM(here, n.res.from);
  if(moved > 500) return true;
  if(since > 30000 && moved > 50) return true;
  if(since > 8000 && offLine(n.res.line, here) > 70) return true;
  return false;
}
async function fetchNav(n){
  const t = n.target, from = here ? {lat:here.lat, lng:here.lng} : t.from;
  if(!from) return;
  n.busy = true; n.reqAt = Date.now();
  try{
    const r = await navDirections(from, t);
    if(!n.target || n.target.key !== t.key) return;
    r.key = t.key; r.fromHere = !!here; n.res = r; n.k = 1; n.failAt = 0;
    drawNav(n); updateNavUI(n); navCamera(n, false);
  }catch(e){ console.warn("directions", e); n.failAt = Date.now(); }
  finally{ n.busy = false; }
}
// Camera: while driving it follows you, pointed the way you're going; stopped, it shows you and the stop.
function navCamera(n, force){
  if(!n.ready || (n.userMoved && !force)) return;
  const t = n.target, map = n.map;
  if(here && here.speed != null && here.speed > 3 && !n.arrived){
    map.easeTo({center:[here.lng, here.lat], zoom:16.3, pitch:50, bearing: here.heading != null ? here.heading : map.getBearing(), duration:1000, essential:true});
    n.fitKey = ""; return;
  }
  const pts = [t]; if(here) pts.push(here); else if(t.from) pts.push(t.from);
  const key = pts.map(p => Number(p.lat).toFixed(3) + "," + Number(p.lng).toFixed(3)).join(";") + (n.res ? "|" + n.res.line.length : "");
  if(!force && key === n.fitKey) return;
  n.fitKey = key;
  const b = new window.mapboxgl.LngLatBounds(); pts.forEach(p => b.extend([p.lng, p.lat]));
  if(n.res && n.res.line) n.res.line.forEach(c => b.extend(c));
  const cam = map.cameraForBounds(b, {padding:{top:60, bottom:40, left:40, right:40}, maxZoom:16});
  if(cam) map.easeTo(Object.assign(cam, {pitch:0, bearing:0, duration: force ? 700 : 450, essential:true}));
}
function navTick(n, force){
  if(!n.ready || !n.el || !n.el.isConnected) return;
  placeMe(n);
  if(here && n.res && n.res.fromHere){ while(n.k < n.res.steps.length - 1 && havM(here, n.res.steps[n.k].loc) < 30) n.k++; }
  n.arrived = !!(here && havM(here, n.target) < 60);
  updateNavUI(n);
  if(wantRoute(n)) fetchNav(n);
  navCamera(n, force);
}
async function mountNav(slot){
  const id = slot.dataset.glNav;
  let t; try{ t = JSON.parse(slot.dataset.target); }catch(e){ return; }
  let n = navs.get(id);
  if(n){
    slot.replaceWith(n.el); setTarget(n, t);
    if(n.ready){ n.map.resize(); drawNav(n); navTick(n, true); } else updateNavUI(n);
    return;
  }
  slot.dataset.glMounted = "1";
  n = {id, el: slot, target: null, res: null, busy:false, reqAt:0, k:1, userMoved:false, ready:false, fitKey:"", pinSig:"", markers:[]};
  navs.set(id, n);
  while(navs.size > 3){ const [oid, o] = navs.entries().next().value; if(o.map) o.map.remove(); navs.delete(oid); }
  setTarget(n, t);
  await loadGL();
  const map = new window.mapboxgl.Map({container: slot.querySelector('[data-nav="map"]'), style: NAV_STYLE, center:[t.lng, t.lat], zoom:13, attributionControl:true, cooperativeGestures:true});
  n.map = map;
  map.addControl(new window.mapboxgl.NavigationControl({showCompass:true, visualizePitch:true}), "top-right");
  const rc = slot.querySelector('[data-nav="recenter"]');
  rc.addEventListener("click", () => { n.userMoved = false; rc.hidden = true; navCamera(n, true); });
  const userMove = e => { if(e && e.originalEvent){ n.userMoved = true; rc.hidden = false; } };
  ["dragstart", "zoomstart", "rotatestart", "pitchstart"].forEach(ev => map.on(ev, userMove));
  map.on("load", () => {
    map.addSource("nav", {type:"geojson", data: lineFeature([])});
    addLineLayers(map, "nav");
    n.ready = true;
    drawNav(n); navTick(n, true);
  });
}
// Keep the screen on while the driving view is open (like a GPS app).
let wake = null;
async function keepAwake(on){
  try{
    if(on && !wake && navigator.wakeLock && document.visibilityState === "visible"){ wake = await navigator.wakeLock.request("screen"); wake.addEventListener("release", () => { wake = null; }); }
    else if(!on && wake){ const w = wake; wake = null; await w.release(); }
  }catch(e){}
}
document.addEventListener("visibilitychange", () => { if(document.visibilityState === "visible" && document.querySelector(".navbox")) keepAwake(true); });
function onHere(pos){
  here = pos; geoErr = 0;
  maps.forEach(m => { if(m.ready && m.el.isConnected) placeMe(m); });
  navs.forEach(n => navTick(n, false));
}
function onHereError(code){ geoErr = code; navs.forEach(n => { if(n.el && n.el.isConnected) updateNavUI(n); }); }
function afterRender(){
  if(!CFG.mapboxToken) return;
  document.querySelectorAll("[data-gl-route]:not([data-gl-mounted])").forEach(slot => { mount(slot).catch(e => { console.warn(e); slot.innerHTML = `<p class="muted" style="padding:16px">Map didn't load.</p>`; }); });
  document.querySelectorAll("[data-gl-nav]:not([data-gl-mounted])").forEach(slot => { mountNav(slot).catch(e => { console.warn(e); const box = slot.querySelector('[data-nav="map"]'); if(box) box.innerHTML = `<p class="muted" style="padding:16px">Map didn't load.</p>`; }); });
  keepAwake(!!document.querySelector(".navbox"));
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
  const routeStarts = {};
  S.routeList.forEach(id => { const r = S.routes[id]; if(r && r.liveStart && r.status !== "done") routeStarts[id] = r.liveStart; });
  try{ localStorage.setItem(localKey(), JSON.stringify({seenConfirmations:S.seenConfirmations, driverId:S.driverId, driverRouteId:S.driverRouteId, routeStarts})); }catch(e){}
  if(!biz) return;
  dirty = true; schedule(500);
}
async function flush(){ if(timer){ clearTimeout(timer); await runSync(); } let n = 0; while(syncing && n++ < 50) await sleep(100); }

window.LVC_LIVE = {
  attach(a){ api = a; }, start, save, mapSlot, navSlot, afterRender, legMiles, flush, reverseGeocode, onHere, onHereError,
  get ready(){ return !!biz; }, get role(){ return role; }
};
})();
