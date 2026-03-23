import { useState, useEffect, useRef, useCallback, useMemo, Component } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area } from "recharts";
import SocialAgentsView from "./SocialAgents.jsx";
import MortgagePOSView from "./components/MortgagePOS.jsx";

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
const SB_URL = "https://sfelhasepvaoianyuvxe.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmZWxoYXNlcHZhb2lhbnl1dnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODY0NDcsImV4cCI6MjA4NjI2MjQ0N30.kNzRAcdXaHoo0xQnJwNXyqcFsSiUZj9PP1fwziEQkdc";
const SBH = { "Content-Type":"application/json", apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, Prefer:"return=representation" };

async function sb(table, method="GET", body=null, query="") {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, {
      method, headers:SBH, ...(body?{body:JSON.stringify(body)}:{})
    });
    if (!r.ok) { const e=await r.text(); console.error(`SB ${method} ${table}:`,e); return null; }
    const t = await r.text(); return t ? JSON.parse(t) : null;
  } catch(e) { console.error(e); return null; }
}

async function sbStorage(path, file) {
  const r = await fetch(`${SB_URL}/storage/v1/object/vault-documents/${path}`, {
    method:"POST", headers:{ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, "Content-Type":file.type, "x-upsert":"true" }, body:file
  });
  if (!r.ok) return null;
  return `${SB_URL}/storage/v1/object/public/vault-documents/${path}`;
}

// ─── AUTH ─────────────────────────────────────────────────────────────────────
async function authSignIn(email, password) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/token?grant_type=password`, {
      method:"POST", headers:{"Content-Type":"application/json",apikey:SB_KEY},
      body:JSON.stringify({email,password})
    });
    const d = await r.json();
    if (!r.ok) return {error:d.error_description||d.msg||"Login failed"};
    return {session:{access_token:d.access_token,refresh_token:d.refresh_token,user:d.user}};
  } catch(e) { return {error:"Network error"}; }
}

async function authGetUser(token) {
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:`Bearer ${token}`}
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function authSignOut(token) {
  try {
    await fetch(`${SB_URL}/auth/v1/logout`, {
      method:"POST", headers:{"Content-Type":"application/json",apikey:SB_KEY,Authorization:`Bearer ${token}`}
    });
  } catch {}
}

// ─── TEAM HELPERS ────────────────────────────────────────────────────────────
async function fetchTeamProfile(userId) {
  return sb("vault_team","GET",null,`?user_id=eq.${userId}&limit=1`).then(r=>r?.[0]||null);
}
async function fetchAllTeam() {
  return sb("vault_team","GET",null,"?order=created_at");
}
async function inviteTeamMember(email, displayName, role, invitedBy) {
  // 1. Create auth user via Supabase signup
  const tempPass = "Vault" + Math.random().toString(36).slice(2,8) + "!";
  const r = await fetch(`${SB_URL}/auth/v1/signup`, {
    method:"POST", headers:{"Content-Type":"application/json",apikey:SB_KEY},
    body:JSON.stringify({email, password:tempPass})
  });
  const d = await r.json();
  if (!r.ok) return {error:d.msg||d.error_description||"Signup failed"};
  const userId = d.id || d.user?.id;
  if (!userId) return {error:"No user ID returned"};
  // 2. Confirm email via RPC
  await fetch(`${SB_URL}/rest/v1/rpc/confirm_user_email`, {
    method:"POST", headers:{...SBH}, body:JSON.stringify({target_email:email})
  });
  // 3. Insert vault_team row
  await sb("vault_team","POST",{user_id:userId, email, display_name:displayName, role, invited_by:invitedBy, status:"active"});
  return {tempPass, userId};
}
async function updateTeamMember(id, patch) {
  return sb("vault_team","PATCH",patch,`?id=eq.${id}`);
}

// ─── n8n PROXY (all API keys live server-side in n8n) ─────────────────────────
const N8N_BASE = "https://n8n.srv1257040.hstgr.cloud/webhook";

async function n8nPost(path, body={}) {
  try {
    const r = await fetch(`${N8N_BASE}/${path}`, {
      method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)
    });
    if (!r.ok) { console.error(`n8n ${path}:`, r.status); return null; }
    return await r.json();
  } catch(e) { console.error(`n8n ${path}:`,e); return null; }
}

// ── LOCAL CACHE HELPER ───────────────────────────────────────────────────────
function lsCache(key, ttlMs=1800000) { // default 30 min
  try {
    const raw = localStorage.getItem("vc_"+key);
    if (!raw) return null;
    const {data,exp} = JSON.parse(raw);
    if (Date.now() > exp) { localStorage.removeItem("vc_"+key); return null; }
    return data;
  } catch { return null; }
}
function lsSet(key, data, ttlMs=1800000) {
  try { localStorage.setItem("vc_"+key, JSON.stringify({data, exp:Date.now()+ttlMs})); } catch {}
}

// ── FRED via n8n (cached 30 min) ─────────────────────────────────────────────
async function fetchFRED(seriesId, limit=26) {
  const ck = `fred_${seriesId}_${limit}`;
  const cached = lsCache(ck);
  if (cached) return cached;
  try {
    const d = await n8nPost("fred", { seriesId, limit });
    if (!d?.observations) return null;
    const obs = d.observations.filter(o=>o.value!==".");
    if (!obs.length) return null;
    const latest = parseFloat(obs[0].value);
    const prev   = parseFloat(obs[1]?.value||obs[0].value);
    const history = [...obs].reverse().map(o=>({ date:o.date, value:parseFloat(o.value) }));
    const result = { latest, prev, change:+(latest-prev).toFixed(3), history, date:obs[0].date };
    lsSet(ck, result, 1800000); // cache 30 min
    return result;
  } catch(e) { console.error("FRED",seriesId,e); return null; }
}

// ── GNews via n8n (cached 15 min) ────────────────────────────────────────────
async function fetchGNews(query, max=8) {
  const ck = `gnews_${query}_${max}`;
  const cached = lsCache(ck, 900000);
  if (cached) return cached;
  try {
    const d = await n8nPost("gnews", { query, max });
    const result = (d?.articles||[]).map(a=>({ title:a.title, source:a.source?.name||"", url:a.url, published:a.publishedAt, description:a.description||"", image:a.image||null }));
    if (result.length) lsSet(ck, result, 900000); // cache 15 min
    return result;
  } catch(e) { console.error("GNews",e); return []; }
}

// ── Walk Score via n8n ───────────────────────────────────────────────────────
async function fetchWalkScore(address, lat, lon) {
  const ck = `ws_${lat}_${lon}`;
  const cached = lsCache(ck, 3600000);
  if (cached) return cached;
  try {
    const d = await n8nPost("walkscore", { address, lat, lon });
    if (d?.status===1) {
      const result = { walk:d.walkscore, walkDesc:d.description, transit:d.transit?.score||null, transitDesc:d.transit?.description||null, bike:d.bike?.score||null, bikeDesc:d.bike?.description||null };
      lsSet(ck, result, 3600000); // cache 1 hour
      return result;
    }
    return null;
  } catch { return null; }
}

// Walk Score color helper
const wsColor = s => s>=90?"#10b981":s>=70?"#6366f1":s>=50?"#f59e0b":s>=25?"#ef4444":"#555";

// ── FREE APIs (no keys needed) ──────────────────────────────────────────────

// Open-Meteo Weather (free, no key)
async function fetchWeather(lat, lon) {
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&forecast_days=7`);
    return await r.json();
  } catch(e) { console.error("Weather",e); return null; }
}

// Geocode city name to lat/lon (Nominatim, free)
async function geocodeCity(query) {
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=5`);
    return await r.json();
  } catch { return []; }
}

// IP Geolocation (ip-api.com, free)
async function fetchIPGeo(ip) {
  try {
    const url = ip ? `http://json.geoplugin.net/ip/${ip}` : `https://ipapi.co/json/`;
    const r = await fetch(url);
    return await r.json();
  } catch { return null; }
}

// Exchange Rates (open.er-api.com, free)
async function fetchExchangeRates(base="USD") {
  try {
    const r = await fetch(`https://open.er-api.com/v6/latest/${base}`);
    return await r.json();
  } catch { return null; }
}

// QR Code Generator (goqr.me, free)
function qrCodeUrl(text, size=300) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
}

// Crypto Prices (CoinGecko, free)
async function fetchCryptoPrices(coins=["bitcoin","ethereum","solana","dogecoin"]) {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coins.join(",")}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true`);
    return await r.json();
  } catch { return null; }
}

// Public Holidays (Nager.Date, free)
async function fetchHolidays(year, country="US") {
  try {
    const r = await fetch(`https://date.nager.at/api/v3/publicholidays/${year}/${country}`);
    return await r.json();
  } catch { return []; }
}

// Country Data (RestCountries, free)
async function fetchCountryData(name) {
  try {
    const r = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(name)}`);
    return await r.json();
  } catch { return []; }
}

// Random Quote (ZenQuotes, via proxy to avoid CORS)
async function fetchQuote() {
  try {
    const r = await fetch("https://zenquotes.io/api/random");
    const d = await r.json();
    return d?.[0] ? { quote: d[0].q, author: d[0].a } : null;
  } catch { return null; }
}

// URL Shortener (TinyURL, free)
async function shortenUrl(url) {
  try {
    const r = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`);
    return await r.text();
  } catch { return null; }
}

// Wikipedia Summary (free)
async function fetchWikiSummary(term) {
  try {
    const r = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`);
    return await r.json();
  } catch { return null; }
}

// US ZIP Demographics (Zippopotam, free)
async function fetchZipDemographics(zip) {
  try {
    const r = await fetch(`https://api.zippopotam.us/us/${zip}`);
    return await r.json();
  } catch { return null; }
}

// Lorem Picsum (random stock photos, free)
function randomPhotoUrl(w=600, h=400, id) {
  return id ? `https://picsum.photos/id/${id}/${w}/${h}` : `https://picsum.photos/${w}/${h}?random=${Math.random()}`;
}

// Open Library Book Search (free)
async function searchBooks(query) {
  try {
    const r = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=10`);
    return await r.json();
  } catch { return null; }
}

// Carbon Intensity / Sustainability (free)
async function fetchCarbonIntensity() {
  try {
    const r = await fetch("https://api.carbonintensity.org.uk/intensity");
    return await r.json();
  } catch { return null; }
}

// Bored API (random activity suggestions, free)
async function fetchRandomActivity() {
  try {
    const r = await fetch("https://bored-api.appbrewery.com/random");
    return await r.json();
  } catch { return null; }
}

// Dog CEO (random dog pics, free)
async function fetchDogPic() {
  try {
    const r = await fetch("https://dog.ceo/api/breeds/image/random");
    return await r.json();
  } catch { return null; }
}

// Number Facts (Numbers API, free)
async function fetchNumberFact(n) {
  try {
    const r = await fetch(`http://numbersapi.com/${n}/math?json`);
    return await r.json();
  } catch { return null; }
}

// ─── CLAUDE — spend-safe, cached ──────────────────────────────────────────────
const _spend = { calls:0, inputTokens:0, outputTokens:0 };
const _spendListeners = new Set();
const getSpend = () => ({ ..._spend, estUSD:((_spend.inputTokens*3+_spend.outputTokens*15)/1_000_000).toFixed(4) });
const onSpendChange = fn => { _spendListeners.add(fn); return ()=>_spendListeners.delete(fn); };
const _notifySpend = () => _spendListeners.forEach(fn=>fn(getSpend()));

// Simple hash for cache keys
function simpleHash(s) { let h=0; for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;} return "h"+Math.abs(h).toString(36); }

const _claudeCache = {};
async function claude(system, user, max=900) {
  // Cache short prompts (< 500 chars) for 10 min — catches repeat doc descriptions, email parsing
  const cacheKey = (system.length + user.length < 500) ? simpleHash(system+user) : null;
  if (cacheKey && _claudeCache[cacheKey] && Date.now() - _claudeCache[cacheKey].t < 600000) {
    return _claudeCache[cacheKey].v;
  }
  try {
    const d = await n8nPost("claude", { system, user, max_tokens:max });
    if (d?.usage) { _spend.calls++; _spend.inputTokens+=d.usage.input_tokens||0; _spend.outputTokens+=d.usage.output_tokens||0; _notifySpend(); }
    const result = d?.content?.[0]?.text||"";
    if (cacheKey && result) _claudeCache[cacheKey] = {v:result, t:Date.now()};
    return result;
  } catch { return ""; }
}

// ─── CLAUDE WITH PDF DOCUMENT (via n8n) ──────────────────────────────────────
async function claudeWithDoc(system, base64PDF, prompt, max=1200) {
  try {
    const d = await n8nPost("claude-doc", { system, base64PDF, prompt, max_tokens:max });
    if (d?.usage) { _spend.calls++; _spend.inputTokens+=d.usage.input_tokens||0; _spend.outputTokens+=d.usage.output_tokens||0; _notifySpend(); }
    return d?.content?.[0]?.text||"";
  } catch(e) { console.error(e); return ""; }
}

// Reads a File object → base64 string (no data: prefix)
function fileToBase64(file) {
  return new Promise((res,rej)=>{
    const r=new FileReader();
    r.onload=()=>res(r.result.split(",")[1]);
    r.onerror=rej;
    r.readAsDataURL(file);
  });
}

// ─── CROSS-SELL: which group companies could serve this contact? ───────────────
// Returns array of { to_business_name, reason, service, action, priority:"high"|"medium"|"low" }
async function getCrossSellOpportunities(contact, businesses, existingDeals) {
  const linkedBizIds = new Set(existingDeals.filter(d=>d.contact_id===contact.id).map(d=>d.business_id).filter(Boolean));
  const candidates = businesses.filter(b=>b.id&&!linkedBizIds.has(b.id));
  if (!candidates.length) return [];
  const sys = `You are a cross-sell analyst for a group of companies. Given a contact profile and a list of companies the group owns, identify which companies could genuinely serve this person. Respond STRICT JSON only — an array: [{"to_business":"exact name","service":"specific service","reason":"1 sentence why they need it","action":"exact first step to take","priority":"high|medium|low"}]. Return empty array [] if no genuine match.`;
  const user = `CONTACT:\nName: ${contact.full_name}\nCompany: ${contact.company||"—"}\nTitle: ${contact.title||"—"}\nStatus: ${contact.lead_status||"new"}\nNotes: ${contact.notes||"—"}\n\nAVAILABLE GROUP COMPANIES (not yet working with this contact):\n${candidates.map(b=>`- ${b.name} (${b.type||"—"})`).join("\n")}`;
  const raw = await claude(sys, user, 600);
  try { return JSON.parse(raw.replace(/```json|```/g,"").trim())||[]; }
  catch { return []; }
}

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const ago = d => { if(!d) return "—"; const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60)return"just now"; if(s<3600)return`${Math.floor(s/60)}m ago`; if(s<86400)return`${Math.floor(s/3600)}h ago`; return`${Math.floor(s/86400)}d ago`; };
const fmt = d => d?new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"—";
const fmtShort = d => d?new Date(d).toLocaleDateString("en-US",{month:"short",day:"numeric"}):"—";
const fmtDue = d => { if(!d) return null; const diff=Math.floor((new Date(d)-Date.now())/86400000); if(diff<0) return{label:`${Math.abs(diff)}d overdue`,color:"#ef4444"}; if(diff===0) return{label:"Today",color:"#f59e0b"}; if(diff===1) return{label:"Tomorrow",color:"#f59e0b"}; return{label:`in ${diff}d`,color:"#6366f1"}; };
const usd = n => n?`$${Number(n).toLocaleString()}`:"—";
const pct = (a,b) => b?`${Math.round((a/b)*100)}%`:"0%";

// ─── CONFIGS ──────────────────────────────────────────────────────────────────
const STAGE_CFG = { lead:{c:"#6366f1",l:"Lead"}, prequalify:{c:"#8b5cf6",l:"Pre-Qual"}, application:{c:"#3b82f6",l:"Application"}, processing:{c:"#f59e0b",l:"Processing"}, underwriting:{c:"#ef4444",l:"Underwriting"}, clear_to_close:{c:"#10b981",l:"Clear to Close"}, closed:{c:"#d4af37",l:"Closed"} };
const PRIORITY_CFG = { low:{c:"#555",l:"Low"}, medium:{c:"#3b82f6",l:"Med"}, high:{c:"#f59e0b",l:"High"}, urgent:{c:"#ef4444",l:"Urgent"} };
const TASK_ICONS = { task:"☑", call:"📞", email:"✉", meeting:"📅", follow_up:"↩", deadline:"⏰" };
const CAT_COLORS = { contract:"#d4af37", invoice:"#f59e0b", rate_sheet:"#10b981", loan_app:"#3b82f6", disclosure:"#8b5cf6", policy:"#ef4444", compliance:"#8b5cf6", report:"#6366f1", correspondence:"#555", general:"#444", other:"#333" };
const LEAD_STATUS_CFG = { new:{c:"#6366f1",l:"New"}, contacted:{c:"#3b82f6",l:"Contacted"}, qualified:{c:"#f59e0b",l:"Qualified"}, proposal:{c:"#8b5cf6",l:"Proposal"}, negotiation:{c:"#ef4444",l:"Negotiation"}, won:{c:"#10b981",l:"Won"}, lost:{c:"#444",l:"Lost"}, nurture:{c:"#555",l:"Nurture"} };

// Lead scoring — deterministic, no AI call
function scoreContact(contact, deals, activities) {
  let s = 0;
  if (contact.email) s += 15;
  if (contact.phone) s += 10;
  if (contact.company) s += 5;
  const cDeals = deals.filter(d=>d.contact_id===contact.id);
  if (cDeals.length) s += 20;
  const openDeal = cDeals.find(d=>d.status==="open");
  if (openDeal) { s += 15; if (openDeal.stage==="clear_to_close") s += 10; }
  const cActs = activities.filter(a=>a.contact_id===contact.id);
  if (cActs.length) s += Math.min(cActs.length*3, 15);
  const recent = cActs.find(a=>new Date(a.created_at)>new Date(Date.now()-7*86400000));
  if (recent) s += 10;
  const statusBonus = {qualified:5,proposal:10,negotiation:15,won:5,contacted:3}[contact.lead_status]||0;
  s += statusBonus;
  return Math.min(s, 100);
}

// ─── SEED EMAILS ──────────────────────────────────────────────────────────────
const SEED_EMAILS = [
  { id:"email_001", from:"rates@unitedwholesale.com", from_name:"United Wholesale Mortgage", subject:"RATE ALERT: 30-Year Fixed drops to 6.625% — effective tomorrow", received_at:"2025-03-10T08:00:00Z", is_read:false, is_flagged:false, folder:"inbox", body:"Good morning,\n\nEffective March 11, 2025, we are updating our rate sheet:\n\n• 30-Year Fixed: 6.625% (was 6.875%)\n• 15-Year Fixed: 5.999% (was 6.125%)\n• FHA 30-Year: 6.375% (was 6.500%)\n• VA 30-Year: 6.125% (was 6.250%)\n\nLock desk hours: 8am–7pm EST\nFloat down available within 30 days of closing.\n\nBest,\nUWM Rate Desk", attachments:[{name:"RateSheet_Mar11_2025.pdf",size:"218 KB"}], tags:["rates","urgent"] },
  { id:"email_002", from:"products@lendingclub.com", from_name:"LendingClub Wholesale", subject:"New Product Launch: DSCR 90% LTV — No Income Docs Required", received_at:"2025-03-09T10:15:00Z", is_read:false, is_flagged:false, folder:"inbox", body:"Hi Team,\n\nWe're excited to announce our updated DSCR investor product:\n\n• LTV: Up to 90% (previously 80%)\n• Min DSCR ratio: 1.0 (previously 1.1)\n• Loan amounts: $150K–$3M\n• Min credit score: 660\n• Eligible: SFR, 2-4 units, condos, short-term rentals\n\nContact your account executive to get approved today.\n\nRegards,\nLendingClub Wholesale", attachments:[], tags:["product","investor"] },
  { id:"email_003", from:"billing@hostinger.com", from_name:"Hostinger Billing", subject:"Invoice #INV-2024-0382 — Hosting Plan Renewal", received_at:"2025-03-08T09:14:00Z", is_read:true, is_flagged:false, folder:"inbox", body:"Dear Customer,\n\nYour hosting plan is due for renewal:\n\nPlan: Business Web Hosting\nAmount: $11.99/month\nNext billing date: March 25, 2025\nAuto-renew: Enabled\n\nBest,\nHostinger Billing", attachments:[{name:"Invoice_INV-2024-0382.pdf",size:"124 KB"}], tags:["billing"] },
  { id:"email_004", from:"compliance@cfpb.gov", from_name:"CFPB Updates", subject:"Regulatory Update: New RESPA disclosure requirements Q2 2025", received_at:"2025-03-07T14:00:00Z", is_read:false, is_flagged:true, folder:"inbox", body:"Important compliance update for all mortgage brokers:\n\nEffective April 1, 2025, all mortgage brokers must comply with the following:\n\n1. Provide updated Loan Estimate within 3 business days of application\n2. New APR calculation methodology for adjustable-rate mortgages\n3. Enhanced disclosure requirements for discount points\n4. Revised broker compensation disclosure language\n\nPenalties for non-compliance: up to $10,000 per violation.\n\nCFPB Mortgage Division", attachments:[{name:"CFPB_Q2_2025_Guidance.pdf",size:"540 KB"}], tags:["compliance","important"] },
  { id:"email_005", from:"ae@pennymac.com", from_name:"PennyMac Wholesale", subject:"Conventional conforming loan limits updated — $806,500 effective Jan 1", received_at:"2025-03-06T11:30:00Z", is_read:false, is_flagged:false, folder:"inbox", body:"Hello,\n\nFHFA has confirmed the 2025 conforming loan limits:\n\n• 1-unit: $806,500 (up from $766,550)\n• 2-unit: $1,032,650\n• 3-unit: $1,248,150\n• 4-unit: $1,551,250\n• High-cost areas: up to $1,209,750 (1-unit)\n\nPennyMac Wholesale", attachments:[{name:"2025_Loan_Limits.pdf",size:"89 KB"}], tags:["conforming","limits"] },
  { id:"email_006", from:"noreply@fanniemae.com", from_name:"Fannie Mae Selling Guide", subject:"Selling Guide Update: SEL-2025-02 — Desktop Underwriter changes", received_at:"2025-03-05T09:00:00Z", is_read:true, is_flagged:false, folder:"inbox", body:"Fannie Mae Selling Guide Announcement SEL-2025-02\n\nThis announcement includes updates to Desktop Underwriter (DU):\n\n• New risk assessment model for self-employed borrowers (effective DU 11.2)\n• Updated asset depletion calculation methodology\n• Expanded eligibility for manufactured housing\n• Enhanced fraud detection triggers\n\nEffective April 15, 2025.\n\nFannie Mae Lender Relations", attachments:[{name:"SEL-2025-02.pdf",size:"312 KB"}], tags:["fannie","du","guidelines"] },
  { id:"email_007", from:"wholesale@ameriquest.com", from_name:"Ameriquest Wholesale", subject:"Price Improvement: Bank Statement loans — 0.50 LLPA reduction this week only", received_at:"2025-03-04T13:45:00Z", is_read:false, is_flagged:false, folder:"inbox", body:"Limited-time pricing update:\n\nBank Statement / Self-Employed program:\n\n• 0.50 point reduction on all new locks through Friday\n• 12 or 24-month statements accepted\n• Loan amounts up to $3M\n• Min 700 FICO for best pricing tier\n\nAmeriquest Wholesale Pricing Desk", attachments:[], tags:["pricing","non-qm"] },
  { id:"email_008", from:"referral@realty.com", from_name:"Sunrise Realty Group", subject:"Client referral — Maria Gonzalez, pre-approval needed ASAP", received_at:"2025-03-03T16:20:00Z", is_read:false, is_flagged:true, folder:"inbox", body:"Hi,\n\nWe have a client who needs a pre-approval letter urgently:\n\nClient: Maria Gonzalez\nPurchase price: ~$420,000\nDown payment: 10%\nEmployment: W2, 3 years same employer\nCredit: mid-700s\nTimeline: Offer going in this weekend\n\nMaria: maria.gonzalez@email.com / (239) 555-0182\n\nDave Morales\nSunrise Realty Group", attachments:[], tags:["referral","pre-approval","urgent"] },
];

// ══════════════════════════════════════════════════════════════════
//  ERROR BOUNDARY
// ══════════════════════════════════════════════════════════════════
class ErrorBoundary extends Component {
  state = { error:null };
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(err, info) { console.error("VAULT error:", err, info); }
  render() {
    if (this.state.error) return (
      <div style={{padding:40,textAlign:"center",color:"#ef4444",background:"#0a0a14",minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{fontSize:36,marginBottom:12}}>⚠</div>
        <div style={{fontSize:14,marginBottom:8}}>Something went wrong</div>
        <div style={{fontSize:10,color:"#555",marginBottom:20,maxWidth:400}}>{this.state.error.message}</div>
        <button onClick={()=>this.setState({error:null})} style={{background:"#d4af37",color:"#000",border:"none",borderRadius:4,padding:"8px 20px",cursor:"pointer",fontSize:11}}>RETRY</button>
      </div>
    );
    return this.props.children;
  }
}

// ══════════════════════════════════════════════════════════════════
//  BASE UI COMPONENTS
// ══════════════════════════════════════════════════════════════════
function Av({ name, color="#d4af37", size=32 }) {
  return <div style={{ width:size,height:size,borderRadius:"50%",background:`${color}22`,border:`1px solid ${color}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.4,color,fontWeight:"600",flexShrink:0 }}>{(name||"?").charAt(0).toUpperCase()}</div>;
}
function Bd({ label, color="#555", bg }) {
  return <span style={{ display:"inline-block",padding:"1px 7px",borderRadius:2,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",background:bg||`${color}18`,color,border:`1px solid ${color}30`,whiteSpace:"nowrap" }}>{label}</span>;
}
function Modal({ onClose, title, width="500px", children }) {
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16 }}>
      <div style={{ width:`min(${width},96vw)`,maxHeight:"92vh",background:"#0b0b16",border:"1px solid #2a2a48",borderRadius:8,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 0 100px rgba(0,0,0,0.7)" }} className="fi">
        <div style={{ display:"flex",alignItems:"center",padding:"12px 18px",borderBottom:"1px solid #181828",flexShrink:0 }}>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:17,letterSpacing:".2em",color:"#d4af37" }}>{title}</span>
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:18 }}>✕</button>
        </div>
        <div style={{ overflowY:"auto",flex:1,padding:20 }}>{children}</div>
      </div>
    </div>
  );
}
function Fld({ label, children }) {
  return <div style={{ marginBottom:12 }}><div style={{ fontSize:9,color:"#555",letterSpacing:".1em",marginBottom:4 }}>{label}</div>{children}</div>;
}
function Inp({ value, onChange, placeholder, type="text", style={} }) {
  return <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,...style }} />;
}
function Sel({ value, onChange, options, children, style={} }) {
  return <select value={value||""} onChange={e=>onChange(e.target.value)} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,...style }}>
    {options ? options.map(o=><option key={o.value} value={o.value}>{o.label}</option>) : children}
  </select>;
}
function Btn({ onClick, children, variant="default", disabled, style={} }) {
  const V = { default:{background:"none",border:"1px solid #1e1e2e",color:"#666"}, gold:{background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",fontWeight:"600"}, red:{background:"none",border:"1px solid #ef444466",color:"#ef4444"}, purple:{background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.4)",color:"#a78bfa"}, green:{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.4)",color:"#10b981"}, blue:{background:"rgba(59,130,246,.1)",border:"1px solid rgba(59,130,246,.4)",color:"#60a5fa"} };
  return <button onClick={onClick} disabled={disabled} style={{ fontFamily:"inherit",fontSize:10,letterSpacing:".08em",padding:"6px 14px",borderRadius:3,cursor:"pointer",...(V[variant]||V.default),...style }}>{children}</button>;
}
function ScorePill({ score }) {
  const color = score>=75?"#10b981":score>=50?"#f59e0b":score>=25?"#3b82f6":"#444";
  return <div title={`Lead Score: ${score}/100`} style={{ display:"inline-flex",alignItems:"center",gap:3,background:`${color}15`,border:`1px solid ${color}40`,borderRadius:10,padding:"1px 7px",fontSize:8,color,letterSpacing:".04em" }}>◈ {score}</div>;
}

// ─── COMPOSE MODAL ────────────────────────────────────────────────
function ComposeModal({ onClose, contacts, defaultTo="", defaultSubject="", defaultBody="" }) {
  const [f, setF] = useState({ to:defaultTo, cc:"", subject:defaultSubject, body:defaultBody });
  const [sending, setSending] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));

  const aiDraft = async () => {
    if (!f.subject.trim()) return;
    setAiLoading(true);
    const txt = await claude(
      "You are a professional mortgage broker assistant. Draft a concise, professional email body. Use a warm but direct tone. No placeholder brackets. Return body text only.",
      `Subject: ${f.subject}\nTo: ${f.to||"client"}\nContext: mortgage broker outreach`,
      500
    );
    if (txt) s("body", txt);
    setAiLoading(false);
  };

  const send = async () => {
    if (!f.to.trim()||!f.subject.trim()) return;
    setSending(true);
    const contact = contacts.find(c=>c.email===f.to);
    await sb("crm_activities","POST",{ type:"email", direction:"outbound", subject:f.subject, body:f.body, contact_id:contact?.id||null, is_completed:true, completed_at:new Date().toISOString() });
    setSending(false);
    onClose({ sent:true, to:f.to, subject:f.subject });
  };

  return (
    <Modal onClose={onClose} title="✉ COMPOSE" width="600px">
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="TO">
          <input value={f.to} onChange={e=>s("to",e.target.value)} placeholder="recipient@email.com" list="ce-list"
            style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3 }} />
          <datalist id="ce-list">{contacts.filter(c=>c.email).map(c=><option key={c.id} value={c.email}>{c.full_name}</option>)}</datalist>
        </Fld>
        <Fld label="CC"><Inp value={f.cc} onChange={v=>s("cc",v)} placeholder="cc@email.com (optional)" /></Fld>
      </div>
      <Fld label="SUBJECT"><Inp value={f.subject} onChange={v=>s("subject",v)} placeholder="Subject line..." /></Fld>
      <div style={{ display:"flex",gap:6,marginBottom:8,alignItems:"center" }}>
        <span style={{ fontSize:8,color:"#333",letterSpacing:".1em" }}>AI DRAFT:</span>
        <Btn onClick={aiDraft} variant="purple" disabled={aiLoading||!f.subject.trim()} style={{ fontSize:8,padding:"3px 10px" }}>
          {aiLoading?<span className="pulse">🧠 drafting...</span>:"🧠 DRAFT WITH AI"}
        </Btn>
      </div>
      <Fld label="BODY">
        <textarea value={f.body} onChange={e=>s("body",e.target.value)} rows={9}
          style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"10px 12px",borderRadius:3,resize:"vertical",lineHeight:1.7 }} />
      </Fld>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",alignItems:"center" }}>
        <span style={{ fontSize:9,color:"#333" }}>logged as activity</span>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={send} variant="gold" disabled={sending||!f.to.trim()||!f.subject.trim()}>{sending?"SENDING...":"✈ SEND & LOG"}</Btn>
      </div>
    </Modal>
  );
}

// ─── CAMPAIGN MODAL ───────────────────────────────────────────────
function CampaignModal({ onClose, contacts, onSave }) {
  const [f, setF] = useState({ name:"", type:"email", subject:"", body:"", sms_body:"", segment:"all", tag_filter:"", status_filter:"", schedule:"now", schedule_at:"" });
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dripSteps, setDripSteps] = useState([]);
  const s = (k,v) => setF(p=>({...p,[k]:v}));

  const segmented = useMemo(() => {
    let base = contacts;
    if (f.segment==="has_email") base = contacts.filter(c=>c.email);
    if (f.segment==="has_phone") base = contacts.filter(c=>c.phone);
    if (f.segment==="has_both") base = contacts.filter(c=>c.email&&c.phone);
    if (f.segment==="by_status") base = contacts.filter(c=>c.lead_status===f.status_filter);
    if (f.segment==="by_tag") base = contacts.filter(c=>(c.tags||[]).includes(f.tag_filter));
    if (f.segment==="sms_consent") base = contacts.filter(c=>c.phone&&c.sms_consent);
    // For SMS/phone types, filter to those with phone
    if ((f.type==="sms"||f.type==="phone") && f.segment!=="has_phone") base = base.filter(c=>c.phone);
    return base;
  }, [f.segment, f.type, f.tag_filter, f.status_filter, contacts]);

  const aiGenerate = async () => {
    if (f.type==="email" && !f.subject.trim()) return;
    if (f.type==="sms" && !f.name.trim()) return;
    setAiLoading(true);
    if (f.type==="sms") {
      const txt = await claude(
        "You are an expert SMS marketing copywriter for a mortgage broker. Write a compelling, concise SMS (max 160 chars). Include a clear CTA. Return the SMS text only.",
        `Campaign: ${f.name}\nAudience: ${segmented.length} recipients\nBusiness: mortgage broker`, 200
      );
      if (txt) s("sms_body", txt);
    } else if (f.type==="drip") {
      const raw = await claude(
        "You are a drip campaign expert for mortgage brokers. Design a 5-step drip sequence mixing email and SMS touches. Return STRICT JSON array: [{\"delay_days\":0,\"type\":\"email\",\"subject\":\"...\",\"body\":\"...\"},{\"delay_days\":2,\"type\":\"sms\",\"body\":\"...(max 160 chars)\"},...]. No markdown fences.",
        `Campaign: ${f.name}\nGoal: nurture mortgage leads to application\nAudience size: ${segmented.length}`, 1200
      );
      try { const steps = JSON.parse(raw.replace(/```json|```/g,"").trim()); setDripSteps(Array.isArray(steps)?steps:[]); } catch { /* ignore parse error */ }
    } else {
      const txt = await claude(
        "You are an expert mortgage broker marketing copywriter. Write a compelling, professional email campaign body. Be direct, value-first, no fluff. Include a clear call to action. Return body text only.",
        `Campaign name: ${f.name||"(unnamed)"}\nSubject: ${f.subject}\nAudience: ${f.segment} (${segmented.length} recipients)`, 700
      );
      if (txt) s("body", txt);
    }
    setAiLoading(false);
  };

  const save = async (status="draft") => {
    if (!f.name.trim()) return;
    setSaving(true);
    const rec = {
      name:f.name, subject:f.subject, body:f.body, sms_body:f.sms_body, segment:f.segment,
      recipient_count:segmented.length, status, type:f.type,
      drip_steps: f.type==="drip" ? dripSteps : null,
      sent_at: status==="sent"?new Date().toISOString():null,
      send_at: f.schedule==="later"&&f.schedule_at?f.schedule_at:null,
      created_at:new Date().toISOString()
    };
    const res = await sb("marketing_campaigns","POST",rec);
    // If launching, create recipient records
    if (status==="sent" && res?.[0]?.id) {
      const campId = res[0].id;
      const recipients = segmented.slice(0,500).map(c=>({campaign_id:campId,contact_id:c.id,email:c.email||"",phone:c.phone||"",status:"sent",sent_at:new Date().toISOString()}));
      // Batch insert in chunks
      for(let i=0;i<recipients.length;i+=50) await sb("vault_campaign_recipients","POST",recipients.slice(i,i+50));
    }
    if (res) onSave(res[0]||rec, status);
    else onSave(rec, status);
    setSaving(false);
    onClose();
  };

  const typeColors = {email:"#3b82f6",sms:"#10b981",phone:"#f59e0b",drip:"#8b5cf6"};
  const typeLabels = {email:"Email Campaign",sms:"SMS / Text Blast",phone:"Phone Power Dialer",drip:"Drip Sequence (Multi-touch)"};

  return (
    <Modal onClose={onClose} title="📣 NEW CAMPAIGN" width="720px">
      {/* Campaign Type Selector */}
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {["email","sms","phone","drip"].map(t=>(
          <button key={t} onClick={()=>s("type",t)} style={{flex:1,padding:"10px 8px",background:f.type===t?`${typeColors[t]}15`:"#0d0d18",border:`1px solid ${f.type===t?typeColors[t]+"55":"#1e1e28"}`,borderRadius:4,cursor:"pointer",textAlign:"center",fontFamily:"inherit"}}>
            <div style={{fontSize:16,marginBottom:2}}>{t==="email"?"✉":t==="sms"?"💬":t==="phone"?"📞":"🔄"}</div>
            <div style={{fontSize:8,color:f.type===t?typeColors[t]:"#555",letterSpacing:".06em",textTransform:"uppercase"}}>{t}</div>
          </button>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Fld label="CAMPAIGN NAME"><Inp value={f.name} onChange={v=>s("name",v)} placeholder={typeLabels[f.type]} /></Fld>
        <Fld label="AUDIENCE SEGMENT">
          <Sel value={f.segment} onChange={v=>s("segment",v)} options={[
            {value:"all",label:`All Contacts (${contacts.length})`},
            {value:"has_email",label:`Has Email (${contacts.filter(c=>c.email).length})`},
            {value:"has_phone",label:`Has Phone (${contacts.filter(c=>c.phone).length})`},
            {value:"has_both",label:`Email + Phone (${contacts.filter(c=>c.email&&c.phone).length})`},
            {value:"sms_consent",label:`SMS Opt-in (${contacts.filter(c=>c.phone&&c.sms_consent).length})`},
            {value:"by_status",label:"Filter by Lead Status"},
            {value:"by_tag",label:"Filter by Tag"},
          ]} />
        </Fld>
      </div>
      {f.segment==="by_status"&&<Fld label="LEAD STATUS"><Sel value={f.status_filter} onChange={v=>s("status_filter",v)} options={[{value:"",label:"Select..."},...Object.entries(LEAD_STATUS_CFG).map(([k,v])=>({value:k,label:v.l}))]} /></Fld>}
      {f.segment==="by_tag"&&<Fld label="TAG"><Inp value={f.tag_filter} onChange={v=>s("tag_filter",v)} placeholder="e.g. investor, referral" /></Fld>}

      <div style={{background:`${typeColors[f.type]}08`,border:`1px solid ${typeColors[f.type]}22`,borderRadius:4,padding:"6px 12px",marginBottom:12,fontSize:9,color:"#888"}}>
        {f.type==="email"?"✉":"💬"} This {f.type} campaign will reach <span style={{color:typeColors[f.type],fontWeight:600}}>{segmented.length} recipient{segmented.length!==1?"s":""}</span>
        {(f.type==="sms"||f.type==="phone")&&<span style={{color:"#f59e0b",marginLeft:6}}>SMS/phone charges apply via Twilio</span>}
      </div>

      {/* EMAIL fields */}
      {(f.type==="email")&&(<>
        <Fld label="EMAIL SUBJECT"><Inp value={f.subject} onChange={v=>s("subject",v)} placeholder="Rate Update: Lock in your best rate this week" /></Fld>
        <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
          <Btn onClick={aiGenerate} variant="purple" disabled={aiLoading||!f.subject.trim()} style={{fontSize:8,padding:"3px 10px"}}>
            {aiLoading?<span className="pulse">🧠 writing...</span>:"🧠 AI WRITE EMAIL"}
          </Btn>
        </div>
        <Fld label="EMAIL BODY">
          <textarea value={f.body} onChange={e=>s("body",e.target.value)} rows={10} style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"10px 12px",borderRadius:3,resize:"vertical",lineHeight:1.7}} />
        </Fld>
      </>)}

      {/* SMS fields */}
      {f.type==="sms"&&(<>
        <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
          <Btn onClick={aiGenerate} variant="purple" disabled={aiLoading||!f.name.trim()} style={{fontSize:8,padding:"3px 10px"}}>
            {aiLoading?<span className="pulse">🧠 writing...</span>:"🧠 AI WRITE SMS"}
          </Btn>
          <span style={{fontSize:8,color:"#333"}}>AI generates optimized SMS (160 chars)</span>
        </div>
        <Fld label={`SMS MESSAGE (${(f.sms_body||"").length}/160)`}>
          <textarea value={f.sms_body} onChange={e=>s("sms_body",e.target.value.slice(0,160))} rows={3} placeholder="Hi {{name}}, rates just dropped to 6.25%! Lock in today: {{link}}" style={{width:"100%",background:"#0f0f1a",border:`1px solid ${(f.sms_body||"").length>160?"#ef4444":"#1e1e2e"}`,color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"10px 12px",borderRadius:3,resize:"none",lineHeight:1.5}} />
        </Fld>
        <div style={{fontSize:8,color:"#444",marginBottom:8,lineHeight:1.5}}>Variables: {"{{name}}"} {"{{company}}"} {"{{phone}}"} {"{{link}}"}</div>
      </>)}

      {/* PHONE power dialer */}
      {f.type==="phone"&&(
        <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:5,padding:14,marginBottom:12}}>
          <div style={{fontSize:10,color:"#f59e0b",marginBottom:6}}>POWER DIALER MODE</div>
          <div style={{fontSize:9,color:"#555",lineHeight:1.6}}>
            When launched, the system will queue {segmented.length} contacts for sequential calling. Each call will auto-log to the Call Center tab with recording and disposition tracking.
          </div>
          <Fld label="CALL SCRIPT (shown to caller during each call)">
            <textarea value={f.body} onChange={e=>s("body",e.target.value)} rows={6} placeholder="Hi, this is [Your Name] from Ziarem. I'm reaching out because..." style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"10px 12px",borderRadius:3,resize:"vertical",lineHeight:1.7}} />
          </Fld>
          <Btn onClick={aiGenerate} variant="purple" disabled={aiLoading||!f.name.trim()} style={{fontSize:8,padding:"3px 10px"}}>
            {aiLoading?<span className="pulse">🧠 writing...</span>:"🧠 AI WRITE SCRIPT"}
          </Btn>
        </div>
      )}

      {/* DRIP sequence */}
      {f.type==="drip"&&(<>
        <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center"}}>
          <Btn onClick={aiGenerate} variant="purple" disabled={aiLoading||!f.name.trim()} style={{fontSize:8,padding:"3px 10px"}}>
            {aiLoading?<span className="pulse">🧠 designing...</span>:"🧠 AI DESIGN DRIP SEQUENCE"}
          </Btn>
          <Btn onClick={()=>setDripSteps(p=>[...p,{delay_days:p.length?p[p.length-1].delay_days+2:0,type:"email",subject:"",body:""}])} style={{fontSize:8,padding:"3px 10px"}}>+ ADD STEP</Btn>
        </div>
        {dripSteps.length===0&&<div style={{textAlign:"center",padding:20,color:"#2a2a3a",fontSize:9}}>No steps yet — click AI Design or Add Step</div>}
        {dripSteps.map((step,i)=>(
          <div key={i} style={{background:"#0a0a14",border:`1px solid ${step.type==="email"?"#3b82f622":"#10b98122"}`,borderRadius:4,padding:"10px 12px",marginBottom:8}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
              <span style={{fontSize:10,color:"#d4af37",fontWeight:600}}>Step {i+1}</span>
              <span style={{fontSize:8,color:step.type==="email"?"#3b82f6":"#10b981",background:step.type==="email"?"rgba(59,130,246,.1)":"rgba(16,185,129,.1)",padding:"1px 6px",borderRadius:2,textTransform:"uppercase"}}>{step.type}</span>
              <span style={{fontSize:8,color:"#555"}}>Day {step.delay_days}</span>
              <div style={{flex:1}} />
              <select value={step.type} onChange={e=>{const v=e.target.value;setDripSteps(p=>p.map((s,j)=>j===i?{...s,type:v}:s));}} style={{background:"#0d0d18",border:"1px solid #1e1e28",color:"#888",fontFamily:"inherit",fontSize:9,padding:"2px 6px",borderRadius:2}}>
                <option value="email">Email</option><option value="sms">SMS</option>
              </select>
              <input type="number" min="0" value={step.delay_days} onChange={e=>setDripSteps(p=>p.map((s,j)=>j===i?{...s,delay_days:parseInt(e.target.value)||0}:s))} style={{width:40,background:"#0d0d18",border:"1px solid #1e1e28",color:"#888",fontFamily:"inherit",fontSize:9,padding:"2px 4px",borderRadius:2,textAlign:"center"}} title="Delay days" />
              <button onClick={()=>setDripSteps(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:10}}>✕</button>
            </div>
            {step.type==="email"&&<input value={step.subject||""} onChange={e=>setDripSteps(p=>p.map((s,j)=>j===i?{...s,subject:e.target.value}:s))} placeholder="Email subject..." style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"6px 10px",borderRadius:3,marginBottom:4}} />}
            <textarea value={step.body||""} onChange={e=>setDripSteps(p=>p.map((s,j)=>j===i?{...s,body:e.target.value}:s))} rows={step.type==="sms"?2:4} placeholder={step.type==="sms"?"SMS text (160 chars)...":"Email body..."} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"6px 10px",borderRadius:3,resize:"vertical"}} />
          </div>
        ))}
      </>)}

      {/* Schedule */}
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:12,marginTop:4}}>
        <span style={{fontSize:9,color:"#555"}}>SCHEDULE:</span>
        <button onClick={()=>s("schedule","now")} style={{background:f.schedule==="now"?"rgba(16,185,129,.1)":"none",border:`1px solid ${f.schedule==="now"?"rgba(16,185,129,.3)":"#1e1e28"}`,color:f.schedule==="now"?"#10b981":"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"3px 10px",borderRadius:2}}>SEND NOW</button>
        <button onClick={()=>s("schedule","later")} style={{background:f.schedule==="later"?"rgba(59,130,246,.1)":"none",border:`1px solid ${f.schedule==="later"?"rgba(59,130,246,.3)":"#1e1e28"}`,color:f.schedule==="later"?"#3b82f6":"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"3px 10px",borderRadius:2}}>SCHEDULE</button>
        {f.schedule==="later"&&<input type="datetime-local" value={f.schedule_at} onChange={e=>s("schedule_at",e.target.value)} style={{background:"#0d0d18",border:"1px solid #1e1e28",color:"#888",fontFamily:"inherit",fontSize:9,padding:"3px 8px",borderRadius:2}} />}
      </div>

      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={()=>save("draft")} disabled={saving||!f.name.trim()}>SAVE DRAFT</Btn>
        <Btn onClick={()=>save("sent")} variant="gold" disabled={saving||!f.name.trim()}>{saving?"LAUNCHING...":"🚀 LAUNCH"}</Btn>
      </div>
    </Modal>
  );
}

// ─── AI ASSISTANT PANEL ───────────────────────────────────────────
function AIAssistant({ contacts, deals, tasks, activities, businesses, intelligence, campaigns, onClose }) {
  const [messages, setMessages] = useState([
    { role:"assistant", text:"Hello — I'm your Vault AI. I have full context on your CRM, pipeline, marketing campaigns, and intelligence. Ask me anything about your business." }
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior:"smooth" }); }, [messages]);

  const buildCtx = () => {
    const open = deals.filter(d=>d.status==="open");
    const won = deals.filter(d=>d.status==="won");
    const pending = tasks.filter(t=>t.status==="pending"||t.status==="in_progress");
    const overdue = pending.filter(t=>t.due_at&&new Date(t.due_at)<Date.now());
    const pipeline = open.reduce((s,d)=>s+Number(d.value||0),0);
    const sentCampaigns = (campaigns||[]).filter(c=>c.status==="sent");
    return `You are an intelligent business advisor and CRM assistant for a mortgage broker group with multiple companies.

BUSINESS SNAPSHOT:
- Contacts: ${contacts.length} total | ${contacts.filter(c=>c.lead_status==="qualified").length} qualified leads
- Open Deals: ${open.length} worth $${pipeline.toLocaleString()}
- Won Deals: ${won.length} | Win Rate: ${deals.length?Math.round((won.length/deals.length)*100):0}%
- Overdue Tasks: ${overdue.length}/${pending.length} pending
- Marketing: ${sentCampaigns.length} campaigns sent to ${sentCampaigns.reduce((s,c)=>s+(c.recipient_count||0),0)} recipients total
- Intel Records: ${intelligence.length}

OPEN DEALS (top 8):
${open.slice(0,8).map(d=>`- "${d.title}" | ${d.stage} | ${d.value?`$${Number(d.value).toLocaleString()}`:"no value"} | Close: ${d.expected_close||"TBD"}`).join("\n")||"None"}

RECENT CONTACTS:
${contacts.slice(0,8).map(c=>`- ${c.full_name} | ${c.company||"—"} | ${c.lead_status||"new"} | ${c.email||"no email"}`).join("\n")}

BUSINESSES:
${businesses.map(b=>`- ${b.name} (${b.type||"—"})`).join("\n")||"None configured"}

OVERDUE TASKS:
${overdue.slice(0,5).map(t=>`- [${t.type}] ${t.title} — due ${t.due_at?.split("T")[0]||"?"}`).join("\n")||"None"}

RECENT INTEL:
${intelligence.slice(0,5).map(i=>`- [${i.category}] ${i.email_subject} — ${(i.summary||"").slice(0,100)}`).join("\n")||"None"}

Be specific, data-driven, and actionable. Use bullet points for lists. Suggest concrete next steps.`;
  };

  const send = async () => {
    if (!input.trim()||loading) return;
    const msg = input.trim(); setInput("");
    setMessages(p=>[...p,{role:"user",text:msg}]);
    setLoading(true);
    const reply = await claude(buildCtx(), msg, 700);
    setMessages(p=>[...p,{role:"assistant",text:reply||"Sorry, couldn't process that right now."}]);
    setLoading(false);
  };

  const QUICK = [
    "What are my top 3 actions to grow revenue this week?",
    "Which leads should I prioritize calling today?",
    "Summarize my pipeline health and risks",
    "Suggest a marketing campaign for my current contacts",
    "What deals are at risk of going cold?",
    "How can I improve my win rate?",
    "Which companies need more attention?",
    "Draft a follow-up sequence for qualified leads",
  ];

  return (
    <div style={{ position:"fixed",bottom:80,right:20,width:420,height:560,background:"#08080f",border:"1px solid #2a2a48",borderRadius:10,display:"flex",flexDirection:"column",zIndex:250,boxShadow:"0 0 80px rgba(99,102,241,0.18)",overflow:"hidden" }} className="fi">
      <div style={{ padding:"10px 14px",borderBottom:"1px solid #1a1a28",display:"flex",alignItems:"center",gap:8,background:"#07070e",flexShrink:0 }}>
        <div style={{ width:28,height:28,borderRadius:"50%",background:"rgba(139,92,246,.2)",border:"1px solid rgba(139,92,246,.4)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13 }}>⬡</div>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:".15em",color:"#a78bfa" }}>VAULT AI ADVISOR</div>
          <div style={{ fontSize:8,color:"#333",marginTop:-2 }}>FULL BUSINESS CONTEXT</div>
        </div>
        <div style={{ flex:1 }} />
        <button onClick={onClose} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:16 }}>✕</button>
      </div>
      <div style={{ flex:1,overflowY:"auto",padding:"12px 14px",display:"flex",flexDirection:"column",gap:10 }}>
        {messages.map((m,i)=>(
          <div key={i} style={{ display:"flex",gap:8,alignItems:"flex-start",flexDirection:m.role==="user"?"row-reverse":"row" }}>
            <div style={{ width:24,height:24,borderRadius:"50%",background:m.role==="user"?"rgba(212,175,55,.2)":"rgba(139,92,246,.2)",border:`1px solid ${m.role==="user"?"rgba(212,175,55,.3)":"rgba(139,92,246,.3)"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,flexShrink:0 }}>{m.role==="user"?"U":"⬡"}</div>
            <div style={{ maxWidth:"82%",background:m.role==="user"?"rgba(212,175,55,.05)":"rgba(139,92,246,.04)",border:`1px solid ${m.role==="user"?"rgba(212,175,55,.12)":"rgba(139,92,246,.12)"}`,borderRadius:6,padding:"8px 11px" }}>
              <pre style={{ fontSize:11,color:m.role==="user"?"#d4af37":"#c4c0d8",lineHeight:1.75,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0 }}>{m.text}</pre>
            </div>
          </div>
        ))}
        {loading&&<div style={{ display:"flex",gap:8,alignItems:"flex-start" }}>
          <div style={{ width:24,height:24,borderRadius:"50%",background:"rgba(139,92,246,.2)",border:"1px solid rgba(139,92,246,.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11 }}>⬡</div>
          <div style={{ background:"rgba(139,92,246,.05)",border:"1px solid rgba(139,92,246,.15)",borderRadius:6,padding:"10px 14px",display:"flex",gap:4 }}>
            {[0,1,2].map(i=><div key={i} style={{ width:5,height:5,borderRadius:"50%",background:"#8b5cf6",animation:`dot ${1+i*0.2}s infinite` }} />)}
          </div>
        </div>}
        <div ref={bottomRef} />
      </div>
      {messages.length<=1&&(
        <div style={{ padding:"6px 14px",display:"flex",flexWrap:"wrap",gap:4,flexShrink:0,maxHeight:120,overflowY:"auto" }}>
          {QUICK.map((q,i)=>(
            <button key={i} onClick={()=>setInput(q)} style={{ background:"rgba(99,102,241,.06)",border:"1px solid rgba(99,102,241,.2)",color:"#6366f1",fontFamily:"inherit",fontSize:8,padding:"3px 8px",borderRadius:3,cursor:"pointer" }}>{q}</button>
          ))}
        </div>
      )}
      <div style={{ padding:"10px 14px",borderTop:"1px solid #1a1a28",display:"flex",gap:7,flexShrink:0 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&!e.shiftKey&&send()}
          placeholder="Ask anything about your business..."
          style={{ flex:1,background:"#0e0e1a",border:"1px solid #1e1e2e",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:5 }} />
        <button onClick={send} disabled={loading||!input.trim()}
          style={{ background:"rgba(139,92,246,.15)",border:"1px solid rgba(139,92,246,.4)",color:"#a78bfa",cursor:"pointer",borderRadius:5,padding:"0 14px",fontSize:13,fontWeight:"600" }}>↑</button>
      </div>
    </div>
  );
}

// ─── GLOBAL SEARCH OVERLAY ────────────────────────────────────────
function GlobalSearch({ contacts, deals, documents, intelligence, emails, onClose, onNav }) {
  const [q, setQ] = useState("");
  const inputRef = useRef(null);
  useEffect(()=>{ inputRef.current?.focus(); },[]);

  const results = useMemo(()=>{
    if (!q.trim()||q.length<2) return [];
    const ql = q.toLowerCase();
    const r = [];
    contacts.forEach(c=>{ if((c.full_name||"").toLowerCase().includes(ql)||(c.email||"").toLowerCase().includes(ql)||(c.company||"").toLowerCase().includes(ql)) r.push({type:"contact",icon:"👤",label:c.full_name,sub:c.company||c.email||"",id:c.id,nav:["crm","contacts"]}); });
    deals.forEach(d=>{ if((d.title||"").toLowerCase().includes(ql)) r.push({type:"deal",icon:"💼",label:d.title,sub:`${d.stage} · ${d.value?`$${Number(d.value).toLocaleString()}`:"—"}`,id:d.id,nav:["crm","deals"]}); });
    documents.forEach(d=>{ if((d.name||"").toLowerCase().includes(ql)||(d.description||"").toLowerCase().includes(ql)) r.push({type:"doc",icon:"📄",label:d.name,sub:d.category||"document",id:d.id,nav:["docs"]}); });
    emails.forEach(e=>{ if((e.subject||"").toLowerCase().includes(ql)||(e.from_name||"").toLowerCase().includes(ql)||(e.body||"").toLowerCase().includes(ql)) r.push({type:"email",icon:"✉",label:e.subject,sub:e.from_name||e.from,id:e.id,nav:["inbox"]}); });
    intelligence.forEach(i=>{ if((i.email_subject||"").toLowerCase().includes(ql)||(i.summary||"").toLowerCase().includes(ql)) r.push({type:"intel",icon:"🧠",label:i.email_subject,sub:i.category,id:i.id,nav:["intel"]}); });
    return r.slice(0,12);
  }, [q, contacts, deals, documents, intelligence, emails]);

  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",backdropFilter:"blur(8px)",display:"flex",alignItems:"flex-start",justifyContent:"center",zIndex:400,padding:"80px 20px" }}>
      <div style={{ width:"min(600px,96vw)",background:"#0b0b16",border:"1px solid #2a2a48",borderRadius:10,overflow:"hidden",boxShadow:"0 0 120px rgba(0,0,0,0.8)" }} className="fi">
        <div style={{ display:"flex",alignItems:"center",gap:10,padding:"12px 16px",borderBottom:"1px solid #1a1a28" }}>
          <span style={{ fontSize:16,color:"#555" }}>⌕</span>
          <input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Search contacts, deals, emails, documents, intel..."
            style={{ flex:1,background:"none",border:"none",color:"#e0dcd0",fontFamily:"inherit",fontSize:14,outline:"none" }} />
          <button onClick={onClose} style={{ background:"none",border:"1px solid #1e1e2e",color:"#555",cursor:"pointer",borderRadius:3,padding:"2px 8px",fontSize:10 }}>ESC</button>
        </div>
        {results.length>0?(
          <div style={{ maxHeight:420,overflowY:"auto" }}>
            {results.map((r,i)=>(
              <div key={i} onClick={()=>{ onNav(...r.nav); onClose(); }} style={{ padding:"10px 16px",borderBottom:"1px solid #0e0e18",cursor:"pointer",display:"flex",alignItems:"center",gap:10 }} className="rh">
                <span style={{ fontSize:14,flexShrink:0 }}>{r.icon}</span>
                <div style={{ flex:1,minWidth:0 }}>
                  <div style={{ fontSize:11,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{r.label}</div>
                  <div style={{ fontSize:9,color:"#555" }}>{r.sub}</div>
                </div>
                <Bd label={r.type} color="#333" />
              </div>
            ))}
          </div>
        ) : q.length>=2 ? (
          <div style={{ padding:30,textAlign:"center",color:"#333",fontSize:11 }}>No results for "{q}"</div>
        ) : (
          <div style={{ padding:"16px",display:"flex",flexWrap:"wrap",gap:6 }}>
            {["contacts","deals","emails","documents","intel"].map(t=>(
              <span key={t} style={{ background:"rgba(255,255,255,.03)",border:"1px solid #1a1a28",color:"#444",borderRadius:3,padding:"3px 10px",fontSize:9,letterSpacing:".06em",textTransform:"uppercase" }}>{t}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────
function Dashboard({ contacts, deals, tasks, activities, businesses, intelligence, documents, campaigns, onNav, onNewDeal, onNewTask }) {
  const [briefing, setBriefing] = useState("");
  const [briefingLoading, setBriefingLoading] = useState(false);

  const open = deals.filter(d=>d.status==="open");
  const won = deals.filter(d=>d.status==="won");
  const pending = tasks.filter(t=>t.status==="pending"||t.status==="in_progress");
  const overdue = pending.filter(t=>t.due_at&&new Date(t.due_at)<Date.now());
  const todayTasks = pending.filter(t=>{ if(!t.due_at) return false; const d=new Date(t.due_at); const n=new Date(); return d.getFullYear()===n.getFullYear()&&d.getMonth()===n.getMonth()&&d.getDate()===n.getDate(); });
  const pipeline = open.reduce((s,d)=>s+Number(d.value||0),0);
  const weighted = open.reduce((s,d)=>{const w={lead:.1,prequalify:.2,application:.35,processing:.5,underwriting:.7,clear_to_close:.9,closed:1}[d.stage]||.1; return s+Number(d.value||0)*w;},0);
  const winRate = deals.length ? Math.round((won.length/deals.length)*100) : 0;
  const sentCampaigns = (campaigns||[]).filter(c=>c.status==="sent");

  const stageData = Object.entries(STAGE_CFG).map(([k,v])=>({ name:v.l, count:open.filter(d=>d.stage===k).length, color:v.c })).filter(d=>d.count>0);
  const activityData = Array.from({length:14},(_, i)=>{
    const d=new Date(); d.setDate(d.getDate()-(13-i));
    const ds=d.toISOString().split("T")[0];
    return { label:fmtShort(ds), count:activities.filter(a=>a.created_at?.startsWith(ds)).length };
  });
  const topDeals = [...open].sort((a,b)=>Number(b.value||0)-Number(a.value||0)).slice(0,6);

  const getDailyBriefing = async () => {
    setBriefingLoading(true);
    // Pull live FRED rates + top mortgage news in parallel
    const [fred30, fredFF, topNews] = await Promise.all([
      fetchFRED("MORTGAGE30US", 2),
      fetchFRED("FEDFUNDS", 2),
      fetchGNews("mortgage rates housing market", 4),
    ]);
    const rateCtx = [
      fred30 ? `30-yr fixed: ${fred30.latest}% (${fred30.change>=0?"+":""}${fred30.change}% vs last week)` : "",
      fredFF ? `Fed funds rate: ${fredFF.latest}%` : "",
    ].filter(Boolean).join(" | ");
    const newsCtx = topNews.length
      ? `\n\nLATEST HEADLINES:\n${topNews.map(a=>`• ${a.title}`).join("\n")}`
      : "";
    const txt = await claude(
      "You are a sharp business advisor for a mortgage broker group. Write a concise daily briefing (3-4 paragraphs). Include: top priority actions for today, pipeline highlights, any risks or opportunities, and one growth suggestion. Reference the live market data provided. Be direct and actionable — no fluff.",
      `LIVE MARKET: ${rateCtx}${newsCtx}\n\nCRM DATA: ${open.length} open deals ($${pipeline.toLocaleString()} pipeline), ${overdue.length} overdue tasks, ${todayTasks.length} due today, ${contacts.length} contacts, win rate ${winRate}%, ${intelligence.length} intel records, ${sentCampaigns.length} campaigns sent. Top deal stages: ${stageData.map(s=>`${s.count} in ${s.name}`).join(", ")||"none"}.`,
      700
    );
    setBriefing(txt);
    setBriefingLoading(false);
  };

  const KPI = [
    { label:"PIPELINE VALUE", value:usd(pipeline), sub:`${open.length} open deals`, color:"#d4af37", nav:["crm","pipeline"] },
    { label:"WEIGHTED VALUE", value:usd(Math.round(weighted)), sub:"probability-adjusted", color:"#10b981", nav:["crm","pipeline"] },
    { label:"WIN RATE", value:`${winRate}%`, sub:`${won.length} won / ${deals.length} total`, color:"#6366f1", nav:["crm","deals"] },
    { label:"TASKS TODAY", value:todayTasks.length, sub:`${overdue.length} overdue`, color:overdue.length?"#ef4444":"#f59e0b", nav:["crm","tasks"] },
    { label:"CONTACTS", value:contacts.length, sub:`${contacts.filter(c=>c.lead_status==="qualified").length} qualified`, color:"#3b82f6", nav:["crm","contacts"] },
    { label:"CAMPAIGNS SENT", value:sentCampaigns.length, sub:`${sentCampaigns.reduce((s,c)=>s+(c.recipient_count||0),0)} total reaches`, color:"#a78bfa", nav:["marketing"] },
  ];

  return (
    <div style={{ flex:1,overflow:"auto",padding:"18px 20px",display:"flex",flexDirection:"column",gap:14 }}>
      {/* Header */}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between" }}>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37" }}>COMMAND CENTER</div>
          <div style={{ fontSize:8,color:"#333",letterSpacing:".1em" }}>{new Date().toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"}).toUpperCase()}</div>
        </div>
        <div style={{ display:"flex",gap:8 }}>
          <Btn onClick={onNewTask} style={{ fontSize:9 }}>+ TASK</Btn>
          <Btn onClick={onNewDeal} variant="gold" style={{ fontSize:9 }}>+ DEAL</Btn>
          <Btn onClick={getDailyBriefing} variant="purple" disabled={briefingLoading} style={{ fontSize:9 }}>
            {briefingLoading?<span className="pulse">🧠 briefing...</span>:"🧠 AI DAILY BRIEFING"}
          </Btn>
        </div>
      </div>

      {/* AI Briefing */}
      {briefing&&(
        <div style={{ background:"rgba(139,92,246,.04)",border:"1px solid rgba(139,92,246,.2)",borderRadius:6,padding:"14px 16px" }} className="fi">
          <div style={{ fontSize:8,color:"#8b5cf6",letterSpacing:".12em",marginBottom:8 }}>⬡ AI DAILY BRIEFING</div>
          <pre style={{ fontSize:11,color:"#c4c0d8",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0 }}>{briefing}</pre>
          <button onClick={()=>setBriefing("")} style={{ background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:9,marginTop:8 }}>dismiss</button>
        </div>
      )}

      {/* KPI Row */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:10 }}>
        {KPI.map(k=>(
          <div key={k.label} onClick={()=>onNav(...k.nav)} style={{ background:"#0d0d18",border:`1px solid #1e1e28`,borderRadius:6,padding:"12px 14px",cursor:"pointer",transition:"border-color .15s" }} className="card">
            <div style={{ fontSize:8,color:"#444",letterSpacing:".1em",marginBottom:6 }}>{k.label}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:k.color,letterSpacing:".05em" }}>{k.value}</div>
            <div style={{ fontSize:8,color:"#333",marginTop:2 }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts Row */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>DEALS BY STAGE</div>
          {stageData.length>0?(
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={stageData} margin={{top:0,right:0,bottom:0,left:-20}}>
                <XAxis dataKey="name" tick={{fill:"#555",fontSize:7,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} />
                <YAxis tick={{fill:"#555",fontSize:8,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip contentStyle={{background:"#0b0b16",border:"1px solid #2a2a3a",borderRadius:4,fontFamily:"DM Mono",fontSize:10}} labelStyle={{color:"#d4af37"}} itemStyle={{color:"#888"}} />
                <Bar dataKey="count" radius={[2,2,0,0]}>{stageData.map((d,i)=><Cell key={i} fill={d.color} fillOpacity={0.8}/>)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{height:160,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e1e2e",fontSize:10}}>No open deals</div>}
        </div>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>ACTIVITY (14 DAYS)</div>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={activityData} margin={{top:4,right:0,bottom:0,left:-20}}>
              <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#6366f1" stopOpacity={0.3}/><stop offset="95%" stopColor="#6366f1" stopOpacity={0}/></linearGradient></defs>
              <XAxis dataKey="label" tick={{fill:"#555",fontSize:7,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} interval={3}/>
              <YAxis tick={{fill:"#555",fontSize:8,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} allowDecimals={false}/>
              <Tooltip contentStyle={{background:"#0b0b16",border:"1px solid #2a2a3a",borderRadius:4,fontFamily:"DM Mono",fontSize:10}} labelStyle={{color:"#6366f1"}} itemStyle={{color:"#888"}}/>
              <Area type="monotone" dataKey="count" stroke="#6366f1" strokeWidth={1.5} fill="url(#ag)" dot={false}/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Bottom panels */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12 }}>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
            <span style={{ fontSize:8,color:"#444",letterSpacing:".12em" }}>TOP OPEN DEALS</span>
            <button onClick={()=>onNav("crm","pipeline")} style={{ background:"none",border:"none",color:"#d4af37",fontFamily:"inherit",fontSize:8,cursor:"pointer" }}>VIEW ALL →</button>
          </div>
          {topDeals.length===0&&<div style={{fontSize:10,color:"#1e1e2e",padding:"12px 0"}}>No open deals</div>}
          {topDeals.map((d,i)=>{ const cfg=STAGE_CFG[d.stage]||{c:"#555",l:d.stage}; return (
            <div key={d.id} style={{display:"flex",alignItems:"center",gap:8,padding:"6px 0",borderBottom:"1px solid #111120"}}>
              <span style={{fontSize:9,color:"#2a2a3a",width:14,textAlign:"right"}}>{i+1}</span>
              <div style={{width:5,height:5,borderRadius:"50%",background:cfg.c,flexShrink:0}}/>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,color:"#c0bdb0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.title}</div><div style={{fontSize:8,color:"#444"}}>{cfg.l}</div></div>
              <span style={{fontSize:10,color:cfg.c,fontWeight:"500"}}>{usd(d.value)}</span>
            </div>
          );})}
        </div>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ display:"flex",justifyContent:"space-between",marginBottom:10 }}>
            <span style={{ fontSize:8,color:"#444",letterSpacing:".12em" }}>TASKS DUE</span>
            <button onClick={()=>onNav("crm","tasks")} style={{ background:"none",border:"none",color:"#d4af37",fontFamily:"inherit",fontSize:8,cursor:"pointer" }}>VIEW ALL →</button>
          </div>
          {pending.slice(0,6).map(t=>{ const due=fmtDue(t.due_at); return (
            <div key={t.id} style={{display:"flex",alignItems:"flex-start",gap:8,padding:"6px 0",borderBottom:"1px solid #111120"}}>
              <span style={{fontSize:10,flexShrink:0,marginTop:1}}>{TASK_ICONS[t.type]||"☑"}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,color:"#c0bdb0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div><Bd label={PRIORITY_CFG[t.priority]?.l||t.priority||"low"} color={PRIORITY_CFG[t.priority]?.c||"#555"}/></div>
              {due&&<span style={{fontSize:8,color:due.color,flexShrink:0,marginTop:1}}>{due.label}</span>}
            </div>
          );})}
          {pending.length===0&&<div style={{fontSize:10,color:"#1e1e2e",padding:"12px 0"}}>All clear 🎉</div>}
        </div>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:10 }}>RECENT ACTIVITY</div>
          {activities.slice(0,6).map(a=>{ const icons={call:"📞",email:"✉",meeting:"📅",note:"📝",task:"☑",sms:"💬"}; return (
            <div key={a.id} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid #111120"}}>
              <span style={{fontSize:11}}>{icons[a.type]||"•"}</span>
              <div style={{flex:1,minWidth:0}}><div style={{fontSize:10,color:"#999",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{a.subject||a.type}</div><div style={{fontSize:8,color:"#333"}}>{ago(a.created_at)}</div></div>
            </div>
          );})}
          {activities.length===0&&<div style={{fontSize:10,color:"#1e1e2e"}}>No activity yet</div>}
        </div>
      </div>
    </div>
  );
}

// ─── MARKETING VIEW ───────────────────────────────────────────────
function MarketingView({ contacts, campaigns, setCampaigns, showToast }) {
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");

  const filtered = campaigns.filter(c=>(filter==="all"||c.status===filter)&&(typeFilter==="all"||(c.type||"email")===typeFilter));
  const totalSent = campaigns.filter(c=>c.status==="sent").reduce((s,c)=>s+(c.recipient_count||0),0);
  const totalDrafts = campaigns.filter(c=>c.status==="draft").length;
  const emailCamps = campaigns.filter(c=>(c.type||"email")==="email"&&c.status==="sent").length;
  const smsCamps = campaigns.filter(c=>c.type==="sms"&&c.status==="sent").length;
  const phoneCamps = campaigns.filter(c=>c.type==="phone"&&c.status==="sent").length;
  const dripCamps = campaigns.filter(c=>c.type==="drip"&&(c.status==="sent"||c.status==="active")).length;

  const del = async id => {
    await sb("marketing_campaigns","DELETE",null,`?id=eq.${id}`);
    setCampaigns(p=>p.filter(c=>c.id!==id));
    showToast("Campaign deleted");
  };

  const launch = async c => {
    const updated = {...c, status:"sent", sent_at:new Date().toISOString()};
    await sb("marketing_campaigns","PATCH",{status:"sent",sent_at:updated.sent_at},`?id=eq.${c.id}`);
    setCampaigns(p=>p.map(x=>x.id===c.id?updated:x));
    showToast(`Campaign launched to ${c.recipient_count} recipients`);
  };

  const typeColors = {email:"#3b82f6",sms:"#10b981",phone:"#f59e0b",drip:"#8b5cf6"};
  const typeIcons = {email:"✉",sms:"💬",phone:"📞",drip:"🔄"};

  return (
    <div style={{ flex:1,overflow:"auto",padding:"18px 20px" }}>
      {showCreate&&<CampaignModal contacts={contacts} onClose={()=>setShowCreate(false)} onSave={(c,st)=>{ setCampaigns(p=>[c,...p]); showToast(st==="sent"?`Launched to ${c.recipient_count} recipients`:"Draft saved"); }} />}
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18 }}>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37" }}>MARKETING HQ</div>
          <div style={{ fontSize:9,color:"#444",letterSpacing:".08em" }}>EMAIL · SMS · PHONE · DRIP SEQUENCES</div>
        </div>
        <Btn onClick={()=>setShowCreate(true)} variant="gold" style={{ letterSpacing:".1em" }}>+ NEW CAMPAIGN</Btn>
      </div>

      {/* Stats row */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:8,marginBottom:16 }}>
        {[
          {l:"TOTAL SENT", v:campaigns.filter(c=>c.status==="sent").length, color:"#d4af37"},
          {l:"TOTAL REACHES", v:totalSent.toLocaleString(), color:"#e0dcd0"},
          {l:"EMAIL", v:emailCamps, color:"#3b82f6", icon:"✉"},
          {l:"SMS", v:smsCamps, color:"#10b981", icon:"💬"},
          {l:"PHONE", v:phoneCamps, color:"#f59e0b", icon:"📞"},
          {l:"DRIPS", v:dripCamps, color:"#8b5cf6", icon:"🔄"},
        ].map(s=>(
          <div key={s.l} style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"10px 12px" }}>
            <div style={{ fontSize:7,color:"#444",letterSpacing:".1em",marginBottom:3 }}>{s.icon?`${s.icon} `:""}{s.l}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:s.color }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Filter tabs */}
      <div style={{ display:"flex",gap:6,marginBottom:10 }}>
        {["all","sent","draft","active","paused"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{ background:filter===f?"rgba(212,175,55,.1)":"none",border:`1px solid ${filter===f?"rgba(212,175,55,.4)":"#1a1a28"}`,color:filter===f?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"4px 12px",borderRadius:3,cursor:"pointer",textTransform:"uppercase",letterSpacing:".08em" }}>{f}</button>
        ))}
      </div>
      <div style={{ display:"flex",gap:6,marginBottom:14 }}>
        {["all","email","sms","phone","drip"].map(t=>(
          <button key={t} onClick={()=>setTypeFilter(t)} style={{ background:typeFilter===t?`${typeColors[t]||"#d4af37"}15`:"none",border:`1px solid ${typeFilter===t?(typeColors[t]||"#d4af37")+"44":"#1a1a28"}`,color:typeFilter===t?(typeColors[t]||"#d4af37"):"#444",fontFamily:"inherit",fontSize:8,padding:"3px 10px",borderRadius:3,cursor:"pointer",textTransform:"uppercase",letterSpacing:".06em" }}>{t==="all"?"All Types":t}</button>
        ))}
      </div>

      {/* Campaign list */}
      <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
        {filtered.length===0&&(
          <div style={{ textAlign:"center",padding:60,color:"#1e1e2e" }}>
            <div style={{ fontSize:32,marginBottom:10 }}>📣</div>
            <div style={{ fontSize:11,marginBottom:8 }}>No campaigns yet</div>
            <Btn onClick={()=>setShowCreate(true)} variant="gold">CREATE FIRST CAMPAIGN</Btn>
          </div>
        )}
        {filtered.map(c=>{
          const isSent = c.status==="sent";
          const cType = c.type||"email";
          const hash = (c.id||c.name||"").split("").reduce((a,ch)=>((a<<5)-a)+ch.charCodeAt(0),0);
          const mockOpen = isSent&&cType==="email" ? 18+Math.abs(hash%40) : null;
          const mockClick = isSent&&cType==="email" ? 3+Math.abs((hash*7)%15) : null;
          const mockDelivered = isSent&&cType==="sms" ? 85+Math.abs(hash%14) : null;
          const mockConnected = isSent&&cType==="phone" ? 30+Math.abs(hash%35) : null;
          return (
            <div key={c.id||c.name} style={{ background:"#0d0d18",border:`1px solid ${typeColors[cType]||"#1e1e28"}18`,borderRadius:6,padding:"14px 16px",display:"flex",gap:14,alignItems:"flex-start" }}>
              <div style={{fontSize:18,flexShrink:0,marginTop:2}}>{typeIcons[cType]||"✉"}</div>
              <div style={{ flex:1,minWidth:0 }}>
                <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:4,flexWrap:"wrap" }}>
                  <span style={{ fontSize:12,color:"#e0dcd0" }}>{c.name}</span>
                  <Bd label={cType} color={typeColors[cType]||"#555"} />
                  <Bd label={c.status} color={isSent?"#10b981":c.status==="active"?"#3b82f6":"#f59e0b"} />
                  <Bd label={`${c.recipient_count||0} recipients`} color="#555" />
                  {isSent&&<span style={{ fontSize:8,color:"#444" }}>{ago(c.sent_at)}</span>}
                </div>
                <div style={{ fontSize:10,color:"#555",marginBottom:8,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                  {cType==="sms"?(c.sms_body||""):(c.subject||"")}
                </div>
                {/* Type-specific stats */}
                {isSent&&cType==="email"&&mockOpen&&(
                  <div style={{ display:"flex",gap:14 }}>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>OPEN RATE</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${mockOpen}%`,height:"100%",background:"#10b981",borderRadius:2}}/></div><span style={{fontSize:10,color:"#10b981"}}>{mockOpen}%</span></div></div>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>CLICK RATE</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${mockClick}%`,height:"100%",background:"#3b82f6",borderRadius:2}}/></div><span style={{fontSize:10,color:"#3b82f6"}}>{mockClick}%</span></div></div>
                  </div>
                )}
                {isSent&&cType==="sms"&&mockDelivered&&(
                  <div style={{display:"flex",gap:14}}>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>DELIVERED</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${mockDelivered}%`,height:"100%",background:"#10b981",borderRadius:2}}/></div><span style={{fontSize:10,color:"#10b981"}}>{mockDelivered}%</span></div></div>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>REPLIED</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${5+Math.abs((hash*3)%12)}%`,height:"100%",background:"#3b82f6",borderRadius:2}}/></div><span style={{fontSize:10,color:"#3b82f6"}}>{5+Math.abs((hash*3)%12)}%</span></div></div>
                  </div>
                )}
                {isSent&&cType==="phone"&&mockConnected&&(
                  <div style={{display:"flex",gap:14}}>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>CONNECTED</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${mockConnected}%`,height:"100%",background:"#f59e0b",borderRadius:2}}/></div><span style={{fontSize:10,color:"#f59e0b"}}>{mockConnected}%</span></div></div>
                    <div><div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>INTERESTED</div><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:80,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${10+Math.abs((hash*5)%20)}%`,height:"100%",background:"#10b981",borderRadius:2}}/></div><span style={{fontSize:10,color:"#10b981"}}>{10+Math.abs((hash*5)%20)}%</span></div></div>
                  </div>
                )}
                {cType==="drip"&&c.drip_steps&&(
                  <div style={{display:"flex",gap:4,alignItems:"center"}}>
                    {(typeof c.drip_steps==="string"?JSON.parse(c.drip_steps):c.drip_steps).map((step,i)=>(
                      <div key={i} style={{display:"flex",alignItems:"center",gap:3}}>
                        <span style={{fontSize:7,color:typeColors[step.type]||"#555",background:`${typeColors[step.type]||"#555"}15`,padding:"2px 5px",borderRadius:2}}>D{step.delay_days} {step.type==="email"?"✉":"💬"}</span>
                        {i<(typeof c.drip_steps==="string"?JSON.parse(c.drip_steps):c.drip_steps).length-1&&<span style={{color:"#2a2a3a"}}>→</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ display:"flex",gap:6,flexShrink:0 }}>
                {!isSent&&c.status!=="active"&&<Btn onClick={()=>launch(c)} variant="gold" style={{ fontSize:8,padding:"4px 10px" }}>🚀 LAUNCH</Btn>}
                <Btn onClick={()=>del(c.id||c.name)} variant="red" style={{ fontSize:8,padding:"4px 10px" }}>DEL</Btn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── SMART LEAD IMPORTER (drag-drop CSV/Excel with AI analysis) ────────
function SmartLeadImporter({ contacts, businesses, showToast }) {
  const [step, setStep] = useState("drop"); // drop | mapping | analyzing | results
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [colMap, setColMap] = useState({});
  const [mapped, setMapped] = useState([]);
  const [analyzed, setAnalyzed] = useState([]);
  const [strategies, setStrategies] = useState(null);
  const [importing, setImporting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [listType, setListType] = useState("general");
  const [filterStatus, setFilterStatus] = useState("all");
  const [showStrategies, setShowStrategies] = useState(false);
  const [totalRows, setTotalRows] = useState(0);
  const [multiFiles, setMultiFiles] = useState([]); // for multi-file drop
  const fileRef = useRef(null);
  const cancelRef = useRef(false);

  // ─── Comprehensive field definitions ───
  const FIELDS = [
    {key:"full_name",label:"Full Name",group:"core",required:true},
    {key:"first_name",label:"First Name",group:"core"},
    {key:"last_name",label:"Last Name",group:"core"},
    {key:"email",label:"Email",group:"core"},
    {key:"phone",label:"Phone",group:"core"},
    {key:"cell_phone",label:"Cell Phone",group:"core"},
    {key:"home_phone",label:"Home Phone",group:"core"},
    {key:"company",label:"Company",group:"core"},
    {key:"title",label:"Title/Position",group:"core"},
    {key:"address",label:"Property Address",group:"address"},
    {key:"city",label:"City",group:"address"},
    {key:"state",label:"State",group:"address"},
    {key:"zip",label:"Zip",group:"address"},
    {key:"county",label:"County",group:"address"},
    {key:"lender",label:"Lender Name",group:"mortgage"},
    {key:"mortgage_type",label:"Mortgage Type",group:"mortgage"},
    {key:"current_balance",label:"Current Balance",group:"mortgage"},
    {key:"current_rate",label:"Current Rate %",group:"mortgage"},
    {key:"current_payment",label:"Current Payment",group:"mortgage"},
    {key:"potential_payment",label:"Potential New Payment",group:"mortgage"},
    {key:"monthly_savings",label:"Monthly Savings",group:"mortgage"},
    {key:"rate_improvement",label:"Rate Improvement",group:"mortgage"},
    {key:"current_ltv",label:"Current LTV %",group:"mortgage"},
    {key:"available_equity",label:"Available Equity",group:"mortgage"},
    {key:"loan_start_date",label:"Loan Start Date",group:"mortgage"},
    {key:"recorded_date",label:"Recorded Date",group:"mortgage"},
    {key:"mortgage_amount",label:"Mortgage Amount",group:"mortgage"},
    {key:"property_value",label:"Property Value",group:"property"},
    {key:"loan_amount",label:"Loan Amount",group:"property"},
    {key:"year_built",label:"Year Built",group:"property"},
    {key:"absentee_owner",label:"Absentee Owner",group:"property"},
    {key:"homestead_exempt",label:"Homestead Exempt",group:"property"},
    {key:"foreclosure",label:"Foreclosure",group:"property"},
    {key:"tax_amount",label:"Tax Amount",group:"property"},
    {key:"moneymoves",label:"MoneyMoves Score",group:"property"},
    {key:"credit_score",label:"Credit Score/Rating",group:"demographic"},
    {key:"income",label:"Income",group:"demographic"},
    {key:"net_worth",label:"Net Worth",group:"demographic"},
    {key:"wealth_rating",label:"Wealth Rating",group:"demographic"},
    {key:"age",label:"Age",group:"demographic"},
    {key:"dob",label:"Date of Birth",group:"demographic"},
    {key:"medicare_eligible",label:"Medicare Eligible",group:"demographic"},
    {key:"gender",label:"Gender",group:"demographic"},
    {key:"marital_status",label:"Marital Status",group:"demographic"},
    {key:"education",label:"Education",group:"demographic"},
    {key:"occupation",label:"Occupation",group:"demographic"},
    {key:"veteran",label:"Veteran",group:"demographic"},
    {key:"language",label:"Language",group:"demographic"},
    {key:"dnc_home",label:"DNC Home",group:"compliance"},
    {key:"dnc_cell",label:"DNC Cell",group:"compliance"},
    {key:"federal_dnc",label:"Federal DNC",group:"compliance"},
    {key:"office_name",label:"Office/Brokerage Name",group:"professional"},
    {key:"office_address",label:"Office Address",group:"professional"},
    {key:"volume",label:"Sales Volume",group:"professional"},
    {key:"unit_count",label:"Unit/Transaction Count",group:"professional"},
    {key:"license_number",label:"License Number",group:"professional"},
    {key:"license_type",label:"License Type",group:"professional"},
    {key:"specialty",label:"Specialty",group:"professional"},
    {key:"nmls",label:"NMLS #",group:"professional"},
    {key:"notes",label:"Notes",group:"other"},
    {key:"source",label:"Source/Origin",group:"other"},
    {key:"skip",label:"— Skip Column —",group:"skip"},
  ];

  // ─── Dictionary: 200+ column name mappings ───
  const COLUMN_DICTIONARY = {
    "BORROWERFULLNAME":"full_name","BORROWER":"full_name","BORROWER FULL NAME":"full_name","BORROWER NAME":"full_name",
    "PROPERTY ADDRESS":"address","PROPERTYADDRESS":"address","PROPERTY STREET":"address","SITUS ADDRESS":"address","SITE ADDRESS":"address",
    "PROPERTYCITYNAME":"city","PROPERTY CITY":"city","PROPERTYCITY":"city","SITUS CITY":"city",
    "PROPERTYSTATE":"state","PROPERTY STATE":"state","SITUSSTATE":"state","SITUS STATE":"state",
    "PROPERTYZIPCODE":"zip","PROPERTY ZIP":"zip","PROPERTYZIPCODE5":"zip","SITUS ZIP":"zip",
    "LENDERNAME":"lender","LENDER":"lender","LENDER NAME":"lender","ORIGINATING LENDER":"lender",
    "MORTGAGETYPENAME":"mortgage_type","MORTGAGE TYPE":"mortgage_type","LOAN TYPE":"mortgage_type","LOAN PURPOSE":"mortgage_type",
    "MONEYMOVES":"moneymoves","MONEY MOVES":"moneymoves",
    "CURRENT BALANCE":"current_balance","CURRENTBALANCE":"current_balance","REMAINING BALANCE":"current_balance","UNPAID BALANCE":"current_balance",
    "PROPERTY VALUE":"property_value","PROPERTYVALUE":"property_value","ESTIMATED VALUE":"property_value","AVM VALUE":"property_value","ASSESSED VALUE":"property_value","CURRENT HOME VALUE":"property_value","HOME VALUE":"property_value",
    "CURRENT LTV":"current_ltv","LTV":"current_ltv","LOAN TO VALUE":"current_ltv",
    "CURRENT RATE":"current_rate","INTEREST RATE":"current_rate","RATE":"current_rate","NOTE RATE":"current_rate","ORIGINAL RATE":"current_rate",
    "CURRENT PAYMENT":"current_payment","MONTHLY PAYMENT":"current_payment","PAYMENT AMOUNT":"current_payment",
    "POTENTIAL NEW PAYMENT":"potential_payment","NEW PAYMENT":"potential_payment",
    "MONTHLY SAVINGS":"monthly_savings","SAVINGS":"monthly_savings",
    "RATE IMPROVEMENT":"rate_improvement",
    "AVAILABLE EQUITY":"available_equity","EQUITY":"available_equity","AVAILABLE EQUITY $":"available_equity",
    "LOAN START DATE":"loan_start_date","ORIGINATION DATE":"loan_start_date","LOAN DATE":"loan_start_date",
    "RECORDED DATE":"recorded_date","RECORDING DATE":"recorded_date",
    "FIRST NAME":"first_name","FIRSTNAME":"first_name","FIRST":"first_name","FNAME":"first_name",
    "LAST NAME":"last_name","LASTNAME":"last_name","LAST":"last_name","LNAME":"last_name",
    "ADDRESS 1":"address","ADDRESS1":"address","ADDRESS":"address","STREET":"address","STREET ADDRESS":"address",
    "CITY":"city","TOWN":"city",
    "ST":"state","STATE":"state",
    "ZIP":"zip","ZIPCODE":"zip","ZIP CODE":"zip","ZIP5":"zip",
    "HOME PHONE":"home_phone","HOMEPHONE":"home_phone","HOME TELEPHONE":"home_phone",
    "CELL PHONE":"cell_phone","CELLPHONE":"cell_phone","MOBILE":"cell_phone","MOBILE PHONE":"cell_phone","CELL":"cell_phone",
    "DNC HOME":"dnc_home","DNC CELL":"dnc_cell","FEDERAL DNC":"federal_dnc","FEDERAL CELL DNC":"federal_dnc",
    "EMAIL ADDRESS":"email","EMAIL":"email","E-MAIL":"email",
    "CREDIT RATING":"credit_score","CREDIT SCORE":"credit_score","FICO":"credit_score","FICO SCORE":"credit_score",
    "INCOME":"income","HOUSEHOLD INCOME":"income","ANNUAL INCOME":"income","ESTIMATED INCOME":"income",
    "NET WORTH":"net_worth","NETWORTH":"net_worth","ESTIMATED NET WORTH":"net_worth",
    "WEALTH RATING":"wealth_rating","WEALTH SCORE":"wealth_rating",
    "AGE":"age","HOMEOWNER AGE":"age","EDAD":"age",
    "DATE OF BIRTH":"dob","DOB":"dob","BIRTHDATE":"dob",
    "GENDER":"gender","SEX":"gender",
    "MARITAL STATUS":"marital_status","MARITAL":"marital_status",
    "EDUCATION CODE":"education","EDUCATION":"education",
    "OCCUPATION":"occupation","OCCUPATION CODE":"occupation",
    "VETERAN IN HOUSEHOLD":"veteran","VETERAN":"veteran",
    "LANGUAGE":"language","COUNTY":"county",
    "MORTGAGE AMOUNT":"mortgage_amount","MORTGAGE BALANCE":"mortgage_amount",
    "EFFECTIVE YEAR BUILT":"year_built","YEAR BUILT":"year_built","YR BUILT":"year_built",
    "ABSENTEE OWNER STATUS":"absentee_owner","ABSENTEE OWNER":"absentee_owner","ABSENTEE":"absentee_owner",
    "HOMESTEA EXEMPT":"homestead_exempt","HOMESTEAD EXEMPT":"homestead_exempt","HOMESTEAD":"homestead_exempt",
    "FORECLOSURE":"foreclosure","FORECLOSURE STATUS":"foreclosure","PRE-FORECLOSURE":"foreclosure",
    "TAX AMOUNT":"tax_amount","ANNUAL TAX":"tax_amount","PROPERTY TAX":"tax_amount",
    "OWNER NAME":"full_name","OWNER 1":"full_name","OWNER FULL NAME":"full_name",
    "MAIL ADDRESS":"address","MAILING ADDRESS":"address",
    "SALE PRICE":"property_value","LAST SALE PRICE":"property_value",
    "SALE DATE":"recorded_date","LAST SALE DATE":"recorded_date",
    "LEGAL DESCRIPTION":"notes","PROPERTY USE":"notes","LAND USE":"notes",
    "TOTAL VALUE":"property_value","MARKET VALUE":"property_value",
    "LOT SIZE":"notes","SQUARE FOOTAGE":"notes","BUILDING SQFT":"notes",
    "BEDROOMS":"notes","BATHROOMS":"notes","STORIES":"notes",
    "HEAD HOUSEHOLD":"notes","ONLINE EDUCATION":"notes",
    // Professional / Agent / Officer lists
    "OFFICE NAME":"office_name","BROKERAGE":"office_name","BROKERAGE NAME":"office_name","COMPANY NAME":"office_name","FIRM":"office_name","FIRM NAME":"office_name",
    "OFFICE ADDRESS":"office_address","BUSINESS ADDRESS":"office_address","BROKERAGE ADDRESS":"office_address",
    "VOLUME":"volume","SALES VOLUME":"volume","TOTAL VOLUME":"volume","PRODUCTION":"volume","LOAN VOLUME":"volume","ANNUAL VOLUME":"volume",
    "UNIT COUNT":"unit_count","UNITS":"unit_count","TRANSACTIONS":"unit_count","TRANSACTION COUNT":"unit_count","CLOSED UNITS":"unit_count","SIDES":"unit_count",
    "LICENSE":"license_number","LICENSE NUMBER":"license_number","LICENSE #":"license_number","LICENSE NO":"license_number","LIC #":"license_number","LIC NUMBER":"license_number",
    "LICENSE TYPE":"license_type","LIC TYPE":"license_type",
    "SPECIALTY":"specialty","SPECIALIZATION":"specialty","DESIGNATION":"specialty","DESIGNATIONS":"specialty",
    "NMLS":"nmls","NMLS #":"nmls","NMLS NUMBER":"nmls","NMLS ID":"nmls",
    "NAME":"full_name","AGENT NAME":"full_name","OFFICER NAME":"full_name","LO NAME":"full_name","REALTOR NAME":"full_name","AGENT":"full_name",
    "PHONE":"phone","AGENT PHONE":"phone","OFFICE PHONE":"phone","DIRECT PHONE":"phone","WORK PHONE":"phone",
    "AGENT EMAIL":"email","WORK EMAIL":"email","BUSINESS EMAIL":"email","DIRECT EMAIL":"email",
  };

  const parseMoney = (v) => { if(!v) return 0; return parseFloat(String(v).replace(/[$,\s%]/g,""))||0; };

  const parseCSV = (text) => {
    const lines = text.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2) return {headers:[],rows:[]};
    const delim = (lines[0].match(/\t/g)||[]).length > (lines[0].match(/,/g)||[]).length ? "\t" : ",";
    const parseRow = line => {
      const result = []; let current = ""; let inQuote = false;
      for(const ch of line) {
        if(ch==='"') { inQuote=!inQuote; continue; }
        if(ch===delim && !inQuote) { result.push(current.trim()); current=""; continue; }
        current+=ch;
      }
      result.push(current.trim());
      return result;
    };
    const hdrs = parseRow(lines[0]);
    const rows = lines.slice(1).map(parseRow).filter(r=>r.some(c=>c));
    return {headers:hdrs, rows};
  };

  const autoMapColumns = (hdrs) => {
    const map = {};
    hdrs.forEach((h,i)=>{
      const norm = h.trim().toUpperCase();
      if(COLUMN_DICTIONARY[norm]) { map[i]=COLUMN_DICTIONARY[norm]; return; }
      const normNoSpace = norm.replace(/[_\s]+/g," ").trim();
      if(COLUMN_DICTIONARY[normNoSpace]) { map[i]=COLUMN_DICTIONARY[normNoSpace]; return; }
    });
    const patterns = {
      full_name: /^(name|full.?name|contact|client|lead.?name|borrower)$/i,
      email: /^(email|e.?mail|mail|email.?addr)/i,
      phone: /^(phone|tel|telephone|mobile|cell|ph|number)$/i,
      company: /^(company|business|org|employer|firm)$/i,
      title: /^(title|position|role|job.?title)$/i,
      address: /^(address|street|addr|address.?1|street.?addr)/i,
      city: /^(city|town|municipality)$/i,
      state: /^(state|province|st|region)$/i,
      zip: /^(zip|postal|zip.?code|postal.?code)$/i,
      credit_score: /^(credit|score|fico|credit.?(score|rating))$/i,
      income: /^(income|salary|earnings|annual.?income|gross)$/i,
      property_value: /^(property|value|home.?value|property.?value|appraisal|price)$/i,
      loan_amount: /^(loan|amount|mortgage|loan.?amount|balance|principal)$/i,
      current_rate: /^(rate|interest|current.?rate|note.?rate)$/i,
      lender: /^(lender|bank|servicer|originator)$/i,
    };
    hdrs.forEach((h,i)=>{
      if(map[i]) return;
      for(const [field,rx] of Object.entries(patterns)) {
        if(rx.test(h) && !Object.values(map).includes(field)) { map[i]=field; break; }
      }
      if(!map[i]) map[i]="skip";
    });
    const mappedFields = new Set(Object.values(map));
    if(mappedFields.has("volume")||mappedFields.has("unit_count")||mappedFields.has("office_name")||mappedFields.has("nmls")||mappedFields.has("license_number")) setListType("professional");
    else if(mappedFields.has("current_rate")||mappedFields.has("current_balance")||mappedFields.has("monthly_savings")||mappedFields.has("lender")||mappedFields.has("current_ltv")) setListType("mortgage");
    else if(mappedFields.has("year_built")||mappedFields.has("absentee_owner")||mappedFields.has("foreclosure")||mappedFields.has("tax_amount")) setListType("property");
    else if(mappedFields.has("credit_score")||mappedFields.has("income")||mappedFields.has("wealth_rating")||mappedFields.has("net_worth")) setListType("demographic");
    else setListType("general");
    return map;
  };

  const handleFile = (file) => {
    if(!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      const {headers:hdrs, rows} = parseCSV(text);
      if(!hdrs.length) { showToast("Could not parse file — ensure it's CSV or tab-separated"); return; }
      setHeaders(hdrs);
      setRawRows(rows);
      setTotalRows(rows.length);
      setColMap(autoMapColumns(hdrs));
      setStep("mapping");
      showToast(`Loaded ${rows.length.toLocaleString()} rows with ${hdrs.length} columns`);
    };
    reader.readAsText(file);
  };

  // Multi-file handler — merge CSVs with same headers
  const handleMultiFile = async (files) => {
    const allFiles = Array.from(files).filter(f=>f.name.match(/\.(csv|tsv|txt)$/i));
    if(!allFiles.length) { showToast("No CSV files found"); return; }
    setMultiFiles(allFiles.map(f=>f.name));
    setProgress(`Reading ${allFiles.length} files...`);

    let allHeaders = null;
    let allRows = [];
    for(let fi=0; fi<allFiles.length; fi++) {
      setProgress(`Reading file ${fi+1}/${allFiles.length}: ${allFiles[fi].name}...`);
      const text = await allFiles[fi].text();
      const {headers:hdrs, rows} = parseCSV(text);
      if(!hdrs.length) continue;
      if(!allHeaders) allHeaders = hdrs;
      // If headers match, just append rows. If different, try to align or skip.
      if(hdrs.length===allHeaders.length && hdrs.every((h,i)=>h.toUpperCase()===allHeaders[i].toUpperCase())) {
        allRows = allRows.concat(rows);
      } else {
        // Different format — create index mapping from this file's headers to master headers
        const idxMap = {};
        hdrs.forEach((h,i)=>{
          const match = allHeaders.findIndex(ah=>ah.toUpperCase()===h.toUpperCase());
          if(match>=0) idxMap[i]=match;
        });
        rows.forEach(row=>{
          const aligned = new Array(allHeaders.length).fill("");
          Object.entries(idxMap).forEach(([from,to])=>{ aligned[to]=row[parseInt(from)]||""; });
          allRows.push(aligned);
        });
      }
    }
    if(!allHeaders||!allRows.length) { showToast("No data found in files"); setProgress(""); return; }
    setHeaders(allHeaders);
    setRawRows(allRows);
    setTotalRows(allRows.length);
    setColMap(autoMapColumns(allHeaders));
    setStep("mapping");
    setProgress("");
    showToast(`Loaded ${allRows.length.toLocaleString()} rows from ${allFiles.length} files`);
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    const files = e.dataTransfer?.files;
    if(files?.length>1) handleMultiFile(files);
    else if(files?.[0]) handleFile(files[0]);
  };

  // ─── RULE-BASED SCORING ENGINE (instant, no AI cost) ───
  const scoreLeadByRules = (lead) => {
    let score = 20; // baseline
    const flags = [];
    let best_service = null;
    let second_service = null;
    let third_service = null;
    const tags = [];
    let est_revenue = 500; // base potential
    let strategy = "";

    const rate = parseMoney(lead.current_rate);
    const balance = parseMoney(lead.current_balance);
    const propVal = parseMoney(lead.property_value);
    const savings = parseMoney(lead.monthly_savings);
    const equity = parseMoney(lead.available_equity);
    const ltv = parseMoney(lead.current_ltv);
    const creditNum = parseInt(String(lead.credit_score||"").replace(/\D/g,""))||0;
    const incomeNum = parseMoney((lead.income||"").replace(/[^\d.]/g,""));
    const yearBuilt = parseInt(lead.year_built)||0;
    const age = parseInt(lead.age)||0;
    const isAbsentee = /yes|y|true|absentee|out.of.state/i.test(lead.absentee_owner||"");
    const isForeclosure = /yes|y|true|pre.?forecl|forecl/i.test(lead.foreclosure||"");
    const mortgageType = (lead.mortgage_type||"").toLowerCase();
    const isDNC = /do.not|dnc|no/i.test(lead.dnc_cell||"") || /do.not|dnc|no/i.test(lead.federal_dnc||"");

    // ── MORTGAGE SCORING ──
    if(rate > 0) {
      if(rate >= 8) { score += 30; flags.push("refi_candidate"); tags.push("high_rate"); est_revenue += 4000; strategy = `Refi from ${rate}% — massive savings opportunity`; }
      else if(rate >= 6.5) { score += 20; flags.push("refi_candidate"); tags.push("refi_opportunity"); est_revenue += 2500; strategy = `Rate reduction from ${rate}% to current market`; }
      else if(rate >= 5) { score += 8; tags.push("moderate_rate"); }
    }
    if(savings > 200) { score += 15; tags.push("high_savings"); est_revenue += savings * 12; }
    else if(savings > 100) { score += 8; tags.push("good_savings"); est_revenue += savings * 6; }
    if(equity > 200000) { score += 20; flags.push("high_equity"); tags.push("cash_out_candidate"); est_revenue += 5000; if(!strategy) strategy = `Cash-out refi — $${Math.round(equity).toLocaleString()} equity available`; }
    else if(equity > 100000) { score += 12; flags.push("high_equity"); tags.push("equity_available"); est_revenue += 3000; }
    else if(equity > 50000) { score += 6; tags.push("some_equity"); est_revenue += 1500; }
    if(balance > 500000) { score += 8; tags.push("jumbo_loan"); est_revenue += 2000; }
    if(ltv > 80) { tags.push("high_ltv"); } else if(ltv > 0 && ltv < 60) { score += 5; tags.push("low_ltv_strong"); }
    if(mortgageType.includes("arm")) { score += 15; flags.push("refi_candidate"); tags.push("ARM_holder"); est_revenue += 2000; if(!strategy) strategy = "ARM holder — convert to fixed rate before adjustment"; }

    // ── PROPERTY / CONSTRUCTION SCORING ──
    if(yearBuilt > 0 && yearBuilt < 1990) { score += 12; flags.push("construction_ready"); flags.push("violation_likely"); tags.push("old_build"); est_revenue += 3000; if(!strategy) strategy = `Built ${yearBuilt} — renovation, code compliance, or value-add construction`; }
    else if(yearBuilt > 0 && yearBuilt < 2005) { score += 5; flags.push("construction_ready"); tags.push("aging_home"); est_revenue += 1500; }
    if(isAbsentee) { score += 10; flags.push("absentee"); tags.push("investor_or_distressed"); est_revenue += 2000; if(!strategy) strategy = "Absentee owner — fix & flip, list property, or construction services"; }
    if(isForeclosure) { score += 15; tags.push("distressed"); est_revenue += 5000; if(!strategy) strategy = "Pre-foreclosure — urgent refi, short sale, or investor flip opportunity"; }
    if(propVal > 500000) { score += 8; tags.push("high_value_property"); est_revenue += 1500; }

    // ── CREDIT / DEMOGRAPHIC SCORING ──
    if(creditNum > 0 && creditNum < 620) { score += 15; flags.push("needs_credit_help"); tags.push("credit_optimization"); est_revenue += 2000; if(!strategy) strategy = "Credit optimization candidate — improve score, then qualify for better rates"; }
    else if(creditNum >= 620 && creditNum < 700) { score += 8; flags.push("needs_credit_help"); tags.push("credit_improvement"); est_revenue += 1200; }
    else if(creditNum >= 740) { score += 5; tags.push("excellent_credit"); }
    if(incomeNum > 150000) { score += 10; tags.push("high_income"); flags.push("investor"); est_revenue += 2000; }
    else if(incomeNum > 75000) { score += 5; tags.push("good_income"); }
    if(age >= 25 && age <= 45) { score += 3; flags.push("first_time_buyer"); tags.push("prime_age"); }

    // ── PROFESSIONAL / PARTNER SCORING ──
    const vol = parseMoney(lead.volume);
    const units = parseInt(lead.unit_count)||0;
    if(vol > 0 || units > 0 || lead.office_name) {
      // This is a professional (realtor, loan officer, etc.) — score by production
      if(vol > 50000000) { score += 25; tags.push("top_producer"); est_revenue += 10000; strategy = `Top producer ($${(vol/1000000).toFixed(0)}M vol) — partnership, referrals, brokerage recruitment`; }
      else if(vol > 10000000) { score += 18; tags.push("high_producer"); est_revenue += 5000; strategy = `High producer ($${(vol/1000000).toFixed(0)}M vol) — cross-refer mortgage, insurance, credit clients`; }
      else if(vol > 1000000) { score += 10; tags.push("active_agent"); est_revenue += 2500; strategy = `Active agent ($${(vol/1000000).toFixed(1)}M) — offer mortgage, insurance, credit optimization services`; }
      else { score += 4; tags.push("agent"); est_revenue += 1000; }
      if(units > 50) { score += 10; tags.push("high_volume_transactions"); }
      else if(units > 20) { score += 5; tags.push("steady_transactions"); }
      flags.push("professional_partner");
      if(lead.office_name) tags.push(lead.office_name.substring(0,30));
    }

    // ── DATA COMPLETENESS BONUS ──
    if(lead.email) { score += 3; tags.push("has_email"); }
    if(lead.phone || lead.cell_phone || lead.home_phone) { score += 3; tags.push("has_phone"); }
    if(isDNC) { score -= 5; tags.push("DNC_restricted"); }

    // Cap score at 100
    score = Math.min(100, Math.max(1, score));
    const status = score >= 70 ? "hot" : score >= 40 ? "warm" : "cold";

    // ── SERVICE ASSIGNMENT (rule-based by data available) ──
    const bizByType = {};
    businesses.forEach(b=>{ bizByType[b.type?.toLowerCase()||b.name?.toLowerCase()] = b.name; });
    const findBiz = (...types) => { for(const t of types) { for(const [k,v] of Object.entries(bizByType)) { if(k.includes(t)) return v; } } return null; };

    if(vol > 0 || units > 0 || lead.office_name) {
      // Professional — primary service is partnership/brokerage recruitment
      best_service = findBiz("real estate","realty","brokerage") || businesses[0]?.name;
      second_service = findBiz("mortgage","lending","loan");
      third_service = findBiz("insurance","insur");
      if(!strategy || strategy.includes("consultation")) strategy = `Partner opportunity — offer all Ziarem services they don't provide`;
    } else if(rate > 5 || balance > 0 || savings > 0 || equity > 0) {
      best_service = findBiz("mortgage","lending","loan") || businesses[0]?.name;
      if(creditNum > 0 && creditNum < 700) second_service = findBiz("credit");
      if(propVal > 300000) third_service = findBiz("insurance","insur");
      if(!third_service && yearBuilt < 2000) third_service = findBiz("construct","build","contrac");
    } else if(yearBuilt > 0 || isAbsentee || isForeclosure) {
      best_service = findBiz("construct","build","contrac","real estate") || businesses[0]?.name;
      second_service = findBiz("mortgage","lending","loan");
      third_service = findBiz("insurance","insur");
    } else if(creditNum > 0 && creditNum < 700) {
      best_service = findBiz("credit") || businesses[0]?.name;
      second_service = findBiz("mortgage","lending","loan");
      third_service = findBiz("insurance","insur");
    } else if(incomeNum > 0) {
      best_service = findBiz("mortgage","lending","real estate") || businesses[0]?.name;
      second_service = findBiz("insurance","insur");
      third_service = findBiz("account","tax","financial");
    } else {
      best_service = businesses[0]?.name || "General";
    }
    if(!strategy) strategy = `${status} lead — contact for ${best_service} consultation`;

    return { score, status, best_service, second_service, third_service, flags, tags, strategy, est_revenue, reason: strategy };
  };

  const applyMapping = () => {
    setStep("analyzing");
    setAnalyzing(true);
    setProgress(`Processing ${rawRows.length.toLocaleString()} leads...`);
    // Use setTimeout to not block UI
    setTimeout(()=>{
      const results = [];
      const CHUNK = 5000;
      const processChunk = (start) => {
        if(cancelRef.current) { setAnalyzing(false); setStep("mapping"); return; }
        const end = Math.min(start + CHUNK, rawRows.length);
        for(let i=start; i<end; i++) {
          const row = rawRows[i];
          const obj = {};
          Object.entries(colMap).forEach(([idx,field])=>{
            if(field==="skip") return;
            const val = row[parseInt(idx)]||"";
            if(field==="first_name") obj._first = val;
            else if(field==="last_name") obj._last = val;
            else obj[field] = val;
          });
          if(!obj.full_name && (obj._first||obj._last)) obj.full_name = `${obj._first||""} ${obj._last||""}`.trim();
          delete obj._first; delete obj._last;
          if(!obj.phone) obj.phone = obj.cell_phone||obj.home_phone||"";
          if(!obj.full_name) continue;
          // Score with rule engine
          const scored = scoreLeadByRules(obj);
          results.push({...obj, ...scored, _origIdx:i});
        }
        setProgress(`Scored ${end.toLocaleString()} of ${rawRows.length.toLocaleString()} leads...`);
        if(end < rawRows.length) {
          setTimeout(()=>processChunk(end), 0); // yield to UI
        } else {
          // Done scoring — sort and set
          results.sort((a,b)=>(b.score||0)-(a.score||0));
          setAnalyzed(results);
          setMapped(results);
          setAnalyzing(false);
          setStep("results");
          setProgress("");
          // Generate AI strategies on the aggregate (1 API call total)
          generateStrategies(results);
        }
      };
      processChunk(0);
    }, 50);
  };

  const generateStrategies = async (leads) => {
    const hotLeads = leads.filter(l=>l.status==="hot");
    const warmLeads = leads.filter(l=>l.status==="warm");
    const flagCounts = leads.reduce((m,l)=>{(l.flags||[]).forEach(f=>{m[f]=(m[f]||0)+1;});return m;},{});
    const svcDist = leads.reduce((m,l)=>{m[l.best_service||"Unknown"]=(m[l.best_service||"Unknown"]||0)+1;return m;},{});
    const summary = {
      total: leads.length, hot: hotLeads.length, warm: warmLeads.length, cold: leads.length-hotLeads.length-warmLeads.length,
      avgScore: Math.round(leads.reduce((s,l)=>s+(l.score||0),0)/leads.length),
      totalEstRevenue: leads.reduce((s,l)=>s+(l.est_revenue||0),0),
      listType, serviceDistribution: svcDist, flagCounts,
      topFlags: Object.entries(flagCounts).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([f,c])=>`${f}: ${c.toLocaleString()}`).join(", "),
      refiCandidates: flagCounts.refi_candidate||0,
      highEquity: flagCounts.high_equity||0,
      constructionReady: flagCounts.construction_ready||0,
      needsCreditHelp: flagCounts.needs_credit_help||0,
      flipReady: flagCounts.flip_ready||0,
      violationLikely: flagCounts.violation_likely||0,
    };
    const prompt = `You are a revenue strategist for Ziarem (mortgage, real estate, credit optimization, insurance, construction, accounting, marketing, processing).
Given this lead list analysis of ${leads.length.toLocaleString()} leads, provide STRICT JSON:
{"strategies":[{"title":"short title","division":"Ziarem division","description":"2-3 sentences","potential_revenue":"$X - $X","priority":"high|medium|low","action_steps":["step1","step2","step3"],"target_count":N}],"quick_wins":"2-3 sentences on immediate money-making actions","total_pipeline_value":"$X estimate","key_insight":"1 powerful insight"}

Include 8-12 strategies covering ALL Ziarem divisions. Focus on:
- Construction: ${summary.constructionReady.toLocaleString()} construction-ready properties, ${summary.violationLikely.toLocaleString()} likely violations — target for renovation, code compliance, fix & flip
- Mortgage: ${summary.refiCandidates.toLocaleString()} refi candidates — rate reduction, cash-out, ARM conversion
- Credit: ${summary.needsCreditHelp.toLocaleString()} need credit optimization (NEVER say "credit repair") — prep for better rates
- Insurance: every homeowner = P&C, title, home warranty opportunity
- Real Estate: list properties, buyer representation, investor deals
- Accounting: tax strategy for investors and high-income leads
${listType==="professional"?`- PROFESSIONAL PARTNERS: These are realtors/loan officers/agents — NOT consumers. Strategies should focus on:
  * Recruiting top producers to Ziarem's real estate brokerage
  * Becoming their preferred mortgage partner (referral agreements)
  * Offering insurance, credit optimization, construction as value-adds for THEIR clients
  * County-by-county targeting — dominate specific markets
  * Volume-based partnership tiers (higher volume = bigger referral fees)
  * Cross-sell: they bring clients, Ziarem handles mortgage + insurance + credit + title`:""}
Be specific with dollar amounts scaled to ${leads.length.toLocaleString()} leads. Think BIG.
NEVER say "credit repair". Only "credit optimization" or "credit strategy".`;
    try {
      const res = await claude(prompt, JSON.stringify(summary), 2000);
      const parsed = JSON.parse(res.replace(/```json|```/g,"").trim());
      setStrategies(parsed);
    } catch(e) { console.error("Strategy gen failed:",e); }
  };

  const buildNotes = (lead) => {
    const p = [];
    if(lead.strategy && lead.strategy!=="Needs review") p.push(lead.strategy);
    if(lead.current_rate) p.push(`Rate: ${lead.current_rate}`);
    if(lead.current_balance) p.push(`Balance: ${lead.current_balance}`);
    if(lead.monthly_savings) p.push(`Savings: ${lead.monthly_savings}/mo`);
    if(lead.available_equity) p.push(`Equity: ${lead.available_equity}`);
    if(lead.lender) p.push(`Lender: ${lead.lender}`);
    if(lead.mortgage_type) p.push(`Type: ${lead.mortgage_type}`);
    if(lead.property_value) p.push(`Value: ${lead.property_value}`);
    if(lead.current_ltv) p.push(`LTV: ${lead.current_ltv}`);
    if(lead.current_payment) p.push(`Pmt: ${lead.current_payment}`);
    if(lead.potential_payment) p.push(`NewPmt: ${lead.potential_payment}`);
    if(lead.rate_improvement) p.push(`RateImprv: ${lead.rate_improvement}`);
    if(lead.loan_start_date) p.push(`LoanStart: ${lead.loan_start_date}`);
    if(lead.address) p.push(lead.address);
    if(lead.city) p.push(lead.city);
    if(lead.state) p.push(lead.state);
    if(lead.zip) p.push(lead.zip);
    if(lead.county) p.push(`County: ${lead.county}`);
    if(lead.credit_score) p.push(`Credit: ${lead.credit_score}`);
    if(lead.income) p.push(`Income: ${lead.income}`);
    if(lead.net_worth) p.push(`NW: ${lead.net_worth}`);
    if(lead.age) p.push(`Age: ${lead.age}`);
    if(lead.year_built) p.push(`YrBuilt: ${lead.year_built}`);
    if(lead.foreclosure) p.push(`Forecl: ${lead.foreclosure}`);
    if(lead.absentee_owner) p.push(`Absentee: ${lead.absentee_owner}`);
    if(lead.moneymoves) p.push(`MM: ${lead.moneymoves}`);
    if(lead.office_name) p.push(`Office: ${lead.office_name}`);
    if(lead.office_address) p.push(`OffAddr: ${lead.office_address}`);
    if(lead.volume) p.push(`Vol: $${parseMoney(lead.volume).toLocaleString()}`);
    if(lead.unit_count) p.push(`Units: ${lead.unit_count}`);
    if(lead.license_number) p.push(`Lic: ${lead.license_number}`);
    if(lead.nmls) p.push(`NMLS: ${lead.nmls}`);
    if(lead.specialty) p.push(`Specialty: ${lead.specialty}`);
    if(lead.flags?.length) p.push(`Flags: ${lead.flags.join(", ")}`);
    return p.filter(Boolean).join(" | ");
  };

  const importAll = async () => {
    setImporting(true);
    cancelRef.current = false;
    let imported = 0, updated = 0, skipped = 0;
    // Build lookup maps for existing contacts
    const emailMap = {};
    const phoneMap = {};
    const nameMap = {};
    contacts.forEach(c=>{
      if(c.email) emailMap[c.email.toLowerCase()] = c;
      if(c.phone) phoneMap[c.phone.replace(/\D/g,"")] = c;
      if(c.full_name) nameMap[c.full_name.toLowerCase().trim()] = c;
    });

    const leadsToImport = filterStatus==="all"?analyzed:analyzed.filter(l=>l.status===filterStatus);
    const BATCH_SIZE = 500; // Bulk insert batch size
    let newBatch = [];
    const bizCache = {};
    businesses.forEach(b=>{ bizCache[b.name]=b.id; });

    const flushNewBatch = async () => {
      if(!newBatch.length) return;
      const res = await sb("contacts","POST",newBatch);
      if(res) {
        res.forEach(c=>{
          if(c.email) emailMap[c.email.toLowerCase()] = c;
          if(c.phone) phoneMap[c.phone.replace(/\D/g,"")] = c;
          if(c.full_name) nameMap[c.full_name.toLowerCase().trim()] = c;
        });
        imported += res.length;
      }
      newBatch = [];
    };

    // Collect updates to batch them too
    let updateBatch = [];
    const flushUpdates = async () => {
      // Supabase REST doesn't support batch PATCH, so fire concurrently (max 20 at a time)
      if(!updateBatch.length) return;
      const chunk = updateBatch.splice(0, 20);
      await Promise.all(chunk.map(u => sb("contacts","PATCH",u.patch,`?id=eq.${u.id}`)));
      updated += chunk.length;
    };

    for(let i=0; i<leadsToImport.length; i++) {
      if(cancelRef.current) break;
      if(i % 1000 === 0) setProgress(`Processing ${i.toLocaleString()} of ${leadsToImport.length.toLocaleString()}... (${imported.toLocaleString()} new, ${updated.toLocaleString()} enriched)`);

      const lead = leadsToImport[i];
      const newNotes = buildNotes(lead);

      // Duplicate check
      let existing = null;
      if(lead.email) existing = emailMap[lead.email.toLowerCase()];
      if(!existing && lead.phone) existing = phoneMap[lead.phone.replace(/\D/g,"")];
      if(!existing && lead.full_name) existing = nameMap[lead.full_name.toLowerCase().trim()];

      if(existing) {
        const patch = {};
        if(!existing.email && lead.email) patch.email = lead.email;
        if(!existing.phone && lead.phone) patch.phone = lead.phone;
        if(!existing.company && (lead.company||lead.office_name||lead.lender)) patch.company = lead.company||lead.office_name||lead.lender;
        if(!existing.title && lead.title) patch.title = lead.title;
        if(!existing.business_id && bizCache[lead.best_service]) patch.business_id = bizCache[lead.best_service];
        const existingNotes = existing.notes||"";
        const infoToAdd = newNotes.split(" | ").filter(part => part && !existingNotes.includes(part)).join(" | ");
        if(infoToAdd) patch.notes = existingNotes ? `${existingNotes} | ${infoToAdd}` : infoToAdd;
        if(existing.lead_status==="new" && lead.status==="hot") patch.lead_status = "qualified";
        else if(existing.lead_status==="new" && lead.status==="warm") patch.lead_status = "contacted";
        if(Object.keys(patch).length > 0) {
          updateBatch.push({id:existing.id, patch});
          // Update local map so subsequent leads see enriched data
          Object.assign(existing, patch);
          if(updateBatch.length >= 20) await flushUpdates();
        }
      } else {
        const contactData = {
          full_name: lead.full_name,
          email: lead.email||null,
          phone: lead.phone||null,
          company: lead.company||lead.office_name||lead.lender||null,
          title: lead.title||(lead.office_name?"Real Estate Agent":null),
          notes: newNotes,
          lead_status: lead.status==="hot"?"qualified":lead.status==="warm"?"contacted":"new",
          business_id: bizCache[lead.best_service]||null,
          source: lead.source||`${listType}_import`,
        };
        if (lead.dob || lead.date_of_birth) {
          const dob = new Date(lead.dob || lead.date_of_birth);
          if (!isNaN(dob)) {
            contactData.date_of_birth = dob.toISOString().slice(0,10);
            const today = new Date();
            let a = today.getFullYear() - dob.getFullYear();
            if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) a--;
            contactData.age = a;
            contactData.medicare_eligible = a >= 65;
          }
        }
        if (lead.age && !contactData.age) {
          contactData.age = parseInt(lead.age);
          if (contactData.age) contactData.medicare_eligible = contactData.age >= 65;
        }
        newBatch.push(contactData);
        // Track in local maps to prevent duplicates within same batch
        if(lead.email) emailMap[lead.email.toLowerCase()] = contactData;
        if(lead.phone) phoneMap[lead.phone.replace(/\D/g,"")] = contactData;
        if(lead.full_name) nameMap[lead.full_name.toLowerCase().trim()] = contactData;

        if(newBatch.length >= BATCH_SIZE) {
          setProgress(`Inserting batch... ${imported.toLocaleString()} imported so far`);
          await flushNewBatch();
        }
      }
    }
    // Flush remaining
    await flushNewBatch();
    await flushUpdates();
    // Remaining updates
    while(updateBatch.length) await flushUpdates();

    setImporting(false);
    setProgress("");
    showToast(`${imported.toLocaleString()} new leads imported, ${updated.toLocaleString()} enriched`);
    sendTelegram(`📋 <b>Bulk Import Complete</b>\n${imported.toLocaleString()} new + ${updated.toLocaleString()} enriched\nList type: ${listType}\n${analyzed.filter(l=>l.status==="hot").length.toLocaleString()} hot leads\nEst. pipeline: $${Math.round(analyzed.reduce((s,l)=>s+(l.est_revenue||0),0)).toLocaleString()}`);
    auditLog(null,"bulk_import","contact",null,{count:imported,updated,total:analyzed.length,list_type:listType});
  };

  const statusColors = {hot:"#ef4444",warm:"#f59e0b",cold:"#3b82f6"};
  const listTypeLabels = {mortgage:"MORTGAGE REFI",property:"PROPERTY RECORDS",demographic:"CONSUMER/DEMOGRAPHIC",professional:"PROFESSIONAL/PARTNER",general:"GENERAL"};
  const listTypeColors = {mortgage:"#10b981",property:"#8b5cf6",demographic:"#f59e0b",professional:"#ec4899",general:"#3b82f6"};
  const filteredLeads = filterStatus==="all"?analyzed:analyzed.filter(l=>l.status===filterStatus);
  const totalEstRevenue = analyzed.reduce((s,l)=>s+(l.est_revenue||0),0);

  return (
    <div>
      {step==="drop"&&(
        <div onDragOver={e=>{e.preventDefault();setDragOver(true);}} onDragLeave={()=>setDragOver(false)} onDrop={onDrop}
          onClick={()=>fileRef.current?.click()}
          style={{border:`2px dashed ${dragOver?"#d4af37":"#1e1e28"}`,borderRadius:8,padding:"60px 40px",textAlign:"center",cursor:"pointer",
            background:dragOver?"rgba(212,175,55,.04)":"#0a0a14",transition:"all .3s"}}>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{display:"none"}} onChange={e=>handleFile(e.target.files[0])} />
          <div style={{fontSize:48,marginBottom:16,opacity:.3}}>📋</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:8}}>DROP YOUR LEAD LIST</div>
          <div style={{fontSize:11,color:"#555",lineHeight:1.8,maxWidth:500,margin:"0 auto"}}>
            Drag & drop a CSV, TSV, or text file with your lead list.<br/>
            Auto-detects mortgage refi lists, property records, DNC-scrubbed lists, and any column layout.<br/>
            AI scores every lead, recommends services, and generates profit strategies.
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:16,flexWrap:"wrap"}}>
            {["Mortgage Refi Lists","Property Records","DNC-Scrubbed Lists","Consumer Data","Any CSV Format"].map(t=>(
              <span key={t} style={{fontSize:7,color:"#444",background:"#0d0d18",border:"1px solid #1a1a28",padding:"3px 8px",borderRadius:2,letterSpacing:".04em"}}>{t}</span>
            ))}
          </div>
          <div style={{fontSize:8,color:"#333",marginTop:12,letterSpacing:".06em"}}>200+ column types auto-recognized via built-in dictionary</div>
        </div>
      )}

      {step==="mapping"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".15em",color:"#d4af37"}}>COLUMN MAPPING</div>
                <span style={{fontSize:8,color:listTypeColors[listType],background:`${listTypeColors[listType]}15`,border:`1px solid ${listTypeColors[listType]}30`,padding:"2px 8px",borderRadius:3,fontWeight:600}}>{listTypeLabels[listType]} LIST DETECTED</span>
              </div>
              <div style={{fontSize:9,color:"#555"}}>{rawRows.length} rows — {Object.values(colMap).filter(v=>v!=="skip").length} of {headers.length} columns mapped</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <Btn onClick={()=>{setStep("drop");setRawRows([]);setHeaders([]);}} style={{fontSize:8}}>BACK</Btn>
              <Btn onClick={applyMapping} variant="gold" style={{fontSize:9}}>ANALYZE & SCORE →</Btn>
            </div>
          </div>

          <div style={{background:"#0a0a14",border:"1px solid #1e1e28",borderRadius:5,overflow:"auto",maxHeight:"65vh"}}>
            <div style={{display:"grid",gridTemplateColumns:`repeat(${headers.length},minmax(130px,1fr))`,gap:0,borderBottom:"1px solid #1e1e28",position:"sticky",top:0,background:"#0a0a14",zIndex:2}}>
              {headers.map((h,i)=>(
                <div key={i} style={{padding:"8px 10px",borderRight:"1px solid #0e0e18"}}>
                  <div style={{fontSize:8,color:"#888",marginBottom:4,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={h}>{h}</div>
                  <select value={colMap[i]||"skip"} onChange={e=>setColMap(p=>({...p,[i]:e.target.value}))}
                    style={{width:"100%",background:"#0d0d18",border:`1px solid ${colMap[i]&&colMap[i]!=="skip"?"rgba(212,175,55,.3)":"#1e1e28"}`,
                      color:colMap[i]&&colMap[i]!=="skip"?"#d4af37":"#555",fontFamily:"inherit",fontSize:8,padding:"4px 6px",borderRadius:2}}>
                    {FIELDS.map(f=><option key={f.key} value={f.key}>{f.group!=="skip"?`[${f.group.toUpperCase()}] `:""}{f.label}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{fontSize:8,color:"#444",padding:"4px 10px",borderBottom:"1px solid #0e0e18"}}>PREVIEW (first 5 rows)</div>
            {rawRows.slice(0,5).map((row,ri)=>(
              <div key={ri} style={{display:"grid",gridTemplateColumns:`repeat(${headers.length},minmax(130px,1fr))`,gap:0,borderBottom:"1px solid #0a0a14"}}>
                {row.map((cell,ci)=>(
                  <div key={ci} style={{padding:"4px 10px",fontSize:8,color:colMap[ci]&&colMap[ci]!=="skip"?"#c0bdb0":"#2a2a3a",borderRight:"1px solid #0a0a14",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={cell}>{cell||"—"}</div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {step==="analyzing"&&(
        <div style={{textAlign:"center",padding:"80px 40px"}}>
          <div style={{fontSize:48,marginBottom:16}} className="pulse">🧠</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:4}}>AI ANALYZING {listTypeLabels[listType]} LEADS</div>
          <div style={{fontSize:9,color:listTypeColors[listType],marginBottom:12}}>Scoring, strategizing, and finding profit opportunities...</div>
          <div style={{fontSize:11,color:"#555",marginBottom:16}}>{progress||"Processing..."}</div>
          <div style={{width:240,height:4,background:"#1a1a28",borderRadius:2,margin:"0 auto",overflow:"hidden"}}>
            <div className="pulse" style={{height:"100%",background:"#d4af37",borderRadius:2,width:"60%"}} />
          </div>
        </div>
      )}

      {step==="results"&&(
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center"}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".15em",color:"#d4af37"}}>ANALYSIS COMPLETE</div>
                <span style={{fontSize:8,color:listTypeColors[listType],background:`${listTypeColors[listType]}15`,border:`1px solid ${listTypeColors[listType]}30`,padding:"2px 8px",borderRadius:3}}>{listTypeLabels[listType]}</span>
              </div>
              <div style={{fontSize:9,color:"#555"}}>{analyzed.length.toLocaleString()} leads scored — est. pipeline: <span style={{color:"#10b981",fontWeight:600}}>${Math.round(totalEstRevenue).toLocaleString()}</span></div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
              <Btn onClick={()=>setShowStrategies(!showStrategies)} style={{fontSize:8,color:showStrategies?"#d4af37":"#888"}}>{showStrategies?"HIDE":"SHOW"} STRATEGIES</Btn>
              <Btn onClick={()=>{setStep("drop");setAnalyzed([]);setMapped([]);setStrategies(null);setRawRows([]);}} style={{fontSize:8}}>NEW IMPORT</Btn>
              {importing&&<Btn onClick={()=>{cancelRef.current=true;}} style={{fontSize:8,color:"#ef4444",borderColor:"#ef4444"}}>CANCEL</Btn>}
              <Btn onClick={importAll} variant="gold" disabled={importing} style={{fontSize:9}}>
                {importing?<span className="pulse">{progress||"Importing..."}</span>:`⬇ IMPORT ${filterStatus==="all"?"ALL "+analyzed.length.toLocaleString():filteredLeads.length.toLocaleString()+" "+filterStatus.toUpperCase()} LEADS`}
              </Btn>
            </div>
          </div>

          {/* Stats row */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:6,marginBottom:14}}>
            {[
              {l:"Total Leads",v:analyzed.length,c:"#d4af37"},
              {l:"Hot",v:analyzed.filter(l=>l.status==="hot").length,c:"#ef4444"},
              {l:"Warm",v:analyzed.filter(l=>l.status==="warm").length,c:"#f59e0b"},
              {l:"Cold",v:analyzed.filter(l=>l.status==="cold").length,c:"#3b82f6"},
              {l:"Avg Score",v:analyzed.length?Math.round(analyzed.reduce((s,l)=>s+(l.score||0),0)/analyzed.length):0,c:"#8b5cf6"},
              {l:"Est. Revenue",v:"$"+Math.round(totalEstRevenue).toLocaleString(),c:"#10b981"},
            ].map((s,i)=>(
              <div key={i} onClick={()=>setFilterStatus(s.l==="Hot"?"hot":s.l==="Warm"?"warm":s.l==="Cold"?"cold":"all")}
                style={{background:"#0d0d18",border:`1px solid ${filterStatus===(s.l==="Hot"?"hot":s.l==="Warm"?"warm":s.l==="Cold"?"cold":"___")?s.c:s.c+"22"}`,borderRadius:4,padding:"8px 10px",textAlign:"center",cursor:["Hot","Warm","Cold"].includes(s.l)?"pointer":"default"}}>
                <div style={{fontSize:16,color:s.c,fontWeight:700}}>{s.v}</div>
                <div style={{fontSize:7,color:"#444",letterSpacing:".06em"}}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* Profit Strategies Panel */}
          {showStrategies&&strategies&&(
            <div style={{background:"linear-gradient(135deg,#0d1a0d,#0a0a14)",border:"1px solid rgba(16,185,129,.2)",borderRadius:6,padding:"16px 18px",marginBottom:14}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:".15em",color:"#10b981",marginBottom:4}}>PROFIT STRATEGIES</div>
              {strategies.key_insight&&<div style={{fontSize:10,color:"#d4af37",marginBottom:8,fontStyle:"italic"}}>"{strategies.key_insight}"</div>}
              {strategies.total_pipeline_value&&<div style={{fontSize:9,color:"#10b981",marginBottom:10}}>Total Pipeline Value: <b>{strategies.total_pipeline_value}</b></div>}
              {strategies.quick_wins&&<div style={{fontSize:9,color:"#888",marginBottom:12,padding:"8px 12px",background:"rgba(212,175,55,.04)",border:"1px solid rgba(212,175,55,.1)",borderRadius:4}}>QUICK WINS: {strategies.quick_wins}</div>}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:8}}>
                {(strategies.strategies||[]).map((s,i)=>(
                  <div key={i} style={{background:"#0a0a14",border:`1px solid ${s.priority==="high"?"rgba(239,68,68,.2)":s.priority==="medium"?"rgba(245,158,11,.2)":"rgba(59,130,246,.15)"}`,borderRadius:4,padding:"10px 14px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                      <span style={{fontSize:10,color:"#e0dcd0",fontWeight:600}}>{s.title}</span>
                      <span style={{fontSize:7,color:s.priority==="high"?"#ef4444":s.priority==="medium"?"#f59e0b":"#3b82f6",background:s.priority==="high"?"rgba(239,68,68,.1)":s.priority==="medium"?"rgba(245,158,11,.1)":"rgba(59,130,246,.08)",padding:"1px 6px",borderRadius:2}}>{s.priority}</span>
                    </div>
                    <div style={{fontSize:8,color:"#666",marginBottom:4}}>{s.division} — {s.target_count} leads</div>
                    <div style={{fontSize:9,color:"#888",marginBottom:6}}>{s.description}</div>
                    <div style={{fontSize:10,color:"#10b981",fontWeight:600,marginBottom:4}}>{s.potential_revenue}</div>
                    {s.action_steps&&<div style={{fontSize:8,color:"#555"}}>{s.action_steps.map((a,j)=><div key={j} style={{marginBottom:1}}>• {a}</div>)}</div>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Service breakdown + flag breakdown */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
            <div style={{background:"#0a0a14",border:"1px solid #1e1e28",borderRadius:5,padding:"10px 14px"}}>
              <div style={{fontSize:8,color:"#444",letterSpacing:".06em",marginBottom:6}}>SERVICE DISTRIBUTION</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {Object.entries(analyzed.reduce((m,l)=>{m[l.best_service||"Unknown"]=(m[l.best_service||"Unknown"]||0)+1;return m;},{})).sort((a,b)=>b[1]-a[1]).map(([svc,count])=>(
                  <span key={svc} style={{fontSize:8,color:"#d4af37",background:"rgba(212,175,55,.06)",border:"1px solid rgba(212,175,55,.15)",padding:"2px 6px",borderRadius:3}}>{svc}: {count}</span>
                ))}
              </div>
            </div>
            <div style={{background:"#0a0a14",border:"1px solid #1e1e28",borderRadius:5,padding:"10px 14px"}}>
              <div style={{fontSize:8,color:"#444",letterSpacing:".06em",marginBottom:6}}>OPPORTUNITY FLAGS</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {Object.entries(analyzed.reduce((m,l)=>{(l.flags||[]).forEach(f=>{m[f]=(m[f]||0)+1;});return m;},{})).sort((a,b)=>b[1]-a[1]).map(([flag,count])=>{
                  const flagColors={refi_candidate:"#10b981",high_equity:"#8b5cf6",flip_ready:"#f59e0b",violation_likely:"#ef4444",absentee:"#06b6d4",needs_credit_help:"#f97316",investor:"#3b82f6",construction_ready:"#a855f7",first_time_buyer:"#ec4899"};
                  return <span key={flag} style={{fontSize:7,color:flagColors[flag]||"#666",background:`${flagColors[flag]||"#666"}12`,border:`1px solid ${flagColors[flag]||"#666"}30`,padding:"2px 6px",borderRadius:2}}>{flag.replace(/_/g," ")}: {count}</span>;
                })}
              </div>
            </div>
          </div>

          {/* Filter tabs */}
          <div style={{display:"flex",gap:4,marginBottom:8}}>
            {["all","hot","warm","cold"].map(f=>(
              <span key={f} onClick={()=>setFilterStatus(f)} style={{fontSize:8,padding:"3px 10px",borderRadius:3,cursor:"pointer",fontWeight:600,letterSpacing:".05em",
                color:filterStatus===f?(f==="all"?"#d4af37":statusColors[f]):"#444",
                background:filterStatus===f?`${f==="all"?"#d4af37":statusColors[f]}15`:"transparent",
                border:`1px solid ${filterStatus===f?(f==="all"?"#d4af37":statusColors[f])+"40":"transparent"}`
              }}>{f.toUpperCase()} ({f==="all"?analyzed.length:analyzed.filter(l=>l.status===f).length})</span>
            ))}
          </div>

          {/* Lead list */}
          <div style={{display:"flex",flexDirection:"column",gap:3,maxHeight:"50vh",overflow:"auto"}}>
            {filteredLeads.map((lead,i)=>{
              const sc = statusColors[lead.status]||"#555";
              return (
                <div key={i} style={{background:"#0d0d18",border:`1px solid ${sc}18`,borderRadius:4,padding:"8px 12px",display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontSize:16,fontWeight:700,color:sc,minWidth:28,textAlign:"center"}}>{lead.score}</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap",marginBottom:2}}>
                      <span style={{fontSize:10,color:"#e0dcd0",fontWeight:500}}>{lead.full_name}</span>
                      {lead.office_name&&<span style={{fontSize:7,color:"#ec4899"}}>@ {lead.office_name}</span>}
                      {lead.lender&&!lead.office_name&&<span style={{fontSize:7,color:"#06b6d4"}}>@ {lead.lender}</span>}
                      {lead.company&&!lead.lender&&!lead.office_name&&<span style={{fontSize:7,color:"#555"}}>@ {lead.company}</span>}
                      <Bd label={lead.status} color={sc}/>
                    </div>
                    <div style={{fontSize:8,color:"#666",marginBottom:1}}>{lead.reason}</div>
                    {lead.strategy&&lead.strategy!=="Needs review"&&<div style={{fontSize:8,color:"#10b981",fontStyle:"italic"}}>Strategy: {lead.strategy}</div>}
                    {/* Professional details row */}
                    {(lead.volume||lead.unit_count)&&(
                      <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                        {lead.volume&&<span style={{fontSize:7,color:"#ec4899",fontWeight:600}}>Vol: ${parseMoney(lead.volume)>=1000000?((parseMoney(lead.volume)/1000000).toFixed(1)+"M"):parseMoney(lead.volume).toLocaleString()}</span>}
                        {lead.unit_count&&<span style={{fontSize:7,color:"#a855f7"}}>{lead.unit_count} units</span>}
                        {lead.office_address&&<span style={{fontSize:7,color:"#555"}}>{lead.office_address}</span>}
                      </div>
                    )}
                    {/* Mortgage details row */}
                    {(lead.current_rate||lead.monthly_savings||lead.available_equity)&&(
                      <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                        {lead.current_rate&&<span style={{fontSize:7,color:"#f59e0b"}}>Rate: {lead.current_rate}</span>}
                        {lead.current_balance&&<span style={{fontSize:7,color:"#8b5cf6"}}>Bal: {lead.current_balance}</span>}
                        {lead.monthly_savings&&<span style={{fontSize:7,color:"#10b981",fontWeight:600}}>Saves: {lead.monthly_savings}/mo</span>}
                        {lead.available_equity&&<span style={{fontSize:7,color:"#d4af37"}}>Equity: {lead.available_equity}</span>}
                        {lead.current_ltv&&<span style={{fontSize:7,color:"#06b6d4"}}>LTV: {lead.current_ltv}</span>}
                        {lead.property_value&&<span style={{fontSize:7,color:"#a855f7"}}>Value: {lead.property_value}</span>}
                      </div>
                    )}
                    {/* Demographic details */}
                    {(lead.credit_score||lead.income)&&!lead.current_rate&&(
                      <div style={{display:"flex",gap:8,marginTop:3,flexWrap:"wrap"}}>
                        {lead.credit_score&&<span style={{fontSize:7,color:"#f59e0b"}}>Credit: {lead.credit_score}</span>}
                        {lead.income&&<span style={{fontSize:7,color:"#10b981"}}>Income: {lead.income}</span>}
                        {lead.net_worth&&<span style={{fontSize:7,color:"#8b5cf6"}}>Worth: {lead.net_worth}</span>}
                        {lead.age&&<span style={{fontSize:7,color:"#06b6d4"}}>Age: {lead.age}</span>}
                      </div>
                    )}
                    {/* Flags */}
                    {lead.flags?.length>0&&<div style={{display:"flex",gap:3,marginTop:3,flexWrap:"wrap"}}>{lead.flags.map((f,j)=><span key={j} style={{fontSize:6,color:"#666",background:"#0f0f1a",border:"1px solid #1a1a28",padding:"1px 4px",borderRadius:2}}>{f.replace(/_/g," ")}</span>)}</div>}
                    {lead.tags?.length>0&&<div style={{display:"flex",gap:3,marginTop:2,flexWrap:"wrap"}}>{lead.tags.map((t,j)=><span key={j} style={{fontSize:6,color:"#555",background:"#0a0a14",padding:"1px 4px",borderRadius:2}}>{t}</span>)}</div>}
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{fontSize:9,color:"#d4af37",fontWeight:500}}>{lead.best_service}</div>
                    {lead.second_service&&lead.second_service!=="null"&&<div style={{fontSize:7,color:"#888"}}>+ {lead.second_service}</div>}
                    {lead.third_service&&lead.third_service!=="null"&&<div style={{fontSize:7,color:"#555"}}>+ {lead.third_service}</div>}
                    {lead.est_revenue>0&&<div style={{fontSize:8,color:"#10b981",fontWeight:600,marginTop:2}}>${Math.round(lead.est_revenue).toLocaleString()}</div>}
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:2,flexShrink:0}}>
                    {lead.email&&<span style={{fontSize:7,color:"#3b82f6"}}>✉ {lead.email}</span>}
                    {lead.phone&&<span style={{fontSize:7,color:"#10b981"}}>📞 {lead.phone}</span>}
                    {lead.address&&<span style={{fontSize:7,color:"#555",maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={`${lead.address}, ${lead.city||""} ${lead.state||""} ${lead.zip||""}`}>{lead.city||lead.address}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── LEADS VIEW ───────────────────────────────────────────────────
function LeadsView({
  contacts, deals, activities, businesses, showToast, onNewContact, onNav,
  onOpenPDFImport, onOpenNurtureSeq,
  runCrossSell, crossSellContact, crossSellResults, crossSellLoading,
  bulkScanResults, bulkScanLoading, bulkScanProgress, runBulkCrossScan
}) {
  const [aiLoading, setAiLoading] = useState(false);
  const [prospects, setProspects] = useState([]);
  const [idealCustomer, setIdealCustomer] = useState("");
  const [scriptContact, setScriptContact] = useState(null);
  const [script, setScript] = useState("");
  const [scriptLoading, setScriptLoading] = useState(false);
  const [tab, setTab] = useState("hot");

  const scored = useMemo(()=>
    contacts.map(c=>({...c, score:scoreContact(c,deals,activities)}))
    .sort((a,b)=>b.score-a.score),
  [contacts,deals,activities]);

  const hotLeads = scored.filter(c=>c.score>=50&&(c.lead_status!=="won"&&c.lead_status!=="lost")).slice(0,20);
  const coldLeads = scored.filter(c=>c.score<30&&c.lead_status!=="won").slice(0,20);
  const nurture = scored.filter(c=>c.lead_status==="nurture"||c.lead_status==="contacted").slice(0,20);

  const medicareLeads = scored.filter(c=> {
    if (c.medicare_eligible) return true;
    if (c.age && c.age >= 65) return true;
    if (c.date_of_birth) {
      const today = new Date(); const dob = new Date(c.date_of_birth);
      let a = today.getFullYear() - dob.getFullYear();
      if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) a--;
      return a >= 65;
    }
    return false;
  }).slice(0,50);
  const hhaLeads = scored.filter(c=>c.business_id==="3e5fbf2f-2e3a-4b4b-bc61-35d13b9a1db6").slice(0,50);

  const findProspects = async () => {
    if (!idealCustomer.trim()) return;
    setAiLoading(true);
    const raw = await claude(
      `You are a lead generation expert for a mortgage broker group. Generate 8 high-quality prospect profiles. Respond STRICT JSON only — an array of objects with: {"company":"","title":"","why":"one sentence reason they need mortgage services","outreach":"brief personalized outreach opener (1-2 sentences)","segment":"first-time buyer|investor|refinance|self-employed|commercial","priority":1-3}`,
      `Ideal customer description: ${idealCustomer}\nContext: mortgage broker services — purchases, refinances, DSCR/investor loans, commercial`,
      800
    );
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setProspects(Array.isArray(parsed)?parsed:parsed.prospects||[]);
    } catch { showToast("⚠ Parse error — try again"); }
    setAiLoading(false);
  };

  const getOutreachScript = async contact => {
    setScriptContact(contact);
    setScript("");
    setScriptLoading(true);
    const cDeals = deals.filter(d=>d.contact_id===contact.id);
    const cActs = activities.filter(a=>a.contact_id===contact.id);
    const txt = await claude(
      "You are an expert mortgage broker sales coach. Write a short, personalized phone/email outreach script for the given contact. Include: a warm opener referencing their situation, a value proposition, and a soft ask. Keep it under 150 words. Return script text only.",
      `Contact: ${contact.full_name} | Company: ${contact.company||"—"} | Status: ${contact.lead_status||"new"} | Deals: ${cDeals.length} | Last activity: ${cActs.length?ago(cActs[0].created_at):"never"}\nScore: ${contact.score}/100`,
      400
    );
    setScript(txt);
    setScriptLoading(false);
  };

  const tabContacts = tab==="hot"?hotLeads:tab==="cold"?coldLeads:tab==="medicare"?medicareLeads:tab==="hha"?hhaLeads:nurture;

  return (
    <div style={{ flex:1,overflow:"auto",padding:"18px 20px",display:"flex",flexDirection:"column",gap:14 }}>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8 }}>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37" }}>LEAD ENGINE</div>
          <div style={{ fontSize:9,color:"#444",letterSpacing:".08em" }}>{hotLeads.length} HOT · {nurture.length} NURTURE · {coldLeads.length} COLD · {medicareLeads.length} MEDICARE · {hhaLeads.length} HHA</div>
        </div>
        <div style={{ display:"flex",gap:6,flexWrap:"wrap" }}>
          <Btn onClick={onOpenPDFImport} variant="blue" style={{ fontSize:9 }}>📄 IMPORT PDF LEADS</Btn>
          <Btn onClick={()=>setTab("import")} style={{ fontSize:9, background:"rgba(245,158,11,.08)", border:"1px solid rgba(245,158,11,.25)", color:"#f59e0b" }}>📋 DROP LIST</Btn>
          <Btn onClick={onOpenNurtureSeq} variant="green" style={{ fontSize:9 }}>🌱 NURTURE SEQUENCE</Btn>
          <Btn onClick={runBulkCrossScan} variant="purple" disabled={bulkScanLoading||!businesses.length} style={{ fontSize:9 }}>
            {bulkScanLoading?<span className="pulse">🔁 scanning…</span>:"🔁 CROSS-SELL SCAN"}
          </Btn>
          <Btn onClick={onNewContact} variant="gold" style={{ fontSize:9 }}>+ CONTACT</Btn>
        </div>
      </div>
      {bulkScanProgress&&<div className="pulse" style={{fontSize:9,color:"#a78bfa",background:"rgba(139,92,246,.06)",padding:"4px 12px",borderRadius:3,border:"1px solid rgba(139,92,246,.2)"}}>{bulkScanProgress}</div>}

      {/* Tab bar */}
      <div style={{ display:"flex",gap:4,borderBottom:"1px solid #131320",paddingBottom:1 }}>
        {[
          {id:"hot",l:"🔥 HOT LEADS",c:hotLeads.length,color:"#ef4444"},
          {id:"nurture",l:"🌱 NURTURE",c:nurture.length,color:"#10b981"},
          {id:"cold",l:"❄ COLD",c:coldLeads.length,color:"#3b82f6"},
          {id:"medicare",l:"🏥 MEDICARE ELIGIBLE",c:medicareLeads.length,color:"#10b981"},
          {id:"hha",l:"🏥 HHA LEADS",c:hhaLeads.length,color:"#06b6d4"},
          {id:"crosssell",l:"🔁 CROSS-SELL",c:bulkScanResults.reduce((s,r)=>s+r.opps.length,0),color:"#d4af37"},
          {id:"prospects",l:"🎯 PROSPECT FINDER",c:0,color:"#8b5cf6"},
          {id:"import",l:"📋 SMART IMPORT",c:0,color:"#f59e0b"},
        ].map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{ background:tab===t.id?`${t.color}12`:"none",border:`1px solid ${tab===t.id?`${t.color}44`:"transparent"}`,borderBottom:tab===t.id?`2px solid ${t.color}`:"2px solid transparent",color:tab===t.id?t.color:"#444",fontFamily:"inherit",fontSize:9,padding:"5px 12px",cursor:"pointer",letterSpacing:".06em",marginBottom:-1 }}>
            {t.l}{t.c>0&&<span style={{marginLeft:5,background:`${t.color}25`,borderRadius:8,padding:"0 5px",fontSize:8,color:t.color}}>{t.c}</span>}
          </button>
        ))}
      </div>

      {/* ── HOT / NURTURE / COLD contact list ── */}
      {(tab==="hot"||tab==="nurture"||tab==="cold"||tab==="medicare"||tab==="hha")&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
          {/* Contact list */}
          <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden" }}>
            <div style={{ overflowY:"auto",maxHeight:520 }}>
              {tabContacts.length===0&&<div style={{padding:30,textAlign:"center",color:"#333",fontSize:10}}>No leads in this segment</div>}
              {tabContacts.map(c=>{
                const statusCfg=LEAD_STATUS_CFG[c.lead_status]||{c:"#555",l:c.lead_status||"new"};
                const hasCross = (crossSellResults[c.id]||[]).length > 0;
                return (
                  <div key={c.id} style={{ padding:"10px 14px",borderBottom:"1px solid #0e0e18",display:"flex",gap:10,alignItems:"center" }}>
                    <Av name={c.full_name} color={statusCfg.c} size={28}/>
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ fontSize:10,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.full_name}</div>
                      <div style={{ fontSize:8,color:"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{c.company||c.email||"—"}</div>
                    </div>
                    <ScorePill score={c.score}/>
                    {c.age&&<span style={{fontSize:8,padding:"1px 6px",borderRadius:8,background:c.age>=65?"rgba(16,185,129,.15)":"rgba(59,130,246,.08)",border:`1px solid ${c.age>=65?"rgba(16,185,129,.4)":"rgba(59,130,246,.2)"}`,color:c.age>=65?"#10b981":"#60a5fa"}}>{c.age}yo{c.age>=65?" ✓":""}</span>}
                    {hasCross&&<Bd label={`🔁 ${crossSellResults[c.id].length}`} color="#d4af37"/>}
                    <Bd label={statusCfg.l} color={statusCfg.c}/>
                    <div style={{display:"flex",gap:3}}>
                      <button onClick={()=>getOutreachScript(c)} title="AI Script" style={{ background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",cursor:"pointer",borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"inherit" }}>✍</button>
                      <button onClick={()=>runCrossSell(c)} title="Cross-sell" style={{ background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.25)",color:"#d4af37",cursor:"pointer",borderRadius:3,padding:"3px 7px",fontSize:9,fontFamily:"inherit" }}>🔁</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Right panel: script or cross-sell for selected contact */}
          <div style={{ display:"flex",flexDirection:"column",gap:10 }}>
            {scriptContact&&(
              <div style={{ background:"rgba(139,92,246,.04)",border:"1px solid rgba(139,92,246,.25)",borderRadius:6,padding:"14px 16px" }} className="fi">
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                  <span style={{ fontSize:9,color:"#8b5cf6",letterSpacing:".1em" }}>✍ OUTREACH SCRIPT — {scriptContact.full_name.toUpperCase()}</span>
                  <button onClick={()=>setScriptContact(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:11}}>✕</button>
                </div>
                {scriptLoading?<div className="pulse" style={{fontSize:10,color:"#8b5cf6"}}>🧠 generating…</div>
                  :<pre style={{fontSize:11,color:"#c4c0d8",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0}}>{script}</pre>}
              </div>
            )}
            {crossSellContact&&(
              <div style={{ background:"rgba(212,175,55,.04)",border:"1px solid rgba(212,175,55,.2)",borderRadius:6,padding:"14px 16px" }} className="fi">
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8 }}>
                  <span style={{ fontSize:9,color:"#d4af37",letterSpacing:".1em" }}>🔁 CROSS-SELL — {crossSellContact.full_name.toUpperCase()}</span>
                  <button onClick={()=>setCrossSellContact&&setCrossSellContact(null)} style={{background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:11}}>✕</button>
                </div>
                {crossSellLoading?<div className="pulse" style={{fontSize:10,color:"#d4af37"}}>🧠 analyzing opportunities…</div>
                  :(crossSellResults[crossSellContact.id]||[]).length===0
                    ?<div style={{fontSize:10,color:"#444"}}>No cross-sell opportunities found for this contact.</div>
                    :(crossSellResults[crossSellContact.id]||[]).map((opp,i)=>{
                      const pc={high:"#ef4444",medium:"#f59e0b",low:"#555"}[opp.priority]||"#555";
                      return (
                        <div key={i} style={{background:"#0b0b14",border:`1px solid ${pc}28`,borderRadius:4,padding:"9px 12px",marginBottom:6}}>
                          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4,flexWrap:"wrap"}}>
                            <span style={{fontSize:10,color:"#e0dcd0",fontWeight:"500"}}>→ {opp.to_business}</span>
                            <Bd label={opp.service} color={pc}/>
                            <Bd label={opp.priority} color={pc}/>
                          </div>
                          <div style={{fontSize:9,color:"#666",lineHeight:1.6,marginBottom:4}}>{opp.reason}</div>
                          <div style={{fontSize:9,color:"#d4af37",borderLeft:"2px solid rgba(212,175,55,.3)",paddingLeft:8}}>▶ {opp.action}</div>
                        </div>
                      );
                    })}
              </div>
            )}
            {!scriptContact&&!crossSellContact&&(
              <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"24px 16px",textAlign:"center",color:"#2a2a3a",fontSize:10}}>
                <div style={{fontSize:24,marginBottom:8,opacity:.4}}>⬡</div>
                Click ✍ for an AI outreach script or 🔁 to find cross-sell opportunities for any contact
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── CROSS-SELL SCAN RESULTS ── */}
      {tab==="crosssell"&&(
        <div>
          {bulkScanResults.length===0&&!bulkScanLoading&&(
            <div style={{textAlign:"center",padding:"50px 20px",color:"#2a2a3a"}}>
              <div style={{fontSize:32,marginBottom:12}}>🔁</div>
              <div style={{fontSize:12,color:"#444",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".15em",marginBottom:8}}>CROSS-SELL INTELLIGENCE</div>
              <div style={{fontSize:10,color:"#333",lineHeight:1.7,marginBottom:20,maxWidth:400,margin:"0 auto 20px"}}>Scan all contacts and AI will identify which group companies each person is a candidate for — so no opportunity falls through the cracks.</div>
              <Btn onClick={runBulkCrossScan} variant="gold" disabled={!businesses.length} style={{padding:"10px 24px",fontSize:10,letterSpacing:".1em"}}>🔁 RUN CROSS-SELL SCAN</Btn>
              {!businesses.length&&<div style={{fontSize:9,color:"#444",marginTop:8}}>Add businesses first in the BIZ tab</div>}
            </div>
          )}
          {bulkScanResults.length>0&&(
            <div>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                <div style={{fontSize:9,color:"#888"}}>
                  <span style={{color:"#d4af37",fontWeight:600}}>{bulkScanResults.reduce((s,r)=>s+r.opps.length,0)} opportunities</span> across <span style={{color:"#d4af37",fontWeight:600}}>{bulkScanResults.length} contacts</span>
                </div>
                <Btn onClick={runBulkCrossScan} disabled={bulkScanLoading} style={{fontSize:8,padding:"3px 10px"}}>🔄 RE-SCAN</Btn>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {bulkScanResults.map(({contact:c, opps})=>(
                  <div key={c.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden"}} className="fi">
                    {/* Contact header */}
                    <div style={{padding:"10px 14px",borderBottom:"1px solid #131320",display:"flex",gap:10,alignItems:"center",background:"rgba(212,175,55,.03)"}}>
                      <Av name={c.full_name} color="#d4af37" size={28}/>
                      <div style={{flex:1}}>
                        <div style={{fontSize:10,color:"#e0dcd0"}}>{c.full_name}</div>
                        <div style={{fontSize:8,color:"#555"}}>{c.company||c.email||"—"}</div>
                      </div>
                      <ScorePill score={c.score}/>
                      <Bd label={`${opps.length} opps`} color="#d4af37"/>
                    </div>
                    {/* Opportunity cards */}
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:1,padding:1}}>
                      {opps.map((opp,i)=>{
                        const pc={high:"#ef4444",medium:"#f59e0b",low:"#10b981"}[opp.priority]||"#555";
                        return (
                          <div key={i} style={{background:"#0b0b14",padding:"10px 12px",borderRadius:2}}>
                            <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:5,flexWrap:"wrap"}}>
                              <span style={{fontSize:9,color:pc,fontWeight:600}}>→ {opp.to_business}</span>
                              <Bd label={opp.service} color={pc}/>
                              <Bd label={opp.priority} color={pc}/>
                            </div>
                            <div style={{fontSize:9,color:"#666",lineHeight:1.55,marginBottom:5}}>{opp.reason}</div>
                            <div style={{fontSize:9,color:"#d4af37",borderLeft:"2px solid rgba(212,175,55,.25)",paddingLeft:7,lineHeight:1.5}}>▶ {opp.action}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── PROSPECT FINDER ── */}
      {tab==="prospects"&&(
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:14 }}>
          <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"16px" }}>
            <div style={{ fontSize:9,color:"#8b5cf6",letterSpacing:".12em",marginBottom:10 }}>🎯 AI PROSPECT FINDER</div>
            <div style={{ fontSize:10,color:"#555",marginBottom:10,lineHeight:1.65 }}>Describe your ideal customer — Claude will generate qualified prospect profiles with personalized openers for each group company.</div>
            <textarea value={idealCustomer} onChange={e=>setIdealCustomer(e.target.value)} rows={4}
              placeholder="e.g. Real estate investors looking to finance 2-4 unit properties in Southwest Florida, self-employed, credit 680+"
              style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3,resize:"vertical",lineHeight:1.65,marginBottom:8 }} />
            <Btn onClick={findProspects} variant="purple" disabled={aiLoading||!idealCustomer.trim()} style={{ width:"100%",padding:"9px" }}>
              {aiLoading?<span className="pulse">🧠 finding prospects…</span>:"🎯 FIND PROSPECTS"}
            </Btn>
          </div>
          <div style={{ overflowY:"auto",display:"flex",flexDirection:"column",gap:6,maxHeight:520 }}>
            {prospects.length===0&&<div style={{padding:30,textAlign:"center",color:"#2a2a3a",fontSize:10}}>Prospects will appear here</div>}
            {prospects.map((p,i)=>{
              const pc=["#ef4444","#f59e0b","#10b981"][p.priority-1]||"#555";
              return (
                <div key={i} style={{ background:"#0d0d18",border:`1px solid ${pc}22`,borderRadius:4,padding:"12px 14px" }}>
                  <div style={{ display:"flex",gap:6,marginBottom:4,alignItems:"center",flexWrap:"wrap" }}>
                    <span style={{ fontSize:10,color:"#e0dcd0",fontWeight:"500" }}>{p.title}</span>
                    {p.company&&<span style={{ fontSize:9,color:"#555" }}>@ {p.company}</span>}
                    <Bd label={p.segment} color={pc}/>
                    <Bd label={["","High","Med","Low"][p.priority]||"Med"} color={pc}/>
                  </div>
                  <div style={{ fontSize:9,color:"#666",marginBottom:5,lineHeight:1.6 }}>💡 {p.why}</div>
                  <div style={{ fontSize:9,color:"#8b5cf6",fontStyle:"italic",lineHeight:1.6,borderLeft:"2px solid rgba(139,92,246,.3)",paddingLeft:8 }}>"{p.outreach}"</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── SMART LIST IMPORT ── */}
      {tab==="import"&&<SmartLeadImporter contacts={contacts} businesses={businesses} showToast={showToast} />}
    </div>
  );
}


// ─── ANALYTICS VIEW ───────────────────────────────────────────────
function AnalyticsView({ contacts, deals, activities, campaigns, intelligence, showToast }) {
  const [report, setReport] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  // Revenue by month (won deals)
  const wonDeals = deals.filter(d=>d.status==="won"&&d.closed_at);
  const revenueByMonth = useMemo(()=>{
    const map = {};
    wonDeals.forEach(d=>{ const m=d.closed_at?.slice(0,7); if(m) map[m]=(map[m]||0)+Number(d.value||0); });
    return Object.entries(map).sort().slice(-12).map(([m,v])=>({ label:new Date(m+"-01").toLocaleDateString("en-US",{month:"short",year:"2-digit"}), value:v }));
  }, [wonDeals]);

  // Pipeline funnel
  const funnelData = Object.entries(STAGE_CFG).map(([k,v])=>({
    name:v.l, value:deals.filter(d=>d.stage===k).length, fill:v.c
  })).filter(d=>d.value>0);

  // Contact acquisition by month
  const contactsByMonth = useMemo(()=>{
    const map = {};
    contacts.forEach(c=>{ const m=c.created_at?.slice(0,7); if(m) map[m]=(map[m]||0)+1; });
    return Object.entries(map).sort().slice(-12).map(([m,v])=>({ label:new Date(m+"-01").toLocaleDateString("en-US",{month:"short",year:"2-digit"}), count:v }));
  }, [contacts]);

  // Activity breakdown
  const actByType = useMemo(()=>{
    const map = {};
    activities.forEach(a=>{ map[a.type]=(map[a.type]||0)+1; });
    return Object.entries(map).map(([type,count])=>({type,count})).sort((a,b)=>b.count-a.count);
  }, [activities]);

  const open = deals.filter(d=>d.status==="open");
  const won = deals.filter(d=>d.status==="won");
  const lost = deals.filter(d=>d.status==="lost");
  const convRate = deals.length?Math.round((won.length/deals.length)*100):0;
  const avgDeal = won.length?Math.round(won.reduce((s,d)=>s+Number(d.value||0),0)/won.length):0;
  const pipeline = open.reduce((s,d)=>s+Number(d.value||0),0);
  const totalWon = won.reduce((s,d)=>s+Number(d.value||0),0);

  const getGrowthReport = async () => {
    setReportLoading(true);
    const txt = await claude(
      "You are a strategic business advisor for a mortgage broker group with multiple companies. Write a concise growth report (4-5 paragraphs). Cover: performance summary, top growth opportunities, marketing recommendations, lead generation strategies, and one bold action to take this week. Be specific and data-driven.",
      `Pipeline: $${pipeline.toLocaleString()} open, $${totalWon.toLocaleString()} won\nConversion rate: ${convRate}%\nAvg deal size: $${avgDeal.toLocaleString()}\nContacts: ${contacts.length} (${contacts.filter(c=>c.lead_status==="qualified").length} qualified)\nActivities logged: ${activities.length}\nCampaigns sent: ${campaigns.filter(c=>c.status==="sent").length}\nIntel records: ${intelligence.length}`,
      900
    );
    setReport(txt);
    setReportLoading(false);
  };

  return (
    <div style={{ flex:1,overflow:"auto",padding:"18px 20px",display:"flex",flexDirection:"column",gap:14 }}>
      <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4 }}>
        <div>
          <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37" }}>ANALYTICS & GROWTH</div>
          <div style={{ fontSize:9,color:"#444",letterSpacing:".08em" }}>PERFORMANCE · PIPELINE · TRENDS</div>
        </div>
        <Btn onClick={getGrowthReport} variant="purple" disabled={reportLoading} style={{ fontSize:9 }}>
          {reportLoading?<span className="pulse">🧠 analyzing...</span>:"🧠 AI GROWTH REPORT"}
        </Btn>
      </div>

      {report&&(
        <div style={{ background:"rgba(139,92,246,.04)",border:"1px solid rgba(139,92,246,.2)",borderRadius:6,padding:"16px 18px" }} className="fi">
          <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10 }}>
            <span style={{ fontSize:9,color:"#8b5cf6",letterSpacing:".12em" }}>⬡ AI GROWTH REPORT</span>
            <button onClick={()=>setReport("")} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:11 }}>✕</button>
          </div>
          <pre style={{ fontSize:11,color:"#c4c0d8",lineHeight:1.85,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0 }}>{report}</pre>
        </div>
      )}

      {/* KPI row */}
      <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10 }}>
        {[
          {l:"TOTAL WON",v:usd(totalWon),c:"#d4af37"},
          {l:"PIPELINE",v:usd(pipeline),c:"#10b981"},
          {l:"WIN RATE",v:`${convRate}%`,c:"#6366f1"},
          {l:"AVG DEAL SIZE",v:usd(avgDeal),c:"#3b82f6"},
          {l:"LOST DEALS",v:lost.length,c:"#ef4444"},
        ].map(s=>(
          <div key={s.l} style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"12px 14px" }}>
            <div style={{ fontSize:8,color:"#444",letterSpacing:".1em",marginBottom:4 }}>{s.l}</div>
            <div style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:s.c }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Charts row 1 */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>CLOSED REVENUE BY MONTH</div>
          {revenueByMonth.length>0?(
            <ResponsiveContainer width="100%" height={170}>
              <BarChart data={revenueByMonth} margin={{top:0,right:0,bottom:0,left:-10}}>
                <XAxis dataKey="label" tick={{fill:"#555",fontSize:7,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#555",fontSize:7,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`}/>
                <Tooltip contentStyle={{background:"#0b0b16",border:"1px solid #2a2a3a",borderRadius:4,fontFamily:"DM Mono",fontSize:10}} formatter={v=>[`$${Number(v).toLocaleString()}`,"Revenue"]} labelStyle={{color:"#d4af37"}}/>
                <Bar dataKey="value" fill="#d4af37" fillOpacity={0.7} radius={[2,2,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          ):<div style={{height:170,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e1e2e",fontSize:10}}>No closed deals with value yet</div>}
        </div>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>CONTACT ACQUISITION / MONTH</div>
          {contactsByMonth.length>0?(
            <ResponsiveContainer width="100%" height={170}>
              <AreaChart data={contactsByMonth} margin={{top:4,right:0,bottom:0,left:-20}}>
                <defs><linearGradient id="cg" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/><stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/></linearGradient></defs>
                <XAxis dataKey="label" tick={{fill:"#555",fontSize:7,fontFamily:"DM Mono"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fill:"#555",fontSize:8,fontFamily:"DM Mono"}} axisLine={false} tickLine={false} allowDecimals={false}/>
                <Tooltip contentStyle={{background:"#0b0b16",border:"1px solid #2a2a3a",borderRadius:4,fontFamily:"DM Mono",fontSize:10}} labelStyle={{color:"#3b82f6"}}/>
                <Area type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={1.5} fill="url(#cg)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          ):<div style={{height:170,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e1e2e",fontSize:10}}>No contact history yet</div>}
        </div>
      </div>

      {/* Charts row 2 */}
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>DEAL PIPELINE FUNNEL</div>
          {funnelData.length>0?(
            funnelData.map((f,i)=>{
              const maxV = funnelData[0]?.value||1;
              return (
                <div key={i} style={{ marginBottom:6 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:2 }}>
                    <span style={{ fontSize:9,color:f.fill }}>{f.name}</span>
                    <span style={{ fontSize:9,color:"#555" }}>{f.value} deals</span>
                  </div>
                  <div style={{ height:6,background:"#111120",borderRadius:3 }}>
                    <div style={{ width:`${(f.value/maxV)*100}%`,height:"100%",background:f.fill,borderRadius:3,opacity:.7,transition:"width .4s" }}/>
                  </div>
                </div>
              );
            })
          ):<div style={{padding:"20px 0",color:"#1e1e2e",fontSize:10}}>No deals to show</div>}
        </div>
        <div style={{ background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px" }}>
          <div style={{ fontSize:8,color:"#444",letterSpacing:".12em",marginBottom:12 }}>ACTIVITY BREAKDOWN</div>
          {actByType.length>0?(
            actByType.map((a,i)=>{
              const maxV = actByType[0]?.count||1;
              const colors=["#d4af37","#3b82f6","#10b981","#8b5cf6","#f59e0b","#ef4444"];
              const icons={call:"📞",email:"✉",meeting:"📅",note:"📝",task:"☑",sms:"💬"};
              return (
                <div key={i} style={{ marginBottom:7 }}>
                  <div style={{ display:"flex",justifyContent:"space-between",marginBottom:2 }}>
                    <span style={{ fontSize:9,color:"#888" }}>{icons[a.type]||"•"} {a.type}</span>
                    <span style={{ fontSize:9,color:"#555" }}>{a.count}</span>
                  </div>
                  <div style={{ height:4,background:"#111120",borderRadius:2 }}>
                    <div style={{ width:`${(a.count/maxV)*100}%`,height:"100%",background:colors[i%colors.length],borderRadius:2,opacity:.7,transition:"width .4s" }}/>
                  </div>
                </div>
              );
            })
          ):<div style={{padding:"20px 0",color:"#1e1e2e",fontSize:10}}>No activities logged yet</div>}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════
//  MODALS — Contact / Deal / Task / Activity / Doc
// ══════════════════════════════════════════════════════════════════
function ContactModal({ contact, businesses, onClose, onSave }) {
  const [f, setF] = useState({ full_name:"", email:"", phone:"", company:"", title:"", lead_status:"new", business_id:"", date_of_birth:"", notes:"", ...(contact||{}) });
  const [saving, setSaving] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const save = async () => {
    if (!f.full_name.trim()) return; setSaving(true);
    const data = { ...f, updated_at:new Date().toISOString() };
    if (data.date_of_birth) {
      const today = new Date(); const dob = new Date(data.date_of_birth);
      let a = today.getFullYear() - dob.getFullYear();
      if (today.getMonth() < dob.getMonth() || (today.getMonth() === dob.getMonth() && today.getDate() < dob.getDate())) a--;
      data.age = a; data.medicare_eligible = a >= 65;
    }
    if (contact?.id) { await sb("contacts","PATCH",data,`?id=eq.${contact.id}`); }
    else { data.created_at = new Date().toISOString(); await sb("contacts","POST",data); }
    setSaving(false); onSave();
  };
  return (
    <Modal onClose={onClose} title={contact?"✏ EDIT CONTACT":"➕ NEW CONTACT"} width="540px">
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="FULL NAME *"><Inp value={f.full_name} onChange={v=>s("full_name",v)} placeholder="Jane Smith" /></Fld>
        <Fld label="EMAIL"><Inp value={f.email} onChange={v=>s("email",v)} placeholder="jane@email.com" /></Fld>
        <Fld label="PHONE"><Inp value={f.phone} onChange={v=>s("phone",v)} placeholder="(239) 555-0100" /></Fld>
        <Fld label="COMPANY"><Inp value={f.company} onChange={v=>s("company",v)} placeholder="ABC Realty" /></Fld>
        <Fld label="TITLE"><Inp value={f.title} onChange={v=>s("title",v)} placeholder="Real Estate Agent" /></Fld>
        <Fld label="DATE OF BIRTH"><Inp type="date" value={f.date_of_birth||""} onChange={v=>s("date_of_birth",v)} /></Fld>
        <Fld label="LEAD STATUS"><Sel value={f.lead_status} onChange={v=>s("lead_status",v)} options={Object.entries(LEAD_STATUS_CFG).map(([k,v])=>({value:k,label:v.l}))} /></Fld>
        <Fld label="LINKED BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"None"},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
      </div>
      <Fld label="NOTES"><textarea value={f.notes||""} onChange={e=>s("notes",e.target.value)} rows={3} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,resize:"vertical" }} /></Fld>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={save} variant="gold" disabled={saving||!f.full_name.trim()}>{saving?"SAVING...":"SAVE CONTACT"}</Btn>
      </div>
    </Modal>
  );
}

function DealModal({ deal, contacts, businesses, pipelines, onClose, onSave }) {
  const [f, setF] = useState({ title:"", value:"", stage:"lead", status:"open", contact_id:"", business_id:"", pipeline_id:"", expected_close:"", source:"", notes:"", property_address:"", property_lat:"", property_lon:"", ...(deal||{}) });
  const [saving, setSaving] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const save = async () => {
    if (!f.title.trim()) return; setSaving(true);
    const data = { ...f, updated_at:new Date().toISOString() };
    if (deal?.id) { await sb("crm_deals","PATCH",data,`?id=eq.${deal.id}`); }
    else { data.created_at = new Date().toISOString(); await sb("crm_deals","POST",data); }
    setSaving(false); onSave();
  };
  return (
    <Modal onClose={onClose} title={deal?"✏ EDIT DEAL":"💼 NEW DEAL"} width="560px">
      <Fld label="DEAL TITLE *"><Inp value={f.title} onChange={v=>s("title",v)} placeholder="Smith Purchase — $450K" /></Fld>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="LOAN VALUE ($)"><Inp value={f.value} onChange={v=>s("value",v)} placeholder="450000" type="number" /></Fld>
        <Fld label="STAGE"><Sel value={f.stage} onChange={v=>s("stage",v)} options={Object.entries(STAGE_CFG).map(([k,v])=>({value:k,label:v.l}))} /></Fld>
        <Fld label="CONTACT"><Sel value={f.contact_id} onChange={v=>s("contact_id",v)} options={[{value:"",label:"Select contact..."},...contacts.map(c=>({value:c.id,label:c.full_name}))]} /></Fld>
        <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"Select business..."},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
        <Fld label="EXPECTED CLOSE"><Inp value={f.expected_close} onChange={v=>s("expected_close",v)} type="date" /></Fld>
        <Fld label="LEAD SOURCE"><Sel value={f.source} onChange={v=>s("source",v)} options={[{value:"",label:"Unknown"},...["referral","cold call","website","social","event","partner","other"].map(x=>({value:x,label:x.charAt(0).toUpperCase()+x.slice(1)}))]} /></Fld>
      </div>
      <Fld label="PROPERTY ADDRESS (for Walk Score)"><Inp value={f.property_address||""} onChange={v=>s("property_address",v)} placeholder="1234 Main St, Cape Coral, FL 33904" /></Fld>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="LAT (optional)"><Inp value={f.property_lat||""} onChange={v=>s("property_lat",v)} placeholder="26.6553" /></Fld>
        <Fld label="LON (optional)"><Inp value={f.property_lon||""} onChange={v=>s("property_lon",v)} placeholder="-81.9498" /></Fld>
      </div>
      {f.property_address&&f.property_lat&&f.property_lon&&(
        <div style={{marginBottom:12}}>
          <WalkScoreWidget address={f.property_address} lat={parseFloat(f.property_lat)} lon={parseFloat(f.property_lon)} />
        </div>
      )}
      <Fld label="NOTES"><textarea value={f.notes||""} onChange={e=>s("notes",e.target.value)} rows={2} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,resize:"vertical" }} /></Fld>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={save} variant="gold" disabled={saving||!f.title.trim()}>{saving?"SAVING...":"SAVE DEAL"}</Btn>
      </div>
    </Modal>
  );
}

function TaskModal({ task, contacts, deals, onClose, onSave }) {
  const [f, setF] = useState({ title:"", type:"task", priority:"medium", status:"pending", due_at:"", contact_id:"", deal_id:"", notes:"", ...(task||{}) });
  const [saving, setSaving] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const save = async () => {
    if (!f.title.trim()) return; setSaving(true);
    const data = { ...f, updated_at:new Date().toISOString() };
    if (task?.id) { await sb("crm_tasks","PATCH",data,`?id=eq.${task.id}`); }
    else { data.created_at = new Date().toISOString(); await sb("crm_tasks","POST",data); }
    setSaving(false); onSave();
  };
  return (
    <Modal onClose={onClose} title={task?"✏ EDIT TASK":"☑ NEW TASK"} width="480px">
      <Fld label="TASK *"><Inp value={f.title} onChange={v=>s("title",v)} placeholder="Call John about rate lock" /></Fld>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12 }}>
        <Fld label="TYPE"><Sel value={f.type} onChange={v=>s("type",v)} options={Object.entries(TASK_ICONS).map(([k,v])=>({value:k,label:`${v} ${k.replace("_"," ")}`}))} /></Fld>
        <Fld label="PRIORITY"><Sel value={f.priority} onChange={v=>s("priority",v)} options={Object.entries(PRIORITY_CFG).map(([k,v])=>({value:k,label:v.l}))} /></Fld>
        <Fld label="DUE DATE"><Inp value={f.due_at} onChange={v=>s("due_at",v)} type="datetime-local" /></Fld>
      </div>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="CONTACT"><Sel value={f.contact_id} onChange={v=>s("contact_id",v)} options={[{value:"",label:"None"},...contacts.map(c=>({value:c.id,label:c.full_name}))]} /></Fld>
        <Fld label="DEAL"><Sel value={f.deal_id} onChange={v=>s("deal_id",v)} options={[{value:"",label:"None"},...deals.map(d=>({value:d.id,label:d.title}))]} /></Fld>
      </div>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={save} variant="gold" disabled={saving||!f.title.trim()}>{saving?"SAVING...":"SAVE TASK"}</Btn>
      </div>
    </Modal>
  );
}

function ActivityModal({ context, contacts, deals, onClose, onSave }) {
  const [f, setF] = useState({ type:"note", direction:"outbound", subject:"", body:"", contact_id:context?.contact_id||"", deal_id:context?.deal_id||"", is_completed:false });
  const [saving, setSaving] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const save = async () => {
    setSaving(true);
    await sb("crm_activities","POST",{ ...f, created_at:new Date().toISOString(), completed_at:f.is_completed?new Date().toISOString():null });
    setSaving(false); onSave();
  };
  return (
    <Modal onClose={onClose} title="📝 LOG ACTIVITY" width="480px">
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="TYPE"><Sel value={f.type} onChange={v=>s("type",v)} options={["call","email","meeting","note","sms","follow_up"].map(t=>({value:t,label:t.replace("_"," ")}))} /></Fld>
        <Fld label="DIRECTION"><Sel value={f.direction} onChange={v=>s("direction",v)} options={[{value:"outbound",label:"Outbound"},{value:"inbound",label:"Inbound"}]} /></Fld>
        <Fld label="CONTACT"><Sel value={f.contact_id} onChange={v=>s("contact_id",v)} options={[{value:"",label:"None"},...contacts.map(c=>({value:c.id,label:c.full_name}))]} /></Fld>
        <Fld label="DEAL"><Sel value={f.deal_id} onChange={v=>s("deal_id",v)} options={[{value:"",label:"None"},...deals.map(d=>({value:d.id,label:d.title}))]} /></Fld>
      </div>
      <Fld label="SUBJECT"><Inp value={f.subject} onChange={v=>s("subject",v)} placeholder="Brief description" /></Fld>
      <Fld label="NOTES"><textarea value={f.body||""} onChange={e=>s("body",e.target.value)} rows={3} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,resize:"vertical" }} /></Fld>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={save} variant="gold" disabled={saving}>{saving?"SAVING...":"LOG ACTIVITY"}</Btn>
      </div>
    </Modal>
  );
}

function DocUploadModal({ businesses, folders, onClose, onSave }) {
  const [f, setF] = useState({ name:"", category:"general", business_id:"", folder_id:"", description:"" });
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  const upload = async () => {
    if (!f.name.trim()) return; setUploading(true);
    let url = null;
    if (file) url = await sbStorage(`${Date.now()}_${file.name}`, file);
    await sb("documents","POST",{ ...f, url, size:file?`${(file.size/1024).toFixed(0)} KB`:null, created_at:new Date().toISOString() });
    setUploading(false); onSave();
  };
  const aiSummary = async () => {
    if (!f.name.trim()) return; setAiLoading(true);
    const txt = await claude("Mortgage document analyst. Given a document name and category, write a 2-sentence description of what this document likely contains and its importance.", `Name: ${f.name}\nCategory: ${f.category}`, 200);
    if (txt) s("description", txt);
    setAiLoading(false);
  };
  return (
    <Modal onClose={onClose} title="📎 UPLOAD DOCUMENT" width="500px">
      <Fld label="DOCUMENT NAME *"><Inp value={f.name} onChange={v=>s("name",v)} placeholder="Rate Sheet March 2025" /></Fld>
      <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12 }}>
        <Fld label="CATEGORY"><Sel value={f.category} onChange={v=>s("category",v)} options={Object.keys(CAT_COLORS).map(k=>({value:k,label:k.replace("_"," ")}))} /></Fld>
        <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"General"},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
      </div>
      <Fld label="FILE"><input type="file" onChange={e=>{ const fl=e.target.files[0]; if(fl){setFile(fl); if(!f.name)s("name",fl.name.replace(/\.[^.]+$/,""));} }} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#888",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3 }} /></Fld>
      <div style={{ display:"flex",gap:6,marginBottom:8 }}>
        <Btn onClick={aiSummary} variant="purple" disabled={aiLoading||!f.name.trim()} style={{ fontSize:8,padding:"3px 10px" }}>
          {aiLoading?<span className="pulse">🧠 generating...</span>:"🧠 AI DESCRIBE"}
        </Btn>
      </div>
      <Fld label="DESCRIPTION"><textarea value={f.description||""} onChange={e=>s("description",e.target.value)} rows={2} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,resize:"vertical" }} /></Fld>
      <div style={{ display:"flex",gap:8,justifyContent:"flex-end",marginTop:4 }}>
        <Btn onClick={onClose}>CANCEL</Btn>
        <Btn onClick={upload} variant="gold" disabled={uploading||!f.name.trim()}>{uploading?"UPLOADING...":"⬆ UPLOAD"}</Btn>
      </div>
    </Modal>
  );
}

// ─── PDF LEAD IMPORTER ────────────────────────────────────────────
function PDFLeadImporter({ businesses, onClose, onImport }) {
  const [file, setFile] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState([]); // [{name,email,phone,company,title,notes,_sel}]
  const [step, setStep] = useState("upload"); // upload | review | done
  const [targetBiz, setTargetBiz] = useState("");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState("");

  const extract = async () => {
    if (!file) return;
    setExtracting(true); setProgress("Reading PDF...");
    try {
      const b64 = await fileToBase64(file);
      setProgress("Claude is scanning for leads...");
      const sys = `You are a lead extraction specialist. Read this document carefully and extract every person or organization that could be a business lead or contact. Respond STRICT JSON only — an array of objects: [{"name":"full name","email":"email or null","phone":"phone or null","company":"company or null","title":"job title or null","notes":"any relevant context, loan type, property, etc. (1-2 sentences)","segment":"first-time buyer|investor|refinance|self-employed|commercial|agent|other"}]. Extract ALL people you can find. Return [] if none found.`;
      const raw = await claudeWithDoc(sys, b64, "Extract every contact/lead from this document.", 1400);
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      const leads = (Array.isArray(parsed)?parsed:[]).map(l=>({...l,_sel:true,_id:Math.random().toString(36).slice(2)}));
      setExtracted(leads);
      setStep("review");
    } catch(e) {
      setProgress("⚠ Could not parse PDF — try a text-based PDF");
      console.error(e);
    }
    setExtracting(false);
  };

  const toggleAll = v => setExtracted(p=>p.map(l=>({...l,_sel:v})));

  const doImport = async () => {
    const selected = extracted.filter(l=>l._sel);
    if (!selected.length) return;
    setImporting(true); setProgress(`Importing ${selected.length} contacts...`);
    let saved = 0;
    for (const l of selected) {
      const rec = {
        full_name: l.name||"Unknown", email:l.email||null, phone:l.phone||null,
        company:l.company||null, title:l.title||null, notes:l.notes||null,
        lead_status:"nurture", business_id:targetBiz||null,
        tags:[l.segment||"imported","pdf-import"],
        created_at:new Date().toISOString()
      };
      await sb("contacts","POST",rec);
      saved++;
      setProgress(`Imported ${saved}/${selected.length}...`);
    }
    setStep("done");
    setImporting(false);
    onImport(saved);
  };

  const SEGMENT_COLORS = {"first-time buyer":"#6366f1","investor":"#d4af37","refinance":"#10b981","self-employed":"#f59e0b","commercial":"#3b82f6","agent":"#8b5cf6","other":"#555"};

  return (
    <Modal onClose={onClose} title="📄 PDF LEAD IMPORT" width="780px">
      {step==="upload"&&(
        <div>
          <div style={{background:"rgba(212,175,55,.04)",border:"1px dashed rgba(212,175,55,.3)",borderRadius:6,padding:"28px 20px",textAlign:"center",marginBottom:16}}>
            <div style={{fontSize:32,marginBottom:8}}>📄</div>
            <div style={{fontSize:12,color:"#888",marginBottom:4}}>Drop any PDF with contacts, leads, lists, or rosters</div>
            <div style={{fontSize:9,color:"#444",marginBottom:14}}>Rate sheets, referral lists, open house sign-ins, investor rosters, event attendee lists...</div>
            <input type="file" accept=".pdf" onChange={e=>setFile(e.target.files[0])}
              style={{background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#888",fontFamily:"inherit",fontSize:11,padding:"6px 12px",borderRadius:3,cursor:"pointer"}}/>
          </div>
          {file&&<div style={{fontSize:10,color:"#d4af37",marginBottom:12}}>📎 {file.name} ({(file.size/1024).toFixed(0)} KB)</div>}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
            <Fld label="ASSIGN TO BUSINESS (OPTIONAL)">
              <Sel value={targetBiz} onChange={setTargetBiz} options={[{value:"",label:"General / Unassigned"},...businesses.map(b=>({value:b.id,label:b.name}))]}/>
            </Fld>
          </div>
          {progress&&<div className="pulse" style={{fontSize:10,color:"#a78bfa",marginBottom:10}}>{progress}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={onClose}>CANCEL</Btn>
            <Btn onClick={extract} variant="gold" disabled={!file||extracting}>
              {extracting?<span className="pulse">🧠 Scanning PDF...</span>:"🧠 EXTRACT LEADS WITH AI"}
            </Btn>
          </div>
        </div>
      )}

      {step==="review"&&(
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
            <div>
              <div style={{fontSize:12,color:"#e0dcd0"}}>Found <span style={{color:"#d4af37",fontWeight:600}}>{extracted.length}</span> leads in "{file?.name}"</div>
              <div style={{fontSize:9,color:"#555"}}>Review and deselect any you don't want to import</div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <Btn onClick={()=>toggleAll(true)} style={{fontSize:8,padding:"3px 9px"}}>SELECT ALL</Btn>
              <Btn onClick={()=>toggleAll(false)} style={{fontSize:8,padding:"3px 9px"}}>DESELECT ALL</Btn>
            </div>
          </div>
          <div style={{maxHeight:400,overflowY:"auto",display:"flex",flexDirection:"column",gap:5,marginBottom:14}}>
            {extracted.length===0&&<div style={{textAlign:"center",padding:30,color:"#333",fontSize:10}}>No contacts found in this PDF</div>}
            {extracted.map((l,i)=>(
              <div key={l._id} onClick={()=>setExtracted(p=>p.map((x,j)=>j===i?{...x,_sel:!x._sel}:x))}
                style={{background:l._sel?"rgba(212,175,55,.06)":"#0a0a12",border:`1px solid ${l._sel?"rgba(212,175,55,.25)":"#1a1a28"}`,borderRadius:4,padding:"10px 12px",cursor:"pointer",display:"flex",gap:12,alignItems:"flex-start",transition:"all .1s"}}>
                <div style={{width:16,height:16,borderRadius:3,border:`1px solid ${l._sel?"#d4af37":"#333"}`,background:l._sel?"#d4af37":"transparent",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,flexShrink:0,marginTop:1}}>
                  {l._sel&&"✓"}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:3}}>
                    <span style={{fontSize:11,color:"#e0dcd0",fontWeight:"500"}}>{l.name||"(no name)"}</span>
                    {l.title&&<span style={{fontSize:9,color:"#555"}}>{l.title}</span>}
                    {l.company&&<span style={{fontSize:9,color:"#888"}}>@ {l.company}</span>}
                    {l.segment&&<Bd label={l.segment} color={SEGMENT_COLORS[l.segment]||"#555"}/>}
                  </div>
                  <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
                    {l.email&&<span style={{fontSize:9,color:"#6366f1"}}>✉ {l.email}</span>}
                    {l.phone&&<span style={{fontSize:9,color:"#10b981"}}>📞 {l.phone}</span>}
                  </div>
                  {l.notes&&<div style={{fontSize:9,color:"#555",marginTop:3,lineHeight:1.5}}>{l.notes}</div>}
                </div>
              </div>
            ))}
          </div>
          <div style={{background:"rgba(212,175,55,.04)",border:"1px solid rgba(212,175,55,.15)",borderRadius:4,padding:"8px 12px",marginBottom:14,fontSize:9,color:"#888"}}>
            <span style={{color:"#d4af37",fontWeight:600}}>{extracted.filter(l=>l._sel).length}</span> leads selected → will be added as contacts with status <span style={{color:"#555"}}>NURTURE</span>{targetBiz?` linked to ${businesses.find(b=>b.id===targetBiz)?.name}`:""}
          </div>
          {progress&&<div className={importing?"pulse":""} style={{fontSize:10,color:"#10b981",marginBottom:10}}>{progress}</div>}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={()=>setStep("upload")}>← BACK</Btn>
            <Btn onClick={doImport} variant="gold" disabled={importing||!extracted.filter(l=>l._sel).length}>
              {importing?<span className="pulse">IMPORTING...</span>:`⬆ IMPORT ${extracted.filter(l=>l._sel).length} CONTACTS`}
            </Btn>
          </div>
        </div>
      )}

      {step==="done"&&(
        <div style={{textAlign:"center",padding:"30px 0"}}>
          <div style={{fontSize:40,marginBottom:12}}>✅</div>
          <div style={{fontSize:14,color:"#d4af37",fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".2em",marginBottom:6}}>IMPORT COMPLETE</div>
          <div style={{fontSize:11,color:"#888",marginBottom:20}}>{extracted.filter(l=>l._sel).length} contacts added with status <span style={{color:"#f59e0b"}}>NURTURE</span></div>
          <Btn onClick={onClose} variant="gold" style={{padding:"8px 24px"}}>DONE</Btn>
        </div>
      )}
    </Modal>
  );
}

// ─── NURTURE SEQUENCE MODAL ───────────────────────────────────────
function NurtureSequenceModal({ contacts, businesses, onClose, onSave, showToast }) {
  const [step, setStep] = useState("build"); // build | preview | assign
  const [f, setF] = useState({ name:"", description:"", target_segment:"all", business_id:"" });
  const [steps, setSteps] = useState([]);
  const [building, setBuilding] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [selectedContacts, setSelectedContacts] = useState([]);
  const fs = (k,v) => setF(p=>({...p,[k]:v}));

  const targetContacts = useMemo(()=>{
    if (f.target_segment==="nurture") return contacts.filter(c=>c.lead_status==="nurture");
    if (f.target_segment==="new") return contacts.filter(c=>c.lead_status==="new"||!c.lead_status);
    if (f.target_segment==="qualified") return contacts.filter(c=>c.lead_status==="qualified");
    if (f.target_segment==="cold") return contacts.filter(c=>c.lead_status==="contacted");
    return contacts.filter(c=>c.email);
  }, [f.target_segment, contacts]);

  const buildSequence = async () => {
    if (!f.description.trim()) return;
    setBuilding(true);
    const sys = `You are an expert mortgage broker sales coach. Design a nurture email/call sequence. Respond STRICT JSON only — an array of steps: [{"day":0,"type":"email|call|sms|task","subject":"subject line or task title","body":"message body or call script (2-4 sentences)","goal":"what this step achieves"}]. Include 5-7 steps spanning 30-60 days. Day 0 = immediate.`;
    const raw = await claude(sys, `Sequence name: ${f.name}\nGoal: ${f.description}\nTarget: ${f.target_segment} contacts\nBusiness: ${businesses.find(b=>b.id===f.business_id)?.name||"mortgage broker group"}`, 1000);
    try {
      const parsed = JSON.parse(raw.replace(/```json|```/g,"").trim());
      setSteps(Array.isArray(parsed)?parsed:[]);
      setSelectedContacts(targetContacts.map(c=>c.id));
      setStep("preview");
    } catch { showToast("⚠ Could not build sequence — try again"); }
    setBuilding(false);
  };

  const assignSequence = async () => {
    if (!selectedContacts.length||!steps.length) return;
    setAssigning(true);
    // Save the sequence
    const seq = { name:f.name, description:f.description, steps, status:"active", business_id:f.business_id||null, contact_count:selectedContacts.length, created_at:new Date().toISOString() };
    await sb("nurture_sequences","POST",seq).catch(()=>{});
    // Create tasks for each contact × each step
    const now = new Date();
    let taskCount = 0;
    for (const contactId of selectedContacts) {
      for (const s of steps) {
        const dueDate = new Date(now); dueDate.setDate(dueDate.getDate()+(s.day||0));
        await sb("crm_tasks","POST",{
          title: s.subject||s.goal, type:s.type||"task",
          priority: s.day===0?"high":"medium",
          status:"pending", contact_id:contactId,
          due_at: dueDate.toISOString(),
          notes:`Nurture sequence: ${f.name}\n\n${s.body||""}`,
          created_at:new Date().toISOString()
        });
        taskCount++;
      }
    }
    setAssigning(false);
    onSave(selectedContacts.length, taskCount);
    onClose();
  };

  return (
    <Modal onClose={onClose} title="🌱 NURTURE SEQUENCE BUILDER" width="720px">
      {step==="build"&&(
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <Fld label="SEQUENCE NAME *"><Inp value={f.name} onChange={v=>fs("name",v)} placeholder="30-Day New Lead Nurture" /></Fld>
            <Fld label="BUSINESS">
              <Sel value={f.business_id} onChange={v=>fs("business_id",v)} options={[{value:"",label:"All / General"},...businesses.map(b=>({value:b.id,label:b.name}))]}/>
            </Fld>
            <Fld label="TARGET SEGMENT">
              <Sel value={f.target_segment} onChange={v=>fs("target_segment",v)} options={[
                {value:"all",label:`All with email (${contacts.filter(c=>c.email).length})`},
                {value:"nurture",label:`Nurture status (${contacts.filter(c=>c.lead_status==="nurture").length})`},
                {value:"new",label:`New contacts (${contacts.filter(c=>c.lead_status==="new"||!c.lead_status).length})`},
                {value:"qualified",label:`Qualified leads (${contacts.filter(c=>c.lead_status==="qualified").length})`},
                {value:"cold",label:`Contacted (${contacts.filter(c=>c.lead_status==="contacted").length})`},
              ]}/>
            </Fld>
          </div>
          <Fld label="DESCRIBE THE SEQUENCE GOAL">
            <textarea value={f.description} onChange={e=>fs("description",e.target.value)} rows={4}
              placeholder="e.g. Nurture new leads from PDF import — educate about mortgage options, build trust, and guide them toward a pre-approval call. Mix of educational emails and soft check-ins."
              style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"10px 12px",borderRadius:3,resize:"vertical",lineHeight:1.7}}/>
          </Fld>
          <div style={{background:"rgba(212,175,55,.04)",border:"1px solid rgba(212,175,55,.15)",borderRadius:4,padding:"8px 12px",marginBottom:14,fontSize:9,color:"#888"}}>
            This sequence will target <span style={{color:"#d4af37",fontWeight:600}}>{targetContacts.length} contacts</span>. Claude will generate 5-7 steps with email drafts and call scripts.
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={onClose}>CANCEL</Btn>
            <Btn onClick={buildSequence} variant="purple" disabled={building||!f.name.trim()||!f.description.trim()}>
              {building?<span className="pulse">🧠 building sequence...</span>:"🧠 BUILD SEQUENCE WITH AI"}
            </Btn>
          </div>
        </div>
      )}

      {step==="preview"&&(
        <div>
          <div style={{fontSize:11,color:"#888",marginBottom:14}}>AI generated <span style={{color:"#d4af37"}}>{steps.length} steps</span> for <span style={{color:"#d4af37"}}>{f.name}</span>. Review and assign.</div>
          <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:14,maxHeight:340,overflowY:"auto"}}>
            {steps.map((s,i)=>{
              const typeColors={email:"#6366f1",call:"#10b981",sms:"#f59e0b",task:"#8b5cf6"};
              const icons={email:"✉",call:"📞",sms:"💬",task:"☑"};
              return (
                <div key={i} style={{background:"#0d0d18",border:`1px solid ${typeColors[s.type]||"#1e1e28"}22`,borderRadius:4,padding:"10px 12px",display:"flex",gap:12}}>
                  <div style={{textAlign:"center",flexShrink:0,width:44}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:typeColors[s.type]||"#555"}}>{s.day===0?"NOW":`D${s.day}`}</div>
                    <div style={{fontSize:11}}>{icons[s.type]||"•"}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:10,color:"#e0dcd0",marginBottom:3}}>{s.subject}</div>
                    {s.body&&<div style={{fontSize:9,color:"#555",lineHeight:1.6,borderLeft:"2px solid #1a1a28",paddingLeft:8}}>{s.body}</div>}
                    {s.goal&&<div style={{fontSize:8,color:"#8b5cf6",marginTop:4}}>Goal: {s.goal}</div>}
                  </div>
                  <Bd label={s.type||"task"} color={typeColors[s.type]||"#555"}/>
                </div>
              );
            })}
          </div>
          <div style={{background:"rgba(16,185,129,.04)",border:"1px solid rgba(16,185,129,.2)",borderRadius:4,padding:"10px 14px",marginBottom:14}}>
            <div style={{fontSize:9,color:"#10b981",marginBottom:6}}>ASSIGN TO CONTACTS</div>
            <div style={{fontSize:10,color:"#888",marginBottom:8}}>{selectedContacts.length} of {targetContacts.length} contacts selected · {steps.length * selectedContacts.length} tasks will be created</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",maxHeight:80,overflowY:"auto"}}>
              {targetContacts.map(c=>{
                const sel=selectedContacts.includes(c.id);
                return <button key={c.id} onClick={()=>setSelectedContacts(p=>sel?p.filter(x=>x!==c.id):[...p,c.id])} style={{background:sel?"rgba(16,185,129,.12)":"rgba(255,255,255,.02)",border:`1px solid ${sel?"rgba(16,185,129,.4)":"#1a1a28"}`,color:sel?"#10b981":"#555",fontFamily:"inherit",fontSize:8,padding:"2px 8px",borderRadius:3,cursor:"pointer"}}>{c.full_name}</button>;
              })}
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <Btn onClick={()=>setStep("build")}>← REBUILD</Btn>
            <Btn onClick={assignSequence} variant="gold" disabled={assigning||!selectedContacts.length}>
              {assigning?<span className="pulse">CREATING TASKS...</span>:`🚀 LAUNCH SEQUENCE (${steps.length * selectedContacts.length} tasks)`}
            </Btn>
          </div>
        </div>
      )}
    </Modal>
  );
}


// ─── WALK SCORE WIDGET ────────────────────────────────────────────
function WalkScoreWidget({ address, lat, lon, compact=false }) {
  const [scores, setScores] = useState(null);
  const [loading, setLoading] = useState(false);
  const [tried, setTried] = useState(false);

  useEffect(()=>{
    if (!address||!lat||!lon||tried) return;
    setTried(true); setLoading(true);
    fetchWalkScore(address,lat,lon).then(s=>{ setScores(s); setLoading(false); });
  },[address,lat,lon,tried]);

  if (!address) return null;
  if (loading) return <span className="pulse" style={{fontSize:8,color:"#555"}}>walk…</span>;
  if (!scores) return null;

  if (compact) return (
    <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
      {[{l:"🚶",v:scores.walk},{l:"🚌",v:scores.transit},{l:"🚴",v:scores.bike}]
        .filter(s=>s.v!=null).map(s=>(
        <span key={s.l} style={{background:`${wsColor(s.v)}18`,border:`1px solid ${wsColor(s.v)}30`,borderRadius:3,padding:"1px 5px",fontSize:8,color:wsColor(s.v)}}>{s.l}{s.v}</span>
      ))}
    </div>
  );

  return (
    <div style={{background:"rgba(16,185,129,.04)",border:"1px solid rgba(16,185,129,.18)",borderRadius:5,padding:"10px 12px"}}>
      <div style={{fontSize:8,color:"#10b981",letterSpacing:".1em",marginBottom:8}}>📍 NEIGHBORHOOD SCORES</div>
      <div style={{display:"flex",gap:8}}>
        {[{l:"🚶 WALK",v:scores.walk,d:scores.walkDesc},{l:"🚌 TRANSIT",v:scores.transit,d:scores.transitDesc},{l:"🚴 BIKE",v:scores.bike,d:scores.bikeDesc}]
          .filter(s=>s.v!=null).map(s=>(
          <div key={s.l} style={{flex:1,textAlign:"center",background:"#0a0a14",border:`1px solid ${wsColor(s.v)}28`,borderRadius:4,padding:"7px 8px"}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:wsColor(s.v),lineHeight:1}}>{s.v}</div>
            <div style={{fontSize:7,color:"#555",letterSpacing:".08em",marginTop:2}}>{s.l}</div>
            {s.d&&<div style={{fontSize:7,color:wsColor(s.v),marginTop:2,lineHeight:1.3}}>{s.d}</div>}
          </div>
        ))}
      </div>
      <div style={{fontSize:7,color:"#2a2a3a",marginTop:5}}>📍 {address}</div>
    </div>
  );
}

// ─── RATE TICKER (top bar) ─────────────────────────────────────────
function RateTicker() {
  const [rates, setRates] = useState(null);
  useEffect(()=>{
    Promise.all([fetchFRED("MORTGAGE30US",2),fetchFRED("MORTGAGE15US",2),fetchFRED("DGS10",2)])
      .then(([r30,r15,t10])=>setRates({r30,r15,t10}));
  },[]);

  if (!rates) return <div className="sh" style={{width:180,height:12,borderRadius:2}}/>;
  return (
    <div style={{display:"flex",gap:6,alignItems:"center",padding:"0 8px",borderLeft:"1px solid #1a1a28",borderRight:"1px solid #1a1a28",flexShrink:0}}>
      {[{l:"30Y",d:rates.r30,c:"#d4af37"},{l:"15Y",d:rates.r15,c:"#10b981"},{l:"10T",d:rates.t10,c:"#6366f1"}]
        .filter(s=>s.d).map(s=>(
        <div key={s.l} style={{display:"flex",gap:3,alignItems:"center"}}>
          <span style={{fontSize:7,color:"#333"}}>{s.l}</span>
          <span style={{fontSize:9,color:s.c,fontFamily:"'Bebas Neue',sans-serif"}}>{s.d.latest}%</span>
          <span style={{fontSize:7,color:s.d.change>=0?"#ef4444":"#10b981"}}>{s.d.change>=0?"▲":"▼"}{Math.abs(s.d.change)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── MARKET INTEL VIEW ────────────────────────────────────────────
const FRED_SERIES = [
  {id:"MORTGAGE30US",label:"30-Yr Fixed",  labelEs:"Fijo 30 Años",  color:"#d4af37",unit:"%"},
  {id:"MORTGAGE15US",label:"15-Yr Fixed",  labelEs:"Fijo 15 Años",  color:"#10b981",unit:"%"},
  {id:"MORTGAGE5US", label:"5/1 ARM",      labelEs:"5/1 ARM",       color:"#6366f1",unit:"%"},
  {id:"DGS10",       label:"10-Yr Treasury",labelEs:"Tesoro 10 Años",color:"#3b82f6",unit:"%"},
  {id:"FEDFUNDS",    label:"Fed Funds",    labelEs:"Fondos Fed",    color:"#8b5cf6",unit:"%"},
  {id:"CSUSHPINSA",  label:"Case-Shiller HPI",labelEs:"Índice Case-Shiller",color:"#f59e0b",unit:""},
  {id:"HOUST",       label:"Housing Starts",labelEs:"Inicios de Vivienda",color:"#ef4444",unit:"K"},
  {id:"DRCCLACBS",   label:"CC Delinquency",labelEs:"Morosidad TC",color:"#a78bfa",unit:"%"},
  {id:"MSPUS",       label:"Median Home Price",labelEs:"Precio Mediano",color:"#10b981",unit:"$"},
];
const NEWS_TOPICS = [
  {id:"mortgage",   label:"🏠 Mortgage",   labelEs:"🏠 Hipotecas",   q:"mortgage rates interest"},
  {id:"realestate", label:"🏡 Real Estate", labelEs:"🏡 Bienes Raíces", q:"real estate housing market"},
  {id:"insurance",  label:"🛡 Insurance",   labelEs:"🛡 Seguros",     q:"homeowners insurance Florida"},
  {id:"credit",     label:"💳 Credit",      labelEs:"💳 Crédito",     q:"credit market consumer debt"},
  {id:"economy",    label:"📈 Economy",     labelEs:"📈 Economía",    q:"federal reserve inflation rates"},
];
const MKT_LANG = {
  en:{
    title:"MARKET INTELLIGENCE",sub:"LIVE FRED DATA · GNEWS FEED",updated:"Updated",refresh:"↻ REFRESH FRED",loading:"↻ loading…",
    trend:"TREND",selectSeries:"Select a series",loadingText:"Loading…",loadNews:"No articles — click a topic tab to load",loadingNews:"Loading news…",
    aiBrief:"🧠 AI BRIEF",aiThinking:"🧠…",aiTitle:"⬡ AI MARKET BRIEF",dismiss:"dismiss",
    aiPrompt:"You are a mortgage broker market analyst. Summarize these news headlines into a sharp 2-3 paragraph briefing focused on: rate implications, borrower impact, and one actionable opportunity. No fluff."
  },
  es:{
    title:"INTELIGENCIA DE MERCADO",sub:"DATOS FRED EN VIVO · NOTICIAS",updated:"Actualizado",refresh:"↻ ACTUALIZAR FRED",loading:"↻ cargando…",
    trend:"TENDENCIA",selectSeries:"Seleccione una serie",loadingText:"Cargando…",loadNews:"Sin artículos — haz clic en una pestaña para cargar",loadingNews:"Cargando noticias…",
    aiBrief:"🧠 RESUMEN IA",aiThinking:"🧠…",aiTitle:"⬡ RESUMEN DE MERCADO IA",dismiss:"cerrar",
    aiPrompt:"Eres un analista de mercado hipotecario. Resume estos titulares en un informe de 2-3 párrafos enfocado en: implicaciones de tasas, impacto al prestatario, y una oportunidad accionable. Sin relleno. Responde en español."
  }
};

// ── E-SIGNATURE VIEW ────────────────────────────────────────────────────────
const SIGN_LANG = {
  es: {
    title: "FIRMA ELECTRÓNICA", sub: "FIRMA DIGITAL DE DOCUMENTOS",
    newEnvelope: "+ NUEVO SOBRE", templates: "📋 PLANTILLAS",
    all: "Todos", pending: "Pendientes", signed: "Firmados", declined: "Rechazados", expired: "Expirados", drafts: "Borradores",
    sent: "Enviados", viewed: "Vistos",
    title2: "TÍTULO", signerName: "NOMBRE DEL FIRMANTE", signerEmail: "EMAIL", signerPhone: "TELÉFONO",
    selectContact: "Seleccionar contacto...", document: "DOCUMENTO", uploadDoc: "Subir documento (PDF)",
    message: "MENSAJE AL FIRMANTE", messagePlaceholder: "Mensaje opcional para el firmante...",
    language: "IDIOMA", expiration: "EXPIRACIÓN", addField: "+ AGREGAR CAMPO",
    fieldType: "TIPO", fieldLabel: "ETIQUETA", required: "Requerido",
    signature: "Firma", initials: "Iniciales", date: "Fecha", text: "Texto", checkbox: "Casilla",
    createSend: "CREAR Y ENVIAR", saveDraft: "GUARDAR BORRADOR", cancel: "CANCELAR",
    copyLink: "📋 Copiar enlace", sendReminder: "📤 Recordatorio", viewSig: "👁 Ver firma",
    viewAudit: "📊 Auditoría", delete: "🗑 Eliminar",
    signLink: "Enlace de firma copiado", envelopeCreated: "Sobre creado y enlace copiado",
    reminderSent: "Recordatorio enviado", confirmDelete: "¿Eliminar este sobre?",
    auditTrail: "HISTORIAL DE AUDITORÍA", signaturePreview: "VISTA PREVIA DE FIRMA",
    noEnvelopes: "Sin sobres — crea uno nuevo", from: "De", to: "Para", on: "el",
    saving: "GUARDANDO...", uploading: "Subiendo...", saveTemplate: "Guardar como plantilla",
    templateName: "NOMBRE DE PLANTILLA", templateSaved: "Plantilla guardada", useTemplate: "Usar",
    noTemplates: "Sin plantillas guardadas",
  },
  en: {
    title: "E-SIGNATURE", sub: "DIGITAL DOCUMENT SIGNING",
    newEnvelope: "+ NEW ENVELOPE", templates: "📋 TEMPLATES",
    all: "All", pending: "Pending", signed: "Signed", declined: "Declined", expired: "Expired", drafts: "Drafts",
    sent: "Sent", viewed: "Viewed",
    title2: "TITLE", signerName: "SIGNER NAME", signerEmail: "EMAIL", signerPhone: "PHONE",
    selectContact: "Select contact...", document: "DOCUMENT", uploadDoc: "Upload document (PDF)",
    message: "MESSAGE TO SIGNER", messagePlaceholder: "Optional message to signer...",
    language: "LANGUAGE", expiration: "EXPIRATION", addField: "+ ADD FIELD",
    fieldType: "TYPE", fieldLabel: "LABEL", required: "Required",
    signature: "Signature", initials: "Initials", date: "Date", text: "Text", checkbox: "Checkbox",
    createSend: "CREATE & SEND", saveDraft: "SAVE DRAFT", cancel: "CANCEL",
    copyLink: "📋 Copy Link", sendReminder: "📤 Reminder", viewSig: "👁 View Signature",
    viewAudit: "📊 Audit", delete: "🗑 Delete",
    signLink: "Sign link copied", envelopeCreated: "Envelope created and link copied",
    reminderSent: "Reminder sent", confirmDelete: "Delete this envelope?",
    auditTrail: "AUDIT TRAIL", signaturePreview: "SIGNATURE PREVIEW",
    noEnvelopes: "No envelopes — create one", from: "From", to: "To", on: "on",
    saving: "SAVING...", uploading: "Uploading...", saveTemplate: "Save as Template",
    templateName: "TEMPLATE NAME", templateSaved: "Template saved", useTemplate: "Use",
    noTemplates: "No templates saved",
  }
};

const ESIGN_STATUS = {draft:"#555",sent:"#3b82f6",viewed:"#f59e0b",signed:"#10b981",declined:"#ef4444",expired:"#6b7280"};

function ESignatureView({ user, contacts, businesses, showToast }) {
  const [lang, setLang] = useState("es");
  const L = SIGN_LANG[lang];
  const [envelopes, setEnvelopes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("all");
  const [showNew, setShowNew] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [expandedId, setExpandedId] = useState(null);
  const [auditId, setAuditId] = useState(null);
  const [auditData, setAuditData] = useState([]);
  const [sigView, setSigView] = useState(null);
  const [saving, setSaving] = useState(false);
  const [sysTemplates, setSysTemplates] = useState([]);
  const [formPacks, setFormPacks] = useState([]);
  const [showPacks, setShowPacks] = useState(false);
  const [selPack, setSelPack] = useState(null);
  const [packContact, setPackContact] = useState("");
  const [packSending, setPackSending] = useState(false);
  const [formPreview, setFormPreview] = useState(null);
  const [tplFilter, setTplFilter] = useState("all");

  // New envelope form
  const emptyForm = {title:"",signer_name:"",signer_email:"",signer_phone:"",contact_id:"",message:"",language:"es",expires_at:"",fields:[],document:null,document_name:"",template_id:null,property_address:""};
  const [form, setForm] = useState({...emptyForm});
  const sf = (k,v) => setForm(p=>({...p,[k]:v}));

  const loadEnvelopes = useCallback(async ()=>{
    setLoading(true);
    const data = await sb("vault_envelopes","GET",null,`?sender_id=eq.${user.id}&order=created_at.desc`);
    if(data) setEnvelopes(data);
    setLoading(false);
  },[user.id]);

  useEffect(()=>{
    loadEnvelopes();
    sb("vault_signature_templates","GET",null,"?is_system=eq.true&order=business_type,name").then(r=>{ if(r) setSysTemplates(r); });
    sb("vault_form_packs","GET",null,"?order=business_type,name").then(r=>{ if(r) setFormPacks(r); });
  },[loadEnvelopes]);

  const loadTemplates = async ()=>{
    const data = await sb("vault_signature_templates","GET",null,`?created_by=eq.${user.id}&order=created_at.desc`);
    if(data) setTemplates(data);
  };

  const stats = useMemo(()=>{
    const s={sent:0,signed:0,pending:0,declined:0};
    envelopes.forEach(e=>{
      if(e.status==="signed") s.signed++;
      else if(e.status==="declined") s.declined++;
      else if(e.status==="sent"||e.status==="viewed") { s.sent++; s.pending++; }
    });
    return s;
  },[envelopes]);

  const filtered = useMemo(()=>{
    if(tab==="all") return envelopes;
    if(tab==="pending") return envelopes.filter(e=>e.status==="sent"||e.status==="viewed");
    return envelopes.filter(e=>e.status===tab);
  },[envelopes,tab]);

  const TABS = [{id:"all",l:L.all},{id:"pending",l:L.pending},{id:"signed",l:L.signed},{id:"declined",l:L.declined},{id:"expired",l:L.expired},{id:"draft",l:L.drafts}];

  const genToken = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)+Date.now().toString(36);

  const handleCreate = async (asDraft) => {
    if(!form.title.trim()) return;
    setSaving(true);
    let docUrl = null, docName = form.document_name;
    if(form.document) {
      const path = `esign/${user.id}/${Date.now()}_${form.document.name}`;
      docUrl = await sbStorage(path, form.document);
      if(!docUrl){ showToast("Upload failed"); setSaving(false); return; }
      docName = form.document.name;
    }
    const token = genToken();
    // Get template form_html and replace merge fields
    const tpl = sysTemplates.find(t => t.id === form.template_id);
    let formHtml = tpl?.form_html || null;
    if (formHtml) {
      // If template uses {{affiliated_businesses}}, fetch them dynamically
      if (formHtml.includes("{{affiliated_businesses}}")) {
        const bizList = await sb("vault_affiliated_businesses","GET",null,"?is_active=eq.true&order=sort_order");
        if (bizList?.length) {
          const bizHtml = bizList.map((b,i) => `<h3>${i+1}. ${b.entity_name}</h3><ul><li><b>Business Type:</b> ${b.license_info||b.business_type}</li><li><b>Location:</b> ${b.location}</li><li><b>Owner's Name:</b> ${b.owner_name}</li><li><b>Ownership %:</b> ${b.ownership_pct}</li><li><b>Fee Structure:</b> ${b.fee_structure}</li>${b.extra_info?`<li><b>${b.extra_info}</b></li>`:""}</ul>`).join("");
          formHtml = formHtml.replace(/\{\{affiliated_businesses\}\}/g, bizHtml);
          const namesList = bizList.map(b=>b.entity_name).join(", ");
          formHtml = formHtml.replace(/\{\{affiliated_names_list\}\}/g, namesList);
        }
      }
      const c = form.contact_id ? contacts.find(x => x.id === form.contact_id) : null;
      if (c) {
        formHtml = formHtml
          .replace(/\{\{contact\.name\}\}/g, c.full_name || "")
          .replace(/\{\{contact\.email\}\}/g, c.email || "")
          .replace(/\{\{contact\.phone\}\}/g, c.phone || "")
          .replace(/\{\{contact\.company\}\}/g, c.company || "");
      }
      formHtml = formHtml
        .replace(/\{\{date\.today\}\}/g, new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}))
        .replace(/\{\{agent\.name\}\}/g, "Kenneth Wolf")
        .replace(/\{\{property\.address\}\}/g, form.property_address || "[To Be Determined]");
    }
    const env = {
      title:form.title, status:asDraft?"draft":"sent", document_url:docUrl, document_name:docName,
      sender_id:user.id, sender_name:user.user_metadata?.full_name||user.email,
      contact_id:form.contact_id||null, signer_name:form.signer_name, signer_email:form.signer_email,
      signer_phone:form.signer_phone, sign_token:token, message:form.message, language:form.language,
      expires_at:form.expires_at?new Date(form.expires_at).toISOString():null, metadata:{},
      template_id: form.template_id || null,
      form_data: formHtml ? { html: formHtml } : null
    };
    const res = await sb("vault_envelopes","POST",env);
    if(!res?.[0]){ showToast("Error creating envelope"); setSaving(false); return; }
    const envId = res[0].id;
    // Insert fields
    if(form.fields.length>0){
      const fieldRows = form.fields.map((f,i)=>({envelope_id:envId,type:f.type,label:f.label,required:f.required,sort_order:i,page:1,x_percent:10,y_percent:20+i*10,width_percent:30,height_percent:5}));
      await sb("vault_envelope_fields","POST",fieldRows);
    }
    // Audit
    await sb("vault_envelope_audit","POST",{envelope_id:envId,action:"created",actor:user.email,details:"Envelope created"});
    if(!asDraft){
      await sb("vault_envelope_audit","POST",{envelope_id:envId,action:"sent",actor:user.email,details:"Envelope sent to "+form.signer_email});
      const signUrl = `https://ziarem.com/sign.html?token=${token}`;
      try{ await navigator.clipboard.writeText(signUrl); }catch(e){}
      showToast(L.envelopeCreated+": "+signUrl);
    } else {
      showToast(lang==="es"?"Borrador guardado":"Draft saved");
    }
    setForm({...emptyForm});
    setShowNew(false);
    setSaving(false);
    loadEnvelopes();
  };

  const copyLink = (env) => {
    const url = `https://ziarem.com/sign.html?token=${env.sign_token}`;
    try{ navigator.clipboard.writeText(url); }catch(e){}
    showToast(L.signLink);
  };

  const sendReminder = async (env) => {
    await sb("vault_envelopes","PATCH",{reminder_count:(env.reminder_count||0)+1,last_reminder_at:new Date().toISOString()},`?id=eq.${env.id}`);
    await sb("vault_envelope_audit","POST",{envelope_id:env.id,action:"reminder_sent",actor:user.email,details:`Reminder #${(env.reminder_count||0)+1} sent`});
    setEnvelopes(p=>p.map(e=>e.id===env.id?{...e,reminder_count:(e.reminder_count||0)+1,last_reminder_at:new Date().toISOString()}:e));
    showToast(L.reminderSent);
  };

  const deleteEnvelope = async (id) => {
    if(!confirm(L.confirmDelete)) return;
    await sb("vault_envelope_fields","DELETE",null,`?envelope_id=eq.${id}`);
    await sb("vault_envelope_audit","DELETE",null,`?envelope_id=eq.${id}`);
    await sb("vault_envelopes","DELETE",null,`?id=eq.${id}`);
    setEnvelopes(p=>p.filter(e=>e.id!==id));
  };

  const viewAudit = async (envId) => {
    if(auditId===envId){ setAuditId(null); return; }
    const data = await sb("vault_envelope_audit","GET",null,`?envelope_id=eq.${envId}&order=created_at.asc`);
    setAuditData(data||[]);
    setAuditId(envId);
  };

  const saveAsTemplate = async (env) => {
    const fields = await sb("vault_envelope_fields","GET",null,`?envelope_id=eq.${env.id}&order=sort_order.asc`);
    await sb("vault_signature_templates","POST",{name:env.title+" Template",document_url:env.document_url,document_name:env.document_name,fields:fields||[],default_message:env.message,language:env.language,created_by:user.id});
    showToast(L.templateSaved);
  };

  const useTemplate = (tpl) => {
    setForm({...emptyForm,title:tpl.name,message:tpl.default_message||"",language:tpl.language||"es",document_name:tpl.document_name||"",fields:(tpl.fields||[]).map(f=>({type:f.type,label:f.label,required:f.required}))});
    setShowTemplates(false);
    setShowNew(true);
  };

  const contactSelect = (cid) => {
    const c = contacts.find(x=>x.id===cid);
    if(c){ sf("contact_id",cid); sf("signer_name",c.full_name||""); sf("signer_email",c.email||""); sf("signer_phone",c.phone||""); }
  };

  const selectTemplate = (t) => {
    setForm(p => ({
      ...p,
      title: t.name,
      message: t.default_message || "",
      template_id: t.id,
    }));
    try {
      const tf = typeof t.fields === 'string' ? JSON.parse(t.fields) : (t.fields || []);
      sf("fields", tf.map((f) => ({
        type: f.type || "signature",
        label: f.label || "",
        required: f.required !== false,
      })));
    } catch { }
    showToast(L.templateSelected || "Plantilla seleccionada");
  };

  const addField = () => sf("fields",[...form.fields,{type:"signature",label:"",required:true}]);
  const removeField = (i) => sf("fields",form.fields.filter((_,j)=>j!==i));
  const updateField = (i,k,v) => sf("fields",form.fields.map((f,j)=>j===i?{...f,[k]:v}:f));

  const fmtDate = (d) => d?new Date(d).toLocaleDateString(lang==="es"?"es-ES":"en-US",{month:"short",day:"numeric",year:"numeric"}):"—";

  const auditColor = a => ({created:"#3b82f6",sent:"#d4af37",viewed:"#f59e0b",signed:"#10b981",declined:"#ef4444",reminder_sent:"#8b5cf6"}[a]||"#555");

  const sendPack = async () => {
    if (!packContact || !selPack) return;
    setPackSending(true);
    const c = contacts.find(x => x.id === packContact);
    if (!c) { setPackSending(false); return; }
    const tpls = sysTemplates.filter(t => (selPack.template_ids || []).includes(t.id));
    // Pre-fetch affiliated businesses for ABA templates
    let bizHtml = "", namesList = "";
    const hasABA = tpls.some(t => (t.form_html||"").includes("{{affiliated_businesses}}"));
    if (hasABA) {
      const bizList = await sb("vault_affiliated_businesses","GET",null,"?is_active=eq.true&order=sort_order");
      if (bizList?.length) {
        bizHtml = bizList.map((b,i) => `<h3>${i+1}. ${b.entity_name}</h3><ul><li><b>Business Type:</b> ${b.license_info||b.business_type}</li><li><b>Location:</b> ${b.location}</li><li><b>Owner's Name:</b> ${b.owner_name}</li><li><b>Ownership %:</b> ${b.ownership_pct}</li><li><b>Fee Structure:</b> ${b.fee_structure}</li>${b.extra_info?`<li><b>${b.extra_info}</b></li>`:""}</ul>`).join("");
        namesList = bizList.map(b=>b.entity_name).join(", ");
      }
    }
    const links = [];
    for (const tpl of tpls) {
      let formHtml = tpl.form_html || "";
      if (bizHtml) {
        formHtml = formHtml.replace(/\{\{affiliated_businesses\}\}/g, bizHtml);
        formHtml = formHtml.replace(/\{\{affiliated_names_list\}\}/g, namesList);
      }
      formHtml = formHtml
        .replace(/\{\{contact\.name\}\}/g, c.full_name || "")
        .replace(/\{\{contact\.email\}\}/g, c.email || "")
        .replace(/\{\{contact\.phone\}\}/g, c.phone || "")
        .replace(/\{\{contact\.company\}\}/g, c.company || "")
        .replace(/\{\{date\.today\}\}/g, new Date().toLocaleDateString('en-US', {year:'numeric',month:'long',day:'numeric'}))
        .replace(/\{\{agent\.name\}\}/g, "Kenneth Wolf")
        .replace(/\{\{property\.address\}\}/g, "[To Be Determined]");
      let fields = [];
      try { fields = typeof tpl.fields === 'string' ? JSON.parse(tpl.fields) : (tpl.fields || []); } catch {}
      const envData = {
        title: tpl.name, status: "sent", sender_id: user.id,
        sender_name: user.user_metadata?.full_name||user.email,
        contact_id: c.id, signer_name: c.full_name,
        signer_email: c.email || null, signer_phone: c.phone || null,
        sign_token: genToken(), message: tpl.default_message || "",
        language: selPack.language || "es", template_id: tpl.id,
        pack_id: selPack.id, form_data: formHtml ? { html: formHtml } : null, metadata: {}
      };
      const saved = await sb("vault_envelopes", "POST", envData);
      if (saved?.[0]) {
        const env = saved[0];
        for (let i = 0; i < fields.length; i++) {
          await sb("vault_envelope_fields", "POST", {
            envelope_id: env.id, type: fields[i].type || "signature",
            label: fields[i].label || "", required: fields[i].required !== false,
            sort_order: i, page:1, x_percent:10, y_percent:20+i*10, width_percent:30, height_percent:5
          });
        }
        await sb("vault_envelope_audit", "POST", { envelope_id: env.id, action: "created", actor: user.email, details: `Pack: ${selPack.name}` });
        await sb("vault_envelope_audit", "POST", { envelope_id: env.id, action: "sent", actor: user.email, details: `Sent to ${c.full_name}` });
        links.push(`https://ziarem.com/sign.html?token=${env.sign_token}`);
      }
    }
    const allLinks = links.join("\n");
    try { await navigator.clipboard.writeText(allLinks); } catch {}
    showToast(`${links.length} formularios enviados — enlaces copiados`);
    loadEnvelopes();
    setPackSending(false);
    setShowPacks(false);
    setSelPack(null);
    setPackContact("");
  };

  // ── RENDER ──
  const sLbl = {fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:4,fontWeight:600};
  const sInp = {width:"100%",background:"#0a0a12",border:"1px solid #1e1e28",borderRadius:4,padding:"7px 10px",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,outline:"none",boxSizing:"border-box"};

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>

      {/* NEW ENVELOPE MODAL */}
      {showNew && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowNew(false)}>
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:8,padding:24,width:580,maxHeight:"85vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:700,color:"#d4af37",letterSpacing:".15em",marginBottom:16}}>{L.newEnvelope}</div>
            {/* Template Selector */}
            <div style={{marginBottom:12}}>
              <div style={{fontSize:8,color:"#d4af37",letterSpacing:".1em",marginBottom:6}}>{L.selectTemplate||"SELECCIONAR PLANTILLA"}</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:8}}>
                {["all","real_estate","mortgage","hha","insurance","construction","general"].map(bt=>(
                  <button key={bt} onClick={()=>setTplFilter(bt)} style={{background:tplFilter===bt?"rgba(212,175,55,.1)":"#0a0a14",border:`1px solid ${tplFilter===bt?"rgba(212,175,55,.3)":"#1a1a28"}`,color:tplFilter===bt?"#d4af37":"#555",fontSize:8,padding:"3px 8px",borderRadius:2,cursor:"pointer",fontFamily:"inherit"}}>
                    {bt==="all"?"Todos":bt==="real_estate"?"Bienes Raices":bt==="mortgage"?"Hipoteca":bt==="hha"?"HHA":bt==="insurance"?"Seguros":bt==="construction"?"Construccion":"General"}
                  </button>
                ))}
              </div>
              <div style={{maxHeight:150,overflowY:"auto",border:"1px solid #1a1a28",borderRadius:4,background:"#0a0a14"}}>
                {sysTemplates.filter(t=>tplFilter==="all"||t.business_type===tplFilter).map(t=>(
                  <div key={t.id} onClick={()=>selectTemplate(t)} style={{padding:"6px 10px",borderBottom:"1px solid #0e0e18",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(212,175,55,.05)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <div>
                      <div style={{fontSize:10,color:"#e0dcd0"}}>{t.name}</div>
                      <div style={{fontSize:8,color:"#444"}}>{t.business_type} · {t.category}</div>
                    </div>
                    <button onClick={e=>{e.stopPropagation();setFormPreview(t);}} style={{background:"none",border:"1px solid #1e1e28",color:"#888",fontSize:7,padding:"2px 6px",borderRadius:2,cursor:"pointer",fontFamily:"inherit"}}>Vista previa</button>
                  </div>
                ))}
                {sysTemplates.filter(t=>tplFilter==="all"||t.business_type===tplFilter).length===0&&<div style={{padding:12,textAlign:"center",fontSize:9,color:"#333"}}>Sin plantillas del sistema</div>}
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:10}}>
              <div><div style={sLbl}>{L.title2}</div><input value={form.title} onChange={e=>sf("title",e.target.value)} style={sInp} /></div>
              <div><div style={sLbl}>{L.selectContact}</div>
                <select value={form.contact_id} onChange={e=>contactSelect(e.target.value)} style={{...sInp,cursor:"pointer"}}>
                  <option value="">{L.selectContact}</option>
                  {contacts.slice(0,200).map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
                </select>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:10}}>
              <div><div style={sLbl}>{L.signerName}</div><input value={form.signer_name} onChange={e=>sf("signer_name",e.target.value)} style={sInp} /></div>
              <div><div style={sLbl}>{L.signerEmail}</div><input value={form.signer_email} onChange={e=>sf("signer_email",e.target.value)} style={sInp} /></div>
              <div><div style={sLbl}>{L.signerPhone}</div><input value={form.signer_phone} onChange={e=>sf("signer_phone",e.target.value)} style={sInp} /></div>
            </div>
            <div style={{marginBottom:10}}><div style={sLbl}>{L.document}</div>
              <input type="file" accept=".pdf,.doc,.docx,.png,.jpg" onChange={e=>{if(e.target.files[0]){sf("document",e.target.files[0]);sf("document_name",e.target.files[0].name);}}} style={{...sInp,padding:5}} />
              {form.document_name&&<div style={{fontSize:8,color:"#888",marginTop:3}}>{form.document_name}</div>}
            </div>
            <div style={{marginBottom:10}}><div style={sLbl}>{L.message}</div><textarea value={form.message} onChange={e=>sf("message",e.target.value)} placeholder={L.messagePlaceholder} rows={3} style={{...sInp,resize:"vertical"}} /></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
              <div><div style={sLbl}>{L.language}</div>
                <select value={form.language} onChange={e=>sf("language",e.target.value)} style={{...sInp,cursor:"pointer"}}><option value="es">Español</option><option value="en">English</option></select>
              </div>
              <div><div style={sLbl}>{L.expiration}</div><input type="date" value={form.expires_at} onChange={e=>sf("expires_at",e.target.value)} style={sInp} /></div>
            </div>
            {/* FIELDS */}
            <div style={{marginBottom:14}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={sLbl}>{lang==="es"?"CAMPOS DE FIRMA":"SIGNATURE FIELDS"}</div>
                <button onClick={addField} style={{background:"none",border:"1px dashed #1e1e28",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"3px 10px",borderRadius:3}}>{L.addField}</button>
              </div>
              {form.fields.map((f,i)=>(
                <div key={i} style={{display:"grid",gridTemplateColumns:"2fr 3fr auto auto",gap:8,marginBottom:6,alignItems:"center"}}>
                  <select value={f.type} onChange={e=>updateField(i,"type",e.target.value)} style={{...sInp,cursor:"pointer",fontSize:9}}>
                    <option value="signature">{L.signature}</option><option value="initials">{L.initials}</option><option value="date">{L.date}</option><option value="text">{L.text}</option><option value="checkbox">{L.checkbox}</option>
                  </select>
                  <input value={f.label} onChange={e=>updateField(i,"label",e.target.value)} placeholder={L.fieldLabel} style={{...sInp,fontSize:9}} />
                  <label style={{fontSize:8,color:"#888",display:"flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                    <input type="checkbox" checked={f.required} onChange={e=>updateField(i,"required",e.target.checked)} />{L.required}
                  </label>
                  <button onClick={()=>removeField(i)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12}}>✕</button>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowNew(false)} style={{background:"none",border:"1px solid #1e1e28",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"7px 16px",borderRadius:4}}>{L.cancel}</button>
              <button onClick={()=>handleCreate(true)} disabled={saving} style={{background:"none",border:"1px solid #1e1e28",color:"#e0dcd0",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"7px 16px",borderRadius:4}}>{saving?L.saving:L.saveDraft}</button>
              <button onClick={()=>handleCreate(false)} disabled={saving||!form.title.trim()} style={{background:"#d4af37",border:"none",color:"#0a0a12",cursor:"pointer",fontFamily:"inherit",fontSize:9,fontWeight:700,padding:"7px 20px",borderRadius:4,letterSpacing:".05em"}}>{saving?L.saving:L.createSend}</button>
            </div>
          </div>
        </div>
      )}

      {/* TEMPLATES MODAL */}
      {showTemplates && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setShowTemplates(false)}>
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:8,padding:24,width:500,maxHeight:"70vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:14,fontWeight:700,color:"#d4af37",letterSpacing:".15em",marginBottom:16}}>{L.templates}</div>
            {templates.length===0&&<div style={{textAlign:"center",padding:30,color:"#333",fontSize:10}}>{L.noTemplates}</div>}
            {templates.map(t=>(
              <div key={t.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:"#0a0a12",border:"1px solid #1e1e28",borderRadius:5,marginBottom:6}}>
                <div>
                  <div style={{fontSize:10,fontWeight:600,color:"#e0dcd0"}}>{t.name}</div>
                  <div style={{fontSize:8,color:"#555"}}>{t.document_name||"—"} · {(t.fields||[]).length} fields</div>
                </div>
                <button onClick={()=>useTemplate(t)} style={{background:"#d4af37",border:"none",color:"#0a0a12",cursor:"pointer",fontFamily:"inherit",fontSize:8,fontWeight:700,padding:"4px 12px",borderRadius:3}}>{L.useTemplate}</button>
              </div>
            ))}
            <div style={{textAlign:"right",marginTop:12}}>
              <button onClick={()=>setShowTemplates(false)} style={{background:"none",border:"1px solid #1e1e28",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"6px 16px",borderRadius:4}}>{L.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {/* SIGNATURE PREVIEW MODAL */}
      {sigView && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.7)",zIndex:9999,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={()=>setSigView(null)}>
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:8,padding:24,width:480}} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:13,fontWeight:700,color:"#d4af37",letterSpacing:".15em",marginBottom:14}}>{L.signaturePreview}</div>
            {sigView.signature_data ? (
              <div style={{background:"#fff",borderRadius:6,padding:16,textAlign:"center",marginBottom:14}}>
                <img src={sigView.signature_data} alt="Signature" style={{maxWidth:"100%",maxHeight:200}} />
              </div>
            ) : <div style={{textAlign:"center",padding:30,color:"#333",fontSize:10}}>No signature data</div>}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,fontSize:9,color:"#888",marginBottom:14}}>
              <div><span style={{color:"#555"}}>{L.signerName}:</span> <span style={{color:"#e0dcd0"}}>{sigView.signer_name}</span></div>
              <div><span style={{color:"#555"}}>{L.signerEmail}:</span> <span style={{color:"#e0dcd0"}}>{sigView.signer_email}</span></div>
              <div><span style={{color:"#555"}}>IP:</span> <span style={{color:"#e0dcd0"}}>{sigView.signer_ip||"—"}</span></div>
              <div><span style={{color:"#555"}}>User Agent:</span> <span style={{color:"#e0dcd0",wordBreak:"break-all"}}>{sigView.signer_user_agent||"—"}</span></div>
              <div><span style={{color:"#555"}}>{lang==="es"?"Firmado":"Signed"}:</span> <span style={{color:"#e0dcd0"}}>{fmtDate(sigView.signed_at)}</span></div>
            </div>
            {sigView.signed_document_url && (
              <a href={sigView.signed_document_url} target="_blank" rel="noreferrer" style={{display:"inline-block",background:"#d4af37",color:"#0a0a12",fontFamily:"inherit",fontSize:9,fontWeight:700,padding:"6px 16px",borderRadius:4,textDecoration:"none",marginBottom:10}}>Download</a>
            )}
            <div style={{textAlign:"right"}}><button onClick={()=>setSigView(null)} style={{background:"none",border:"1px solid #1e1e28",color:"#888",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"6px 16px",borderRadius:4}}>{L.cancel}</button></div>
          </div>
        </div>
      )}

      {/* FORM PACKS MODAL */}
      {showPacks && (
        <Modal onClose={()=>{setShowPacks(false);setSelPack(null);}} title={L.formPacks||"PAQUETES DE FORMULARIOS"} width="600px">
          {!selPack ? (
            <div>
              {formPacks.map(p => {
                const tpls = sysTemplates.filter(t => (p.template_ids||[]).includes(t.id));
                const typeLabels = {real_estate:"Bienes Raices",mortgage:"Hipoteca",hha:"HHA",insurance:"Seguros",construction:"Construccion",general:"General"};
                return (
                  <div key={p.id} onClick={()=>setSelPack(p)} style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"12px 14px",marginBottom:8,cursor:"pointer"}} onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(212,175,55,.2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1a1a28"}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                      <div>
                        <div style={{fontSize:11,color:"#e0dcd0"}}>{p.name}</div>
                        <div style={{fontSize:9,color:"#555",marginTop:2}}>{p.description}</div>
                      </div>
                      <span style={{fontSize:8,color:"#d4af37",background:"rgba(212,175,55,.1)",padding:"2px 8px",borderRadius:8}}>{typeLabels[p.business_type]||p.business_type}</span>
                    </div>
                    <div style={{display:"flex",gap:4,marginTop:6,flexWrap:"wrap"}}>
                      {tpls.map(t=><span key={t.id} style={{fontSize:7,color:"#888",background:"#0d0d18",border:"1px solid #1e1e28",padding:"1px 6px",borderRadius:2}}>{t.name}</span>)}
                    </div>
                  </div>
                );
              })}
              {formPacks.length===0&&<div style={{textAlign:"center",padding:30,color:"#333",fontSize:10}}>Sin paquetes disponibles</div>}
            </div>
          ) : (
            <div>
              <button onClick={()=>setSelPack(null)} style={{background:"none",border:"none",color:"#d4af37",cursor:"pointer",fontSize:9,marginBottom:10,fontFamily:"inherit"}}>&#8592; Volver a paquetes</button>
              <div style={{fontSize:14,color:"#e0dcd0",marginBottom:4}}>{selPack.name}</div>
              <div style={{fontSize:9,color:"#555",marginBottom:12}}>{selPack.description}</div>
              <Fld label="CONTACTO / FIRMANTE">
                <select value={packContact} onChange={e=>setPackContact(e.target.value)} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}}>
                  <option value="">Seleccionar contacto...</option>
                  {contacts.map(c=><option key={c.id} value={c.id}>{c.full_name} {c.email?`(${c.email})`:""}</option>)}
                </select>
              </Fld>
              <div style={{fontSize:8,color:"#555",letterSpacing:".1em",margin:"10px 0 6px"}}>FORMULARIOS EN ESTE PAQUETE ({(selPack.template_ids||[]).length})</div>
              {sysTemplates.filter(t=>(selPack.template_ids||[]).includes(t.id)).map(t=>(
                <div key={t.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"8px 12px",marginBottom:4,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div>
                    <div style={{fontSize:10,color:"#e0dcd0"}}>{t.name}</div>
                    <div style={{fontSize:8,color:"#444"}}>{t.category}</div>
                  </div>
                  <button onClick={()=>setFormPreview(t)} style={{background:"none",border:"1px solid #1e1e28",color:"#888",fontSize:7,padding:"2px 6px",borderRadius:2,cursor:"pointer",fontFamily:"inherit"}}>Vista previa</button>
                </div>
              ))}
              <button onClick={()=>sendPack()} disabled={packSending||!packContact} style={{width:"100%",marginTop:12,padding:"10px 0",background:packSending||!packContact?"#333":"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:packSending||!packContact?"#888":"#000",borderRadius:4,cursor:packSending?"wait":"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,letterSpacing:".1em"}}>
                {packSending?"ENVIANDO...":"ENVIAR PAQUETE COMPLETO"}
              </button>
            </div>
          )}
        </Modal>
      )}

      {/* FORM PREVIEW MODAL */}
      {formPreview && (
        <Modal onClose={()=>setFormPreview(null)} title={formPreview.name} width="650px">
          <div style={{background:"#fff",color:"#000",padding:"24px 28px",borderRadius:6,fontSize:13,lineHeight:1.7,maxHeight:500,overflowY:"auto"}} dangerouslySetInnerHTML={{__html: formPreview.form_html || "<p>No preview available</p>"}} />
          <div style={{display:"flex",gap:8,marginTop:10}}>
            <Btn onClick={()=>{selectTemplate(formPreview);setFormPreview(null);setShowNew(true);}} variant="gold">Usar esta plantilla</Btn>
            <Btn onClick={()=>setFormPreview(null)}>Cerrar</Btn>
          </div>
        </Modal>
      )}

      {/* TOP BAR */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>{L.title}</div>
          <div style={{fontSize:9,color:"#444"}}>{L.sub}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          <button onClick={()=>setLang(l=>l==="es"?"en":"es")} style={{background:"none",border:"1px solid #1e1e28",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"5px 10px",borderRadius:4}}>{lang==="es"?"EN":"ES"}</button>
          <button onClick={()=>{loadTemplates();setShowTemplates(true);}} style={{background:"none",border:"1px solid #1e1e28",color:"#e0dcd0",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"5px 12px",borderRadius:4}}>{L.templates}</button>
          <button onClick={()=>setShowPacks(true)} style={{background:"none",border:"1px solid #1e1e28",color:"#e0dcd0",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"5px 12px",borderRadius:4}}>{"PAQUETES"}</button>
          <button onClick={()=>setShowNew(true)} style={{background:"#d4af37",border:"none",color:"#0a0a12",cursor:"pointer",fontFamily:"inherit",fontSize:9,fontWeight:700,padding:"6px 14px",borderRadius:4,letterSpacing:".05em"}}>{L.newEnvelope}</button>
        </div>
      </div>

      {/* STATS */}
      <div style={{display:"flex",gap:12,marginBottom:16}}>
        {[{l:L.sent,v:stats.sent,c:"#3b82f6"},{l:L.signed,v:stats.signed,c:"#10b981"},{l:L.pending,v:stats.pending,c:"#f59e0b"},{l:L.declined,v:stats.declined,c:"#ef4444"}].map(s=>(
          <div key={s.l} style={{flex:1,background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"12px 14px",textAlign:"center"}}>
            <div style={{fontSize:20,fontWeight:700,color:s.c}}>{s.v}</div>
            <div style={{fontSize:8,color:"#555",letterSpacing:".1em",marginTop:2}}>{s.l.toUpperCase()}</div>
          </div>
        ))}
      </div>

      {/* TABS */}
      <div style={{display:"flex",gap:4,marginBottom:16,borderBottom:"1px solid #1e1e28",paddingBottom:8}}>
        {TABS.map(t=>(
          <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"rgba(212,175,55,.1)":"none",border:`1px solid ${tab===t.id?"rgba(212,175,55,.35)":"transparent"}`,color:tab===t.id?"#d4af37":"#555",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"5px 12px",borderRadius:3,letterSpacing:".05em"}}>{t.l}</button>
        ))}
      </div>

      {/* ENVELOPE LIST */}
      {loading ? (
        <div style={{textAlign:"center",padding:50,color:"#333",fontSize:10}}>{L.saving}</div>
      ) : filtered.length===0 ? (
        <div style={{textAlign:"center",padding:50,color:"#1e1e2e",fontSize:10}}>{L.noEnvelopes}</div>
      ) : (
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtered.map(env=>(
            <div key={env.id}>
              <div onClick={()=>setExpandedId(expandedId===env.id?null:env.id)} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"12px 14px",cursor:"pointer",transition:"border-color .15s"}}
                onMouseEnter={e=>e.currentTarget.style.borderColor="rgba(212,175,55,.2)"} onMouseLeave={e=>e.currentTarget.style.borderColor="#1e1e28"}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flex:1}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:"rgba(212,175,55,.08)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>✍</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:"#e0dcd0"}}>{env.title||"Untitled"}</div>
                      <div style={{fontSize:8,color:"#555"}}>{L.to}: {env.signer_name||"—"} · {env.signer_email||""}</div>
                    </div>
                    <span style={{fontSize:8,fontWeight:600,color:"#fff",background:ESIGN_STATUS[env.status]||"#555",padding:"2px 8px",borderRadius:10,letterSpacing:".05em",textTransform:"uppercase"}}>{env.status}</span>
                    <div style={{fontSize:8,color:"#444",minWidth:80,textAlign:"right"}}>{fmtDate(env.created_at)}</div>
                  </div>
                </div>
              </div>

              {/* EXPANDED DETAIL */}
              {expandedId===env.id && (
                <div style={{background:"#0a0a12",border:"1px solid #1e1e28",borderTop:"none",borderRadius:"0 0 6px 6px",padding:"12px 16px"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,fontSize:9,color:"#888",marginBottom:12}}>
                    <div>{L.from}: <span style={{color:"#e0dcd0"}}>{env.sender_name}</span></div>
                    <div>{L.signerEmail}: <span style={{color:"#e0dcd0"}}>{env.signer_email||"—"}</span></div>
                    <div>{L.signerPhone}: <span style={{color:"#e0dcd0"}}>{env.signer_phone||"—"}</span></div>
                    <div>{L.sent}: <span style={{color:"#e0dcd0"}}>{fmtDate(env.created_at)}</span></div>
                    <div>{L.signed}: <span style={{color:"#e0dcd0"}}>{fmtDate(env.signed_at)}</span></div>
                    <div>{L.expiration}: <span style={{color:"#e0dcd0"}}>{fmtDate(env.expires_at)}</span></div>
                  </div>
                  {env.message && <div style={{fontSize:9,color:"#555",fontStyle:"italic",marginBottom:10,padding:"6px 10px",background:"rgba(255,255,255,.02)",borderRadius:4}}>"{env.message}"</div>}
                  {env.document_name && <div style={{fontSize:8,color:"#888",marginBottom:10}}>📄 {env.document_name} {env.document_url&&<a href={env.document_url} target="_blank" rel="noreferrer" style={{color:"#3b82f6",marginLeft:6}}>View</a>}</div>}
                  <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                    <button onClick={e=>{e.stopPropagation();copyLink(env);}} style={{background:"none",border:"1px solid #1e1e28",color:"#e0dcd0",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.copyLink}</button>
                    {(env.status==="sent"||env.status==="viewed")&&<button onClick={e=>{e.stopPropagation();sendReminder(env);}} style={{background:"none",border:"1px solid #1e1e28",color:"#f59e0b",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.sendReminder}{env.reminder_count?` (${env.reminder_count})`:""}</button>}
                    {env.signature_data&&<button onClick={e=>{e.stopPropagation();setSigView(env);}} style={{background:"none",border:"1px solid #1e1e28",color:"#10b981",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.viewSig}</button>}
                    <button onClick={e=>{e.stopPropagation();viewAudit(env.id);}} style={{background:"none",border:"1px solid #1e1e28",color:"#8b5cf6",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.viewAudit}</button>
                    <button onClick={e=>{e.stopPropagation();saveAsTemplate(env);}} style={{background:"none",border:"1px solid #1e1e28",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.saveTemplate}</button>
                    <button onClick={e=>{e.stopPropagation();deleteEnvelope(env.id);}} style={{background:"none",border:"1px solid #1e1e28",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3}}>{L.delete}</button>
                  </div>

                  {/* AUDIT TRAIL */}
                  {auditId===env.id && (
                    <div style={{marginTop:12,borderTop:"1px solid #1e1e28",paddingTop:10}}>
                      <div style={{fontSize:9,fontWeight:600,color:"#d4af37",letterSpacing:".1em",marginBottom:8}}>{L.auditTrail}</div>
                      {auditData.length===0 ? <div style={{fontSize:9,color:"#333"}}>No audit entries</div> : (
                        <div style={{display:"flex",flexDirection:"column",gap:4}}>
                          {auditData.map(a=>(
                            <div key={a.id} style={{display:"flex",alignItems:"flex-start",gap:10,fontSize:9,padding:"6px 8px",background:"rgba(255,255,255,.01)",borderRadius:4,borderLeft:`3px solid ${auditColor(a.action)}`}}>
                              <div style={{color:auditColor(a.action),fontWeight:600,minWidth:70,textTransform:"uppercase"}}>{a.action}</div>
                              <div style={{flex:1,color:"#888"}}>{a.details||""}</div>
                              <div style={{color:"#444",minWidth:100,textAlign:"right",fontSize:8}}>{fmtDate(a.created_at)}</div>
                              {a.ip_address&&<div style={{color:"#333",fontSize:7}}>IP: {a.ip_address}</div>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── TOOLBOX VIEW ────────────────────────────────────────────────────────────
function ToolboxView({ showToast, contacts }) {
  const [activeTool, setActiveTool] = useState("weather");

  // Weather
  const [wxQuery, setWxQuery] = useState("");
  const [wxResults, setWxResults] = useState(null);
  const [wxGeo, setWxGeo] = useState([]);
  const [wxLoading, setWxLoading] = useState(false);

  // Currency
  const [curBase, setCurBase] = useState("USD");
  const [curAmt, setCurAmt] = useState(1);
  const [curRates, setCurRates] = useState(null);
  const [curLoading, setCurLoading] = useState(false);
  const [curTargets, setCurTargets] = useState(["EUR","GBP","CAD","MXN","BRL","JPY","AUD","CHF"]);

  // QR
  const [qrText, setQrText] = useState("");
  const [qrSize, setQrSize] = useState(300);
  const [qrContact, setQrContact] = useState("");

  // URL Shortener
  const [urlInput, setUrlInput] = useState("");
  const [urlResult, setUrlResult] = useState("");
  const [urlHistory, setUrlHistory] = useState([]);
  const [urlLoading, setUrlLoading] = useState(false);

  // Mortgage
  const [mtgPrice, setMtgPrice] = useState(350000);
  const [mtgDown, setMtgDown] = useState(20);
  const [mtgDownType, setMtgDownType] = useState("%");
  const [mtgRate, setMtgRate] = useState(6.5);
  const [mtgTerm, setMtgTerm] = useState(30);
  const [mtgTax, setMtgTax] = useState(3600);
  const [mtgIns, setMtgIns] = useState(1200);
  const [mtgShowAmort, setMtgShowAmort] = useState(false);

  // Timezone
  const [tzTime, setTzTime] = useState(new Date());
  const [tzFrom, setTzFrom] = useState("America/New_York");
  const [tzTo, setTzTo] = useState("Europe/London");
  const [tzInput, setTzInput] = useState("");
  useEffect(()=>{const t=setInterval(()=>setTzTime(new Date()),1000);return()=>clearInterval(t);},[]);

  // Crypto
  const [cryptoData, setCryptoData] = useState(null);
  const [cryptoLoading, setCryptoLoading] = useState(false);

  // Holidays
  const [holYear, setHolYear] = useState(new Date().getFullYear());
  const [holCountry, setHolCountry] = useState("US");
  const [holData, setHolData] = useState([]);
  const [holLoading, setHolLoading] = useState(false);

  // Exchange Rates table
  const [ratesData, setRatesData] = useState(null);
  const [ratesFilter, setRatesFilter] = useState("");
  const [ratesLoading, setRatesLoading] = useState(false);

  // Wiki
  const [wikiQuery, setWikiQuery] = useState("");
  const [wikiResult, setWikiResult] = useState(null);
  const [wikiLoading, setWikiLoading] = useState(false);

  // ZIP
  const [zipInput, setZipInput] = useState("");
  const [zipData, setZipData] = useState(null);
  const [zipLoading, setZipLoading] = useState(false);

  // Country
  const [countryQuery, setCountryQuery] = useState("");
  const [countryData, setCountryData] = useState(null);
  const [countryLoading, setCountryLoading] = useState(false);

  // Books
  const [bookQuery, setBookQuery] = useState("");
  const [bookResults, setBookResults] = useState(null);
  const [bookLoading, setBookLoading] = useState(false);

  // Translate
  const [trSrc, setTrSrc] = useState("");
  const [trFrom, setTrFrom] = useState("English");
  const [trTo, setTrTo] = useState("Spanish");
  const [trResult, setTrResult] = useState("");
  const [trLoading, setTrLoading] = useState(false);

  // AI Writer
  const [aiTemplate, setAiTemplate] = useState("Blog Post");
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiTone, setAiTone] = useState("Professional");
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);

  // Email Gen
  const [emType, setEmType] = useState("Follow-up");
  const [emRecipient, setEmRecipient] = useState("");
  const [emContext, setEmContext] = useState("");
  const [emLang, setEmLang] = useState("EN");
  const [emResult, setEmResult] = useState("");
  const [emLoading, setEmLoading] = useState(false);

  // Summarize
  const [sumText, setSumText] = useState("");
  const [sumResult, setSumResult] = useState("");
  const [sumLoading, setSumLoading] = useState(false);

  // Quote
  const [quoteData, setQuoteData] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  // Dog
  const [dogUrl, setDogUrl] = useState("");
  const [dogGallery, setDogGallery] = useState([]);
  const [dogLoading, setDogLoading] = useState(false);

  // Number Fact
  const [numInput, setNumInput] = useState(42);
  const [numFact, setNumFact] = useState("");
  const [numLoading, setNumLoading] = useState(false);

  // Activity
  const [actData, setActData] = useState(null);
  const [actLoading, setActLoading] = useState(false);

  // Photos
  const [photoList, setPhotoList] = useState([]);
  const [photoId, setPhotoId] = useState("");
  const [photoFull, setPhotoFull] = useState(null);

  const TOOLS = [
    { cat: "UTILITIES", items: [
      { id: "weather", icon: "\u{1f324}", label: "Weather" },
      { id: "currency", icon: "\u{1f4b1}", label: "Currency" },
      { id: "qrcode", icon: "\u{1f4f2}", label: "QR Generator" },
      { id: "urlshort", icon: "\u{1f517}", label: "URL Shortener" },
      { id: "mortgage", icon: "\u{1f3e0}", label: "Mortgage Calc" },
      { id: "timezone", icon: "\u{1f550}", label: "Time Zones" },
    ]},
    { cat: "MARKET DATA", items: [
      { id: "crypto", icon: "\u20bf", label: "Crypto" },
      { id: "holidays", icon: "\u{1f4c5}", label: "Holidays" },
      { id: "rates", icon: "\u{1f4c8}", label: "Exchange Rates" },
    ]},
    { cat: "RESEARCH", items: [
      { id: "wiki", icon: "\u{1f4d6}", label: "Wikipedia" },
      { id: "zip", icon: "\u{1f4cd}", label: "ZIP Lookup" },
      { id: "country", icon: "\u{1f310}", label: "Countries" },
      { id: "books", icon: "\u{1f4da}", label: "Books" },
    ]},
    { cat: "AI TOOLS", items: [
      { id: "translate", icon: "\u{1f30d}", label: "AI Translate" },
      { id: "writer", icon: "\u270d", label: "AI Writer" },
      { id: "emailgen", icon: "\u2709", label: "Email Generator" },
      { id: "summarize", icon: "\u{1f4c4}", label: "AI Summarizer" },
    ]},
    { cat: "FUN", items: [
      { id: "quote", icon: "\u{1f4ac}", label: "Daily Quote" },
      { id: "dog", icon: "\u{1f415}", label: "Dog Pics" },
      { id: "numfact", icon: "\u{1f522}", label: "Number Facts" },
      { id: "activity", icon: "\u{1f3b2}", label: "Random Activity" },
      { id: "photos", icon: "\u{1f4f7}", label: "Stock Photos" },
    ]},
  ];

  const wxCodeIcon = c => { if(c<=0) return "\u2600\ufe0f"; if(c<=3) return "\u26c5"; if(c<=48) return "\u{1f32b}\ufe0f"; if(c<=67) return "\u{1f327}\ufe0f"; if(c<=77) return "\u{1f328}\ufe0f"; if(c<=82) return "\u{1f326}\ufe0f"; return "\u26c8\ufe0f"; };
  const copyText = t => { navigator.clipboard.writeText(t); showToast("Copied!"); };

  const tbCard = { background:"#0d0d18", border:"1px solid #1e1e28", borderRadius:8, padding:16, marginBottom:12 };
  const tbInput = { background:"#0e0e1a", border:"1px solid #1a1a28", borderRadius:6, padding:"8px 12px", color:"#e0dcd0", fontFamily:"inherit", fontSize:12, width:"100%", outline:"none" };
  const tbBtn = { background:"#d4af37", color:"#000", border:"none", borderRadius:6, padding:"8px 16px", cursor:"pointer", fontFamily:"inherit", fontSize:12, fontWeight:600 };
  const tbBtnSec = { ...tbBtn, background:"transparent", border:"1px solid #d4af37", color:"#d4af37" };
  const tbLabel = { fontSize:10, color:"#888", textTransform:"uppercase", letterSpacing:1, marginBottom:4, display:"block" };
  const tbGrid = { display:"grid", gap:12 };

  // ── Weather search
  const doWeatherSearch = async () => {
    if(!wxQuery.trim()) return;
    setWxLoading(true);
    const geo = await geocodeCity(wxQuery);
    setWxGeo(geo);
    if(geo?.length) {
      const w = await fetchWeather(geo[0].lat, geo[0].lon);
      setWxResults(w);
    }
    setWxLoading(false);
  };

  // ── Currency convert
  const doCurrencyFetch = async () => {
    setCurLoading(true);
    const d = await fetchExchangeRates(curBase);
    setCurRates(d);
    setCurLoading(false);
  };

  // ── URL shorten
  const doShorten = async () => {
    if(!urlInput.trim()) return;
    setUrlLoading(true);
    const res = await shortenUrl(urlInput);
    if(res) { setUrlResult(res); setUrlHistory(h=>[{original:urlInput,short:res},...h].slice(0,10)); }
    else showToast("Could not shorten URL");
    setUrlLoading(false);
  };

  // ── Mortgage calc
  const calcMortgage = () => {
    const downAmt = mtgDownType==="%" ? mtgPrice*(mtgDown/100) : mtgDown;
    const loan = mtgPrice - downAmt;
    const monthlyRate = (mtgRate/100)/12;
    const n = mtgTerm*12;
    const pi = monthlyRate>0 ? loan*(monthlyRate*Math.pow(1+monthlyRate,n))/(Math.pow(1+monthlyRate,n)-1) : loan/n;
    const tax = mtgTax/12;
    const ins = mtgIns/12;
    const pmi = (downAmt/mtgPrice)<0.2 ? loan*0.005/12 : 0;
    const total = pi+tax+ins+pmi;
    const totalLife = total*n;
    const totalInterest = (pi*n)-loan;
    // Amortization
    const schedule = [];
    let bal = loan;
    for(let i=1;i<=n;i++){
      const intPmt = bal*monthlyRate;
      const prinPmt = pi-intPmt;
      bal -= prinPmt;
      if(i<=12||i%12===0||i===n) schedule.push({month:i,principal:prinPmt,interest:intPmt,balance:Math.max(0,bal)});
    }
    return { pi, tax, ins, pmi, total, totalLife, totalInterest, loan, downAmt, schedule };
  };
  const mtg = calcMortgage();
  const fmt$ = n => "$"+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});

  // ── Crypto
  const doCryptoFetch = async () => {
    setCryptoLoading(true);
    const d = await fetchCryptoPrices(["bitcoin","ethereum","solana","dogecoin","cardano"]);
    setCryptoData(d);
    setCryptoLoading(false);
  };

  // ── Holidays
  const doHolidayFetch = async () => {
    setHolLoading(true);
    const d = await fetchHolidays(holYear, holCountry);
    setHolData(Array.isArray(d)?d:[]);
    setHolLoading(false);
  };

  // ── Rates
  const doRatesFetch = async () => {
    setRatesLoading(true);
    const d = await fetchExchangeRates("USD");
    setRatesData(d);
    setRatesLoading(false);
  };

  // ── Wiki
  const doWikiSearch = async () => {
    if(!wikiQuery.trim()) return;
    setWikiLoading(true);
    const d = await fetchWikiSummary(wikiQuery);
    setWikiResult(d);
    setWikiLoading(false);
  };

  // ── ZIP
  const doZipLookup = async () => {
    if(!zipInput.trim()) return;
    setZipLoading(true);
    const d = await fetchZipDemographics(zipInput);
    setZipData(d);
    setZipLoading(false);
  };

  // ── Country
  const doCountrySearch = async () => {
    if(!countryQuery.trim()) return;
    setCountryLoading(true);
    const d = await fetchCountryData(countryQuery);
    setCountryData(Array.isArray(d)?d[0]:null);
    setCountryLoading(false);
  };

  // ── Books
  const doBookSearch = async () => {
    if(!bookQuery.trim()) return;
    setBookLoading(true);
    const d = await searchBooks(bookQuery);
    setBookResults(d);
    setBookLoading(false);
  };

  // ── Translate
  const doTranslate = async () => {
    if(!trSrc.trim()) return;
    setTrLoading(true);
    const res = await claude(`You are a professional translator. Translate the following text from ${trFrom} to ${trTo}. Return ONLY the translated text, nothing else.`, trSrc, 1200);
    setTrResult(res);
    setTrLoading(false);
  };

  // ── AI Writer
  const doAiWrite = async () => {
    if(!aiPrompt.trim()) return;
    setAiLoading(true);
    const sys = `You are a professional content writer. Write a ${aiTemplate} with a ${aiTone} tone. Be concise, engaging, and actionable. Return only the content.`;
    const res = await claude(sys, aiPrompt, 1500);
    setAiResult(res);
    setAiLoading(false);
  };

  // ── Email Gen
  const doEmailGen = async () => {
    if(!emContext.trim()) return;
    setEmLoading(true);
    const lang = emLang==="ES"?"Respond entirely in Spanish.":"Respond in English.";
    const sys = `You are a professional email writer for a CRM/mortgage business. Write a ${emType} email to ${emRecipient||"the recipient"}. ${lang} Be professional but warm. Include subject line.`;
    const res = await claude(sys, emContext, 1200);
    setEmResult(res);
    setEmLoading(false);
  };

  // ── Summarize
  const doSummarize = async () => {
    if(!sumText.trim()) return;
    setSumLoading(true);
    const res = await claude("You are a text summarizer. Provide a concise bullet-point summary with key takeaways. Format with bullet points.", sumText, 1200);
    setSumResult(res);
    setSumLoading(false);
  };

  // ── Quote
  const doQuoteFetch = async () => {
    setQuoteLoading(true);
    let q = await fetchQuote();
    if(!q) {
      const res = await claude("Generate one inspirational quote. Format: \"quote\" - Author", "Give me an inspirational quote", 200);
      q = { quote: res, author: "" };
    }
    setQuoteData(q);
    setQuoteLoading(false);
  };

  // ── Dog
  const doDogFetch = async () => {
    setDogLoading(true);
    const d = await fetchDogPic();
    if(d?.message) { setDogUrl(d.message); setDogGallery(g=>[d.message,...g].slice(0,6)); }
    setDogLoading(false);
  };

  // ── Number Fact
  const doNumFact = async () => {
    setNumLoading(true);
    let d = await fetchNumberFact(numInput);
    if(!d?.text) {
      const res = await claude("Give me an interesting mathematical fact about this number. Be concise, 1-2 sentences.", `Number: ${numInput}`, 200);
      d = { text: res, number: numInput };
    }
    setNumFact(d?.text||"No fact found");
    setNumLoading(false);
  };

  // ── Activity
  const doActivityFetch = async () => {
    setActLoading(true);
    const d = await fetchRandomActivity();
    setActData(d);
    setActLoading(false);
  };

  // ── Photos
  const doPhotoRefresh = () => {
    const list = [];
    for(let i=0;i<6;i++) list.push(randomPhotoUrl(400,300));
    setPhotoList(list);
  };
  useEffect(()=>{ doPhotoRefresh(); },[]);

  // ─── TOOL PANELS ────────────────────────────────────────────
  const WeatherPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Weather Forecast</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="City name..." value={wxQuery} onChange={e=>setWxQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doWeatherSearch()} />
        <button style={tbBtn} onClick={doWeatherSearch} disabled={wxLoading}>{wxLoading?"...":"Search"}</button>
      </div>
      {wxResults?.current && (
        <div style={tbCard}>
          <div style={{fontSize:14,fontWeight:600,marginBottom:8,color:"#e0dcd0"}}>{wxGeo?.[0]?.display_name?.split(",").slice(0,2).join(",")}</div>
          <div style={{display:"flex",gap:24,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{fontSize:36}}>{wxCodeIcon(wxResults.current.weather_code)}</span>
            <div>
              <div style={{fontSize:28,fontWeight:700,color:"#d4af37"}}>{Math.round(wxResults.current.temperature_2m)}\u00b0F</div>
              <div style={{fontSize:11,color:"#888"}}>Humidity: {wxResults.current.relative_humidity_2m}% | Wind: {Math.round(wxResults.current.wind_speed_10m)} mph</div>
            </div>
          </div>
        </div>
      )}
      {wxResults?.daily && (
        <div style={{...tbGrid,gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))"}}>
          {wxResults.daily.time.map((d,i)=>(
            <div key={d} style={{...tbCard,textAlign:"center",padding:12}}>
              <div style={{fontSize:10,color:"#888"}}>{new Date(d+"T12:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}</div>
              <div style={{fontSize:24,margin:"4px 0"}}>{wxCodeIcon(wxResults.daily.weather_code[i])}</div>
              <div style={{fontSize:13,fontWeight:600}}>{Math.round(wxResults.daily.temperature_2m_max[i])}\u00b0</div>
              <div style={{fontSize:11,color:"#888"}}>{Math.round(wxResults.daily.temperature_2m_min[i])}\u00b0</div>
              <div style={{fontSize:10,color:"#6366f1"}}>{wxResults.daily.precipitation_probability_max[i]}% rain</div>
            </div>
          ))}
        </div>
      )}
      {!wxResults && !wxLoading && <div style={{color:"#555",fontSize:12,textAlign:"center",padding:40}}>Enter a city name to get the weather forecast</div>}
    </div>
  );

  const CurrencyPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Currency Converter</h3>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
        <div style={{flex:"0 0 120px"}}>
          <label style={tbLabel}>Base</label>
          <select style={{...tbInput,cursor:"pointer"}} value={curBase} onChange={e=>setCurBase(e.target.value)}>
            {["USD","EUR","GBP","CAD","MXN","BRL","JPY","AUD","CHF","CNY","INR","KRW"].map(c=><option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{flex:"0 0 120px"}}>
          <label style={tbLabel}>Amount</label>
          <input style={tbInput} type="number" value={curAmt} onChange={e=>setCurAmt(Number(e.target.value))} />
        </div>
        <button style={tbBtn} onClick={doCurrencyFetch} disabled={curLoading}>{curLoading?"...":"Convert"}</button>
      </div>
      <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:12}}>
        {["EUR","GBP","CAD","MXN","BRL","JPY","AUD","CHF","CNY","INR","KRW","COP","ARS","PEN","CLP","DOP"].map(c=>(
          <button key={c} onClick={()=>setCurTargets(t=>t.includes(c)?t.filter(x=>x!==c):[...t,c])}
            style={{...tbBtnSec,padding:"4px 8px",fontSize:10,opacity:curTargets.includes(c)?1:0.4}}>{c}</button>
        ))}
      </div>
      {curRates?.rates && (
        <div style={{...tbGrid,gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))"}}>
          {curTargets.filter(c=>curRates.rates[c]).map(c=>(
            <div key={c} style={{...tbCard,padding:12}}>
              <div style={{fontSize:10,color:"#888"}}>{c}</div>
              <div style={{fontSize:18,fontWeight:700,color:"#d4af37"}}>{(curAmt*curRates.rates[c]).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
              <div style={{fontSize:10,color:"#555"}}>1 {curBase} = {curRates.rates[c].toFixed(4)} {c}</div>
            </div>
          ))}
        </div>
      )}
      {!curRates && !curLoading && <div style={{color:"#555",fontSize:12,textAlign:"center",padding:40}}>Click Convert to fetch live exchange rates</div>}
    </div>
  );

  const QRCodePanel = () => {
    const effectiveText = qrContact ? (() => {
      const c = contacts.find(x => x.id === qrContact);
      if (!c) return "";
      return `BEGIN:VCARD\nVERSION:3.0\nFN:${c.first_name||""} ${c.last_name||""}\nTEL:${c.phone||""}\nEMAIL:${c.email||""}\nORG:${c.company||""}\nEND:VCARD`;
    })() : qrText;
    return (
      <div>
        <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>QR Code Generator</h3>
        <div style={{...tbCard}}>
          <label style={tbLabel}>Text or URL</label>
          <input style={{...tbInput,marginBottom:12}} placeholder="Enter text, URL, or select a contact..." value={qrText} onChange={e=>{setQrText(e.target.value);setQrContact("");}} />
          <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap",alignItems:"flex-end"}}>
            <div style={{flex:1}}>
              <label style={tbLabel}>Contact vCard</label>
              <select style={{...tbInput,cursor:"pointer"}} value={qrContact} onChange={e=>{setQrContact(e.target.value);setQrText("");}}>
                <option value="">-- none --</option>
                {(contacts||[]).slice(0,50).map(c=><option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>)}
              </select>
            </div>
            <div style={{flex:"0 0 100px"}}>
              <label style={tbLabel}>Size</label>
              <select style={{...tbInput,cursor:"pointer"}} value={qrSize} onChange={e=>setQrSize(Number(e.target.value))}>
                {[200,300,400,500].map(s=><option key={s} value={s}>{s}px</option>)}
              </select>
            </div>
          </div>
        </div>
        {effectiveText && (
          <div style={{...tbCard,textAlign:"center"}}>
            <img src={qrCodeUrl(effectiveText,qrSize)} alt="QR" style={{maxWidth:"100%",borderRadius:8}} />
            <div style={{marginTop:12}}>
              <button style={tbBtnSec} onClick={()=>copyText(qrCodeUrl(effectiveText,qrSize))}>Copy Image URL</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const URLShortPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>URL Shortener</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="https://example.com/long-url..." value={urlInput} onChange={e=>setUrlInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doShorten()} />
        <button style={tbBtn} onClick={doShorten} disabled={urlLoading}>{urlLoading?"...":"Shorten"}</button>
      </div>
      {urlResult && (
        <div style={{...tbCard,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <a href={urlResult} target="_blank" rel="noreferrer" style={{color:"#d4af37",fontSize:14}}>{urlResult}</a>
          <button style={tbBtnSec} onClick={()=>copyText(urlResult)}>Copy</button>
        </div>
      )}
      {urlHistory.length>0 && (
        <div style={{marginTop:16}}>
          <div style={tbLabel}>History</div>
          {urlHistory.map((h,i)=>(
            <div key={i} style={{...tbCard,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:10,color:"#555",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{h.original}</div>
                <div style={{fontSize:12,color:"#d4af37"}}>{h.short}</div>
              </div>
              <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>copyText(h.short)}>Copy</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const MortgagePanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Mortgage Calculator</h3>
      <div style={{...tbCard}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <div>
            <label style={tbLabel}>Purchase Price</label>
            <input style={tbInput} type="number" value={mtgPrice} onChange={e=>setMtgPrice(Number(e.target.value))} />
          </div>
          <div>
            <label style={tbLabel}>Down Payment ({mtgDownType})</label>
            <div style={{display:"flex",gap:4}}>
              <input style={{...tbInput,flex:1}} type="number" value={mtgDown} onChange={e=>setMtgDown(Number(e.target.value))} />
              <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>setMtgDownType(t=>t==="%"?"$":"%")}>{mtgDownType}</button>
            </div>
          </div>
          <div>
            <label style={tbLabel}>Interest Rate (%)</label>
            <input style={tbInput} type="number" step="0.125" value={mtgRate} onChange={e=>setMtgRate(Number(e.target.value))} />
          </div>
          <div>
            <label style={tbLabel}>Term (years)</label>
            <select style={{...tbInput,cursor:"pointer"}} value={mtgTerm} onChange={e=>setMtgTerm(Number(e.target.value))}>
              {[15,20,25,30].map(t=><option key={t} value={t}>{t} years</option>)}
            </select>
          </div>
          <div>
            <label style={tbLabel}>Annual Property Tax</label>
            <input style={tbInput} type="number" value={mtgTax} onChange={e=>setMtgTax(Number(e.target.value))} />
          </div>
          <div>
            <label style={tbLabel}>Annual Insurance</label>
            <input style={tbInput} type="number" value={mtgIns} onChange={e=>setMtgIns(Number(e.target.value))} />
          </div>
        </div>
      </div>
      <div style={{...tbCard}}>
        <div style={{fontSize:12,color:"#888",marginBottom:8}}>MONTHLY PAYMENT BREAKDOWN</div>
        <div style={{fontSize:32,fontWeight:700,color:"#d4af37",marginBottom:12}}>{fmt$(mtg.total)}<span style={{fontSize:12,color:"#888"}}>/mo</span></div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          <div style={{fontSize:11}}>Principal & Interest: <span style={{color:"#d4af37"}}>{fmt$(mtg.pi)}</span></div>
          <div style={{fontSize:11}}>Property Tax: <span style={{color:"#6366f1"}}>{fmt$(mtg.tax)}</span></div>
          <div style={{fontSize:11}}>Insurance: <span style={{color:"#10b981"}}>{fmt$(mtg.ins)}</span></div>
          <div style={{fontSize:11}}>PMI: <span style={{color:mtg.pmi>0?"#ef4444":"#555"}}>{mtg.pmi>0?fmt$(mtg.pmi):"N/A"}</span></div>
        </div>
        <div style={{borderTop:"1px solid #1e1e28",marginTop:12,paddingTop:12,display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
          <div><div style={tbLabel}>Loan Amount</div><div style={{fontSize:13,color:"#d4af37"}}>{fmt$(mtg.loan)}</div></div>
          <div><div style={tbLabel}>Down Payment</div><div style={{fontSize:13}}>{fmt$(mtg.downAmt)} ({((mtg.downAmt/mtgPrice)*100).toFixed(1)}%)</div></div>
          <div><div style={tbLabel}>Total Interest</div><div style={{fontSize:13,color:"#ef4444"}}>{fmt$(mtg.totalInterest)}</div></div>
        </div>
        <div style={{marginTop:8}}><div style={tbLabel}>Total Cost Over Life</div><div style={{fontSize:16,fontWeight:600}}>{fmt$(mtg.totalLife)}</div></div>
      </div>
      <button style={tbBtnSec} onClick={()=>setMtgShowAmort(!mtgShowAmort)}>{mtgShowAmort?"Hide":"Show"} Amortization</button>
      {mtgShowAmort && (
        <div style={{...tbCard,marginTop:12,maxHeight:300,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:10,borderCollapse:"collapse"}}>
            <thead><tr style={{color:"#888"}}>
              <th style={{textAlign:"left",padding:4}}>Month</th><th style={{textAlign:"right",padding:4}}>Principal</th><th style={{textAlign:"right",padding:4}}>Interest</th><th style={{textAlign:"right",padding:4}}>Balance</th>
            </tr></thead>
            <tbody>{mtg.schedule.map(r=>(
              <tr key={r.month} style={{borderTop:"1px solid #1a1a22"}}>
                <td style={{padding:4}}>{r.month}</td>
                <td style={{textAlign:"right",padding:4,color:"#10b981"}}>{fmt$(r.principal)}</td>
                <td style={{textAlign:"right",padding:4,color:"#ef4444"}}>{fmt$(r.interest)}</td>
                <td style={{textAlign:"right",padding:4}}>{fmt$(r.balance)}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );

  const TZ_CITIES = [
    {name:"New York",tz:"America/New_York"},{name:"Los Angeles",tz:"America/Los_Angeles"},{name:"Miami",tz:"America/New_York"},
    {name:"Mexico City",tz:"America/Mexico_City"},{name:"S\u00e3o Paulo",tz:"America/Sao_Paulo"},{name:"London",tz:"Europe/London"},
    {name:"Berlin",tz:"Europe/Berlin"},{name:"Dubai",tz:"Asia/Dubai"},{name:"Tokyo",tz:"Asia/Tokyo"},{name:"Sydney",tz:"Australia/Sydney"},
  ];
  const TimezonePanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>World Clocks</h3>
      <div style={{...tbGrid,gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",marginBottom:20}}>
        {TZ_CITIES.map(c=>{
          let t;
          try { t = tzTime.toLocaleTimeString("en-US",{timeZone:c.tz,hour:"2-digit",minute:"2-digit",second:"2-digit"}); } catch{ t="--"; }
          let d;
          try { d = tzTime.toLocaleDateString("en-US",{timeZone:c.tz,weekday:"short",month:"short",day:"numeric"}); } catch{ d="--"; }
          return (
            <div key={c.name} style={{...tbCard,textAlign:"center",padding:12}}>
              <div style={{fontSize:10,color:"#888"}}>{c.name}</div>
              <div style={{fontSize:18,fontWeight:700,color:"#d4af37",fontVariantNumeric:"tabular-nums"}}>{t}</div>
              <div style={{fontSize:10,color:"#555"}}>{d}</div>
            </div>
          );
        })}
      </div>
      <div style={tbCard}>
        <div style={{fontSize:12,color:"#888",marginBottom:8}}>TIME CONVERTER</div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:1}}>
            <label style={tbLabel}>Time</label>
            <input style={tbInput} type="time" value={tzInput} onChange={e=>setTzInput(e.target.value)} />
          </div>
          <div style={{flex:1}}>
            <label style={tbLabel}>From</label>
            <select style={{...tbInput,cursor:"pointer"}} value={tzFrom} onChange={e=>setTzFrom(e.target.value)}>
              {TZ_CITIES.map(c=><option key={c.tz} value={c.tz}>{c.name}</option>)}
            </select>
          </div>
          <div style={{flex:1}}>
            <label style={tbLabel}>To</label>
            <select style={{...tbInput,cursor:"pointer"}} value={tzTo} onChange={e=>setTzTo(e.target.value)}>
              {TZ_CITIES.map(c=><option key={c.tz} value={c.tz}>{c.name}</option>)}
            </select>
          </div>
        </div>
        {tzInput && (
          <div style={{marginTop:12,fontSize:14}}>
            {tzInput} in {TZ_CITIES.find(c=>c.tz===tzFrom)?.name||tzFrom} = <span style={{color:"#d4af37",fontWeight:700}}>
            {(()=>{
              try {
                const [h,m] = tzInput.split(":").map(Number);
                const d = new Date(); d.setHours(h,m,0,0);
                const fromStr = d.toLocaleString("en-US",{timeZone:tzFrom});
                const fromDate = new Date(fromStr);
                const toStr = new Date(d.getTime() + (new Date(d.toLocaleString("en-US",{timeZone:tzTo})) - new Date(d.toLocaleString("en-US",{timeZone:tzFrom})))).toLocaleTimeString("en-US",{hour:"2-digit",minute:"2-digit"});
                return toStr;
              } catch{ return "--"; }
            })()}</span> in {TZ_CITIES.find(c=>c.tz===tzTo)?.name||tzTo}
          </div>
        )}
      </div>
    </div>
  );

  const CryptoPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Crypto Prices</h3>
      <button style={{...tbBtn,marginBottom:16}} onClick={doCryptoFetch} disabled={cryptoLoading}>{cryptoLoading?"Loading...":"Fetch Prices"}</button>
      {cryptoData && (
        <div style={{...tbGrid,gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))"}}>
          {Object.entries(cryptoData).map(([coin,data])=>{
            const change = data.usd_24h_change;
            return (
              <div key={coin} style={tbCard}>
                <div style={{fontSize:14,fontWeight:600,textTransform:"capitalize",marginBottom:8}}>{coin}</div>
                <div style={{fontSize:24,fontWeight:700,color:"#d4af37"}}>${data.usd?.toLocaleString()}</div>
                <div style={{fontSize:12,color:change>=0?"#10b981":"#ef4444",marginTop:4}}>{change>=0?"\u25b2":"\u25bc"} {Math.abs(change||0).toFixed(2)}% (24h)</div>
                <div style={{fontSize:10,color:"#555",marginTop:4}}>MCap: ${(data.usd_market_cap/1e9).toFixed(2)}B</div>
              </div>
            );
          })}
        </div>
      )}
      {!cryptoData && !cryptoLoading && <div style={{color:"#555",fontSize:12,textAlign:"center",padding:40}}>Click to fetch live cryptocurrency prices</div>}
    </div>
  );

  const HOL_COUNTRIES = [
    {code:"US",name:"United States"},{code:"MX",name:"Mexico"},{code:"CA",name:"Canada"},{code:"GB",name:"United Kingdom"},
    {code:"DE",name:"Germany"},{code:"FR",name:"France"},{code:"BR",name:"Brazil"},{code:"ES",name:"Spain"},{code:"CO",name:"Colombia"}
  ];
  const HolidaysPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Public Holidays</h3>
      <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
        <select style={{...tbInput,width:80}} value={holYear} onChange={e=>setHolYear(Number(e.target.value))}>
          {[2024,2025,2026,2027].map(y=><option key={y} value={y}>{y}</option>)}
        </select>
        <select style={{...tbInput,width:180,cursor:"pointer"}} value={holCountry} onChange={e=>setHolCountry(e.target.value)}>
          {HOL_COUNTRIES.map(c=><option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <button style={tbBtn} onClick={doHolidayFetch} disabled={holLoading}>{holLoading?"...":"Load"}</button>
      </div>
      {holData.length>0 && (
        <div>
          {holData.map((h,i)=>{
            const today = new Date().toISOString().slice(0,10);
            const isToday = h.date===today;
            const isPast = h.date<today;
            return (
              <div key={i} style={{...tbCard,padding:10,display:"flex",justifyContent:"space-between",alignItems:"center",opacity:isPast?0.5:1,borderLeft:isToday?"3px solid #d4af37":"none"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:isToday?700:400,color:isToday?"#d4af37":"#e0dcd0"}}>{h.localName||h.name}</div>
                  <div style={{fontSize:10,color:"#555"}}>{h.name!==h.localName?h.name:""}</div>
                </div>
                <div style={{fontSize:11,color:"#888"}}>{new Date(h.date+"T12:00").toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric"})}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const RatesPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Exchange Rates (vs USD)</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="Filter currencies..." value={ratesFilter} onChange={e=>setRatesFilter(e.target.value)} />
        <button style={tbBtn} onClick={doRatesFetch} disabled={ratesLoading}>{ratesLoading?"...":"Load Rates"}</button>
      </div>
      {ratesData?.rates && (
        <div style={{...tbCard,maxHeight:500,overflowY:"auto"}}>
          <table style={{width:"100%",fontSize:11,borderCollapse:"collapse"}}>
            <thead><tr style={{color:"#888"}}><th style={{textAlign:"left",padding:6}}>Currency</th><th style={{textAlign:"right",padding:6}}>Rate</th><th style={{textAlign:"right",padding:6}}>1 USD =</th></tr></thead>
            <tbody>
              {Object.entries(ratesData.rates).filter(([k])=>!ratesFilter||k.toLowerCase().includes(ratesFilter.toLowerCase())).map(([code,rate])=>(
                <tr key={code} style={{borderTop:"1px solid #1a1a22"}} className="rh">
                  <td style={{padding:6,fontWeight:500}}>{code}</td>
                  <td style={{textAlign:"right",padding:6,color:"#d4af37"}}>{rate.toFixed(4)}</td>
                  <td style={{textAlign:"right",padding:6,color:"#888"}}>{rate.toFixed(2)} {code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const WikiPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Wikipedia Lookup</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="Search Wikipedia..." value={wikiQuery} onChange={e=>setWikiQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doWikiSearch()} />
        <button style={tbBtn} onClick={doWikiSearch} disabled={wikiLoading}>{wikiLoading?"...":"Search"}</button>
      </div>
      {wikiResult?.extract && (
        <div style={tbCard}>
          <div style={{display:"flex",gap:16}}>
            {wikiResult.thumbnail?.source && <img src={wikiResult.thumbnail.source} alt="" style={{width:120,height:120,objectFit:"cover",borderRadius:8,flexShrink:0}} />}
            <div>
              <div style={{fontSize:16,fontWeight:700,color:"#d4af37",marginBottom:8}}>{wikiResult.title}</div>
              <div style={{fontSize:12,lineHeight:1.6,color:"#ccc"}}>{wikiResult.extract}</div>
              {wikiResult.content_urls?.desktop?.page && (
                <a href={wikiResult.content_urls.desktop.page} target="_blank" rel="noreferrer" style={{color:"#6366f1",fontSize:11,marginTop:8,display:"inline-block"}}>Read full article \u2192</a>
              )}
            </div>
          </div>
        </div>
      )}
      {wikiResult && !wikiResult.extract && <div style={{...tbCard,color:"#888",fontSize:12}}>No results found for "{wikiQuery}"</div>}
    </div>
  );

  const ZIPPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>ZIP Code Lookup</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1,maxWidth:200}} placeholder="Enter ZIP code..." value={zipInput} onChange={e=>setZipInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doZipLookup()} />
        <button style={tbBtn} onClick={doZipLookup} disabled={zipLoading}>{zipLoading?"...":"Lookup"}</button>
      </div>
      {zipData?.places && (
        <div style={tbCard}>
          {zipData.places.map((p,i)=>(
            <div key={i} style={{marginBottom:i<zipData.places.length-1?16:0}}>
              <div style={{fontSize:18,fontWeight:700,color:"#d4af37",marginBottom:8}}>{p["place name"]}, {p["state abbreviation"]}</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
                <div><span style={tbLabel}>State</span><div style={{fontSize:13}}>{p.state}</div></div>
                <div><span style={tbLabel}>ZIP</span><div style={{fontSize:13}}>{zipData["post code"]}</div></div>
                <div><span style={tbLabel}>Latitude</span><div style={{fontSize:13}}>{p.latitude}</div></div>
                <div><span style={tbLabel}>Longitude</span><div style={{fontSize:13}}>{p.longitude}</div></div>
              </div>
            </div>
          ))}
        </div>
      )}
      {zipData && !zipData.places && <div style={{...tbCard,color:"#888",fontSize:12}}>No data found for ZIP "{zipInput}"</div>}
    </div>
  );

  const CountryPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Country Info</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="Country name..." value={countryQuery} onChange={e=>setCountryQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doCountrySearch()} />
        <button style={tbBtn} onClick={doCountrySearch} disabled={countryLoading}>{countryLoading?"...":"Search"}</button>
      </div>
      {countryData && (
        <div style={tbCard}>
          <div style={{display:"flex",alignItems:"center",gap:16,marginBottom:16}}>
            <span style={{fontSize:48}}>{countryData.flag}</span>
            <div>
              <div style={{fontSize:20,fontWeight:700,color:"#d4af37"}}>{countryData.name?.common}</div>
              <div style={{fontSize:12,color:"#888"}}>{countryData.name?.official}</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><span style={tbLabel}>Capital</span><div style={{fontSize:13}}>{countryData.capital?.[0]||"N/A"}</div></div>
            <div><span style={tbLabel}>Population</span><div style={{fontSize:13}}>{countryData.population?.toLocaleString()}</div></div>
            <div><span style={tbLabel}>Area</span><div style={{fontSize:13}}>{countryData.area?.toLocaleString()} km\u00b2</div></div>
            <div><span style={tbLabel}>Region</span><div style={{fontSize:13}}>{countryData.region} / {countryData.subregion}</div></div>
            <div><span style={tbLabel}>Languages</span><div style={{fontSize:13}}>{countryData.languages?Object.values(countryData.languages).join(", "):"N/A"}</div></div>
            <div><span style={tbLabel}>Currencies</span><div style={{fontSize:13}}>{countryData.currencies?Object.values(countryData.currencies).map(c=>c.name).join(", "):"N/A"}</div></div>
            <div><span style={tbLabel}>Timezones</span><div style={{fontSize:13}}>{countryData.timezones?.join(", ")}</div></div>
            <div><span style={tbLabel}>Driving Side</span><div style={{fontSize:13}}>{countryData.car?.side}</div></div>
            <div><span style={tbLabel}>Top-Level Domain</span><div style={{fontSize:13}}>{countryData.tld?.join(", ")}</div></div>
          </div>
        </div>
      )}
    </div>
  );

  const BooksPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Book Search</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,flex:1}} placeholder="Search books..." value={bookQuery} onChange={e=>setBookQuery(e.target.value)} onKeyDown={e=>e.key==="Enter"&&doBookSearch()} />
        <button style={tbBtn} onClick={doBookSearch} disabled={bookLoading}>{bookLoading?"...":"Search"}</button>
      </div>
      {bookResults?.docs && (
        <div style={{...tbGrid,gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))"}}>
          {bookResults.docs.slice(0,10).map((b,i)=>(
            <div key={i} style={{...tbCard,padding:12}}>
              {b.cover_i && <img src={`https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg`} alt="" style={{width:"100%",height:160,objectFit:"cover",borderRadius:6,marginBottom:8}} />}
              <div style={{fontSize:12,fontWeight:600,color:"#e0dcd0",marginBottom:4}}>{b.title}</div>
              <div style={{fontSize:10,color:"#888"}}>{b.author_name?.[0]||"Unknown"}</div>
              <div style={{fontSize:10,color:"#555"}}>{b.first_publish_year||""}</div>
            </div>
          ))}
        </div>
      )}
      {bookResults && !bookResults.docs?.length && <div style={{...tbCard,color:"#888",fontSize:12}}>No books found</div>}
    </div>
  );

  const LANGS = ["English","Spanish","French","Portuguese","German","Italian","Chinese","Japanese","Korean","Arabic"];
  const TranslatePanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>AI Translate</h3>
      <div style={{display:"flex",gap:8,marginBottom:12}}>
        <div style={{flex:1}}>
          <label style={tbLabel}>From</label>
          <select style={{...tbInput,cursor:"pointer"}} value={trFrom} onChange={e=>setTrFrom(e.target.value)}>
            {LANGS.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <div style={{flex:1}}>
          <label style={tbLabel}>To</label>
          <select style={{...tbInput,cursor:"pointer"}} value={trTo} onChange={e=>setTrTo(e.target.value)}>
            {LANGS.map(l=><option key={l} value={l}>{l}</option>)}
          </select>
        </div>
      </div>
      <textarea style={{...tbInput,height:120,resize:"vertical",marginBottom:12}} placeholder="Enter text to translate..." value={trSrc} onChange={e=>setTrSrc(e.target.value)} />
      <button style={tbBtn} onClick={doTranslate} disabled={trLoading}>{trLoading?"Translating...":"Translate"}</button>
      {trResult && (
        <div style={{...tbCard,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={tbLabel}>Translation</span>
            <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>copyText(trResult)}>Copy</button>
          </div>
          <div style={{fontSize:13,lineHeight:1.6,whiteSpace:"pre-wrap"}}>{trResult}</div>
        </div>
      )}
    </div>
  );

  const AI_TEMPLATES = ["Blog Post","LinkedIn Post","Property Description","Bio","Social Media Caption","Thank You Note","Follow-up Email"];
  const AI_TONES = ["Professional","Casual","Formal","Friendly","Persuasive"];
  const AIWriterPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>AI Writer</h3>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:150}}>
          <label style={tbLabel}>Template</label>
          <select style={{...tbInput,cursor:"pointer"}} value={aiTemplate} onChange={e=>setAiTemplate(e.target.value)}>
            {AI_TEMPLATES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:150}}>
          <label style={tbLabel}>Tone</label>
          <select style={{...tbInput,cursor:"pointer"}} value={aiTone} onChange={e=>setAiTone(e.target.value)}>
            {AI_TONES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
      </div>
      <textarea style={{...tbInput,height:100,resize:"vertical",marginBottom:12}} placeholder="Describe what you want to write about..." value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} />
      <button style={tbBtn} onClick={doAiWrite} disabled={aiLoading}>{aiLoading?"Writing...":"Generate"}</button>
      {aiResult && (
        <div style={{...tbCard,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={tbLabel}>{aiTemplate} ({aiTone})</span>
            <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>copyText(aiResult)}>Copy</button>
          </div>
          <div style={{fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{aiResult}</div>
        </div>
      )}
    </div>
  );

  const EM_TYPES = ["Follow-up","Introduction","Thank You","Cold Outreach","Appointment Confirmation","Review Request","Quote Follow-up"];
  const EmailGenPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Email Generator</h3>
      <div style={{display:"flex",gap:8,marginBottom:12,flexWrap:"wrap"}}>
        <div style={{flex:1,minWidth:150}}>
          <label style={tbLabel}>Email Type</label>
          <select style={{...tbInput,cursor:"pointer"}} value={emType} onChange={e=>setEmType(e.target.value)}>
            {EM_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div style={{flex:1,minWidth:150}}>
          <label style={tbLabel}>Recipient Name</label>
          <input style={tbInput} placeholder="John Doe" value={emRecipient} onChange={e=>setEmRecipient(e.target.value)} />
        </div>
        <div style={{flex:"0 0 80px"}}>
          <label style={tbLabel}>Language</label>
          <select style={{...tbInput,cursor:"pointer"}} value={emLang} onChange={e=>setEmLang(e.target.value)}>
            <option value="EN">EN</option><option value="ES">ES</option>
          </select>
        </div>
      </div>
      <textarea style={{...tbInput,height:100,resize:"vertical",marginBottom:12}} placeholder="Context: What is this email about? Key details..." value={emContext} onChange={e=>setEmContext(e.target.value)} />
      <button style={tbBtn} onClick={doEmailGen} disabled={emLoading}>{emLoading?"Generating...":"Generate Email"}</button>
      {emResult && (
        <div style={{...tbCard,marginTop:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={tbLabel}>{emType} Email</span>
            <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>copyText(emResult)}>Copy</button>
          </div>
          <div style={{fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{emResult}</div>
        </div>
      )}
    </div>
  );

  const SummarizePanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>AI Summarizer</h3>
      <textarea style={{...tbInput,height:180,resize:"vertical",marginBottom:8}} placeholder="Paste text to summarize..." value={sumText} onChange={e=>setSumText(e.target.value)} />
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <span style={{fontSize:10,color:"#555"}}>{sumText.split(/\s+/).filter(Boolean).length} words</span>
        <button style={tbBtn} onClick={doSummarize} disabled={sumLoading}>{sumLoading?"Summarizing...":"Summarize"}</button>
      </div>
      {sumResult && (
        <div style={{...tbCard}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <span style={tbLabel}>Summary</span>
            <button style={{...tbBtnSec,padding:"4px 8px",fontSize:10}} onClick={()=>copyText(sumResult)}>Copy</button>
          </div>
          <div style={{fontSize:13,lineHeight:1.7,whiteSpace:"pre-wrap"}}>{sumResult}</div>
        </div>
      )}
    </div>
  );

  const QuotePanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Inspirational Quote</h3>
      <button style={{...tbBtn,marginBottom:16}} onClick={doQuoteFetch} disabled={quoteLoading}>{quoteLoading?"...":quoteData?"New Quote":"Get Quote"}</button>
      {quoteData && (
        <div style={{...tbCard,textAlign:"center",padding:32}}>
          <div style={{fontSize:48,color:"#d4af37",lineHeight:1,marginBottom:12}}>\u201c</div>
          <div style={{fontSize:16,fontStyle:"italic",lineHeight:1.8,color:"#e0dcd0",maxWidth:500,margin:"0 auto"}}>{quoteData.quote}</div>
          {quoteData.author && <div style={{fontSize:12,color:"#888",marginTop:16}}>\u2014 {quoteData.author}</div>}
          <div style={{marginTop:16}}>
            <button style={{...tbBtnSec,padding:"4px 12px",fontSize:10}} onClick={()=>copyText(`"${quoteData.quote}" - ${quoteData.author||""}`)}>Copy</button>
          </div>
        </div>
      )}
    </div>
  );

  const DogPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Random Dog Pics</h3>
      <button style={{...tbBtn,marginBottom:16}} onClick={doDogFetch} disabled={dogLoading}>{dogLoading?"...":"New Dog"}</button>
      {dogUrl && (
        <div style={{...tbCard,textAlign:"center"}}>
          <img src={dogUrl} alt="Dog" style={{maxWidth:"100%",maxHeight:400,borderRadius:8}} />
          <div style={{fontSize:10,color:"#555",marginTop:8}}>{dogUrl.split("/").slice(-2).join(" / ").replace(/\.\w+$/,"")}</div>
        </div>
      )}
      {dogGallery.length>1 && (
        <div style={{marginTop:12}}>
          <div style={tbLabel}>Gallery</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8}}>
            {dogGallery.slice(1).map((url,i)=>(
              <img key={i} src={url} alt="" style={{width:"100%",height:100,objectFit:"cover",borderRadius:6,cursor:"pointer"}} onClick={()=>setDogUrl(url)} />
            ))}
          </div>
        </div>
      )}
      {!dogUrl && !dogLoading && <div style={{color:"#555",fontSize:12,textAlign:"center",padding:40}}>Click to fetch a random dog picture</div>}
    </div>
  );

  const NumFactPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Number Facts</h3>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input style={{...tbInput,maxWidth:150}} type="number" value={numInput} onChange={e=>setNumInput(Number(e.target.value))} onKeyDown={e=>e.key==="Enter"&&doNumFact()} />
        <button style={tbBtn} onClick={doNumFact} disabled={numLoading}>{numLoading?"...":"Get Fact"}</button>
      </div>
      {numFact && (
        <div style={{...tbCard,padding:24}}>
          <div style={{fontSize:36,fontWeight:700,color:"#d4af37",marginBottom:12}}>{numInput}</div>
          <div style={{fontSize:14,lineHeight:1.7}}>{numFact}</div>
        </div>
      )}
    </div>
  );

  const ActivityPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Random Activity</h3>
      <button style={{...tbBtn,marginBottom:16}} onClick={doActivityFetch} disabled={actLoading}>{actLoading?"...":"New Activity"}</button>
      {actData && (
        <div style={{...tbCard,padding:24}}>
          <div style={{fontSize:18,fontWeight:600,color:"#d4af37",marginBottom:12}}>{actData.activity}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
            <div><span style={tbLabel}>Type</span><div style={{fontSize:13,textTransform:"capitalize"}}>{actData.type}</div></div>
            <div><span style={tbLabel}>Participants</span><div style={{fontSize:13}}>{actData.participants}</div></div>
            <div><span style={tbLabel}>Price</span><div style={{fontSize:13}}>{actData.price===0?"Free":actData.price<0.3?"$":actData.price<0.6?"$$":"$$$"}</div></div>
          </div>
        </div>
      )}
      {!actData && !actLoading && <div style={{color:"#555",fontSize:12,textAlign:"center",padding:40}}>Click to get a random activity suggestion</div>}
    </div>
  );

  const PhotosPanel = () => (
    <div>
      <h3 style={{color:"#d4af37",margin:"0 0 12px",fontSize:16}}>Stock Photos</h3>
      <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"flex-end"}}>
        <div style={{flex:"0 0 120px"}}>
          <label style={tbLabel}>Photo ID</label>
          <input style={tbInput} placeholder="Optional" value={photoId} onChange={e=>setPhotoId(e.target.value)} />
        </div>
        <button style={tbBtn} onClick={()=>{ if(photoId) setPhotoList([randomPhotoUrl(600,400,photoId)]); else doPhotoRefresh(); }}>Refresh</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12}}>
        {photoList.map((url,i)=>(
          <div key={i} style={{...tbCard,padding:0,overflow:"hidden",cursor:"pointer"}} onClick={()=>setPhotoFull(photoFull===url?null:url)}>
            <img src={url} alt="" style={{width:"100%",height:140,objectFit:"cover"}} />
          </div>
        ))}
      </div>
      {photoFull && (
        <div style={{...tbCard,marginTop:12,textAlign:"center"}}>
          <img src={photoFull.replace(/\/\d+\/\d+/,"/800/600")} alt="" style={{maxWidth:"100%",borderRadius:8}} />
          <div style={{marginTop:8}}><button style={tbBtnSec} onClick={()=>setPhotoFull(null)}>Close</button></div>
        </div>
      )}
    </div>
  );

  const panels = {
    weather: WeatherPanel, currency: CurrencyPanel, qrcode: QRCodePanel, urlshort: URLShortPanel,
    mortgage: MortgagePanel, timezone: TimezonePanel, crypto: CryptoPanel, holidays: HolidaysPanel,
    rates: RatesPanel, wiki: WikiPanel, zip: ZIPPanel, country: CountryPanel, books: BooksPanel,
    translate: TranslatePanel, writer: AIWriterPanel, emailgen: EmailGenPanel, summarize: SummarizePanel,
    quote: QuotePanel, dog: DogPanel, numfact: NumFactPanel, activity: ActivityPanel, photos: PhotosPanel,
  };

  const ActivePanel = panels[activeTool] || WeatherPanel;

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Sidebar */}
      <div style={{width:200,background:"#0b0b13",borderRight:"1px solid #1e1e28",overflowY:"auto",flexShrink:0}}>
        {TOOLS.map(cat=>(
          <div key={cat.cat}>
            <div style={{fontSize:9,fontWeight:700,color:"#d4af37",padding:"12px 16px 4px",letterSpacing:2}}>{cat.cat}</div>
            {cat.items.map(item=>(
              <div key={item.id}
                onClick={()=>setActiveTool(item.id)}
                style={{
                  padding:"8px 16px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,
                  background:activeTool===item.id?"rgba(212,175,55,.1)":"transparent",
                  borderLeft:activeTool===item.id?"3px solid #d4af37":"3px solid transparent",
                  color:activeTool===item.id?"#d4af37":"#888",
                }}
                className="rh"
              >
                <span>{item.icon}</span><span>{item.label}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      {/* Main */}
      <div style={{flex:1,overflow:"auto",padding:24,background:"#0a0a12"}}>
        <ActivePanel />
      </div>
    </div>
  );
}

function MarketIntelView({ showToast }) {

  const [fredData,   setFredData]    = useState({});
  const [fredLoad,   setFredLoad]    = useState(false);
  const [newsTopic,  setNewsTopic]   = useState("mortgage");
  const [newsData,   setNewsData]    = useState({});
  const [newsLoad,   setNewsLoad]    = useState(false);
  const [selSeries,  setSelSeries]   = useState("MORTGAGE30US");
  const [aiSummary,  setAiSummary]   = useState("");
  const [aiLoad,     setAiLoad]      = useState(false);
  const [refreshed,  setRefreshed]   = useState(null);
  const [mktLang,    setMktLang]     = useState("en");
  const [newsTranslated, setNewsTranslated] = useState({}); // cache: {topic_es: [{title,description},...]}
  const [translating, setTranslating] = useState(false);
  const L = MKT_LANG[mktLang];
  const sl = (s) => mktLang==="es" ? (s.labelEs||s.label) : s.label;

  useEffect(()=>{ loadFRED(); },[]);
  useEffect(()=>{
    const t=NEWS_TOPICS.find(x=>x.id===newsTopic);
    if(t&&!newsData[newsTopic]) loadNews(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[newsTopic]);

  // Auto-translate news when switching to Spanish
  useEffect(()=>{
    if(mktLang==="es"&&newsData[newsTopic]?.length&&!newsTranslated[newsTopic+"_es"]) {
      translateNews(newsTopic);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[mktLang, newsTopic, newsData]);

  const translateNews = async(topic)=>{
    const arts = newsData[topic];
    if(!arts?.length) return;
    setTranslating(true);
    try {
      const batch = arts.map((a,i)=>`[${i}] TITLE: ${a.title}\nDESC: ${a.description||"N/A"}`).join("\n---\n");
      const result = await claude(
        "You are a professional translator. Translate the following news article titles and descriptions from English to Spanish. Keep it natural and journalistic. Return ONLY a JSON array of objects with 'title' and 'description' fields, one per article. No markdown, no code fences, just the JSON array.",
        batch, 1500
      );
      const cleaned = result.replace(/```json\n?/g,"").replace(/```\n?/g,"").trim();
      const parsed = JSON.parse(cleaned);
      setNewsTranslated(p=>({...p,[topic+"_es"]:parsed}));
    } catch(e) {
      console.error("Translation failed",e);
    }
    setTranslating(false);
  };

  // Get display articles (translated if Spanish, original if English)
  const getDisplayArts = ()=>{
    const raw = newsData[newsTopic]||[];
    if(mktLang!=="es") return raw;
    const tr = newsTranslated[newsTopic+"_es"];
    if(!tr) return raw;
    return raw.map((a,i)=>({
      ...a,
      title: tr[i]?.title||a.title,
      description: tr[i]?.description||a.description,
    }));
  };

  const loadFRED = async()=>{
    setFredLoad(true);
    const all = await Promise.all(FRED_SERIES.map(s=>fetchFRED(s.id,28).then(d=>({id:s.id,d}))));
    const m={}; all.forEach(({id,d})=>{ m[id]=d; });
    setFredData(m); setFredLoad(false); setRefreshed(new Date());
  };

  const loadNews = async t=>{
    setNewsLoad(true);
    const arts = await fetchGNews(t.q,10);
    setNewsData(p=>({...p,[t.id]:arts}));
    setNewsLoad(false);
  };

  const getAIBrief = async()=>{
    const arts = newsData[newsTopic]||[];
    if(!arts.length) return;
    setAiLoad(true);
    const t = NEWS_TOPICS.find(x=>x.id===newsTopic);
    const m30 = fredData["MORTGAGE30US"];
    const rateCtx = m30?`Current 30-yr fixed: ${m30.latest}% (${m30.change>=0?"+":""}${m30.change}% vs last period)`:"";
    const heads = arts.slice(0,6).map((a,i)=>`${i+1}. ${a.title} — ${a.description||""}`).join("\n");
    const txt = await claude(
      L.aiPrompt,
      `${rateCtx}\n\nTOPIC: ${t?.label}\n\n${heads}`, 700
    );
    setAiSummary(txt); setAiLoad(false);
  };

  const sd = FRED_SERIES.find(s=>s.id===selSeries);
  const sf = fredData[selSeries];
  const arts = getDisplayArts();

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px",display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>{L.title}</div>
          <div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>
            {L.sub}
            {refreshed&&<span style={{color:"#333",marginLeft:8}}>{L.updated} {refreshed.toLocaleTimeString()}</span>}
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>setMktLang(mktLang==="en"?"es":"en")} style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.2)",color:"#d4af37",fontFamily:"inherit",fontSize:9,padding:"4px 10px",borderRadius:4,cursor:"pointer",letterSpacing:".05em"}}>{mktLang==="en"?"🇪🇸 ESP":"🇺🇸 ENG"}</button>
          <Btn onClick={loadFRED} disabled={fredLoad} style={{fontSize:9}}>{fredLoad?<span className="pulse">{L.loading}</span>:L.refresh}</Btn>
        </div>
      </div>

      {/* Rate cards */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(130px,1fr))",gap:8}}>
        {FRED_SERIES.slice(0,6).map(s=>{
          const d=fredData[s.id]; const up=d&&d.change>=0;
          return (
            <div key={s.id} onClick={()=>setSelSeries(s.id)}
              style={{background:selSeries===s.id?"rgba(212,175,55,.05)":"#0d0d18",border:`1px solid ${selSeries===s.id?"rgba(212,175,55,.35)":"#1e1e28"}`,borderRadius:6,padding:"10px 12px",cursor:"pointer"}} className="card">
              <div style={{fontSize:7,color:"#444",letterSpacing:".1em",marginBottom:4}}>{sl(s)}</div>
              {fredLoad||!d
                ?<div className="sh" style={{height:20,borderRadius:2,width:"60%"}}/>
                :<>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:s.color,lineHeight:1}}>
                    {s.unit==="$"?`$${Number(d.latest).toLocaleString()}`:d.latest}{s.unit&&s.unit!=="$"?s.unit:""}
                  </div>
                  <div style={{fontSize:8,color:up?"#ef4444":"#10b981",marginTop:2}}>
                    {up?"▲":"▼"}{Math.abs(d.change)}{s.unit&&s.unit!=="$"?s.unit:""}
                    <span style={{color:"#333",marginLeft:4}}>{d.date}</span>
                  </div>
                </>
              }
            </div>
          );
        })}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr",gap:14}}>
        {/* FRED Chart + extra cards */}
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10,gap:6,flexWrap:"wrap"}}>
              <div style={{fontSize:9,color:sd?.color||"#d4af37",letterSpacing:".1em"}}>{sd?sl(sd):""} {L.trend}</div>
              <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
                {FRED_SERIES.map(s=>(
                  <button key={s.id} onClick={()=>setSelSeries(s.id)} style={{background:selSeries===s.id?`${s.color}18`:"none",border:`1px solid ${selSeries===s.id?s.color+"44":"#1a1a28"}`,color:selSeries===s.id?s.color:"#333",fontFamily:"inherit",fontSize:7,padding:"2px 5px",borderRadius:2,cursor:"pointer"}}>{sl(s)}</button>
                ))}
              </div>
            </div>
            {sf?.history?.length>0
              ?<ResponsiveContainer width="100%" height={180}>
                <AreaChart data={sf.history} margin={{top:4,right:0,bottom:0,left:-15}}>
                  <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={sd?.color||"#d4af37"} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={sd?.color||"#d4af37"} stopOpacity={0}/>
                  </linearGradient></defs>
                  <XAxis dataKey="date" tick={{fill:"#333",fontSize:7}} axisLine={false} tickLine={false} interval={Math.floor((sf.history.length-1)/5)}/>
                  <YAxis tick={{fill:"#555",fontSize:7}} axisLine={false} tickLine={false} domain={["auto","auto"]}/>
                  <Tooltip contentStyle={{background:"#0b0b16",border:`1px solid ${sd?.color||"#d4af37"}44`,borderRadius:4,fontFamily:"DM Mono",fontSize:10}} labelStyle={{color:sd?.color}} itemStyle={{color:"#888"}} formatter={v=>[`${v}${sd?.unit&&sd.unit!=="$"?sd.unit:""}`]}/>
                  <Area type="monotone" dataKey="value" stroke={sd?.color||"#d4af37"} strokeWidth={1.5} fill="url(#mg)" dot={false}/>
                </AreaChart>
              </ResponsiveContainer>
              :<div style={{height:180,display:"flex",alignItems:"center",justifyContent:"center",color:"#1e1e2e",fontSize:10}}>{fredLoad?L.loadingText:L.selectSeries}</div>
            }
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {FRED_SERIES.slice(6).map(s=>{
              const d=fredData[s.id]; const up=d&&d.change>=0;
              return (
                <div key={s.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:5,padding:"9px 11px"}}>
                  <div style={{fontSize:7,color:"#444",letterSpacing:".08em",marginBottom:3}}>{sl(s)}</div>
                  {fredLoad||!d?<div className="sh" style={{height:16,borderRadius:2,width:"70%"}}/>
                    :<><div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:s.color}}>{s.unit==="$"?`$${Number(d.latest).toLocaleString()}`:d.latest}{s.unit&&s.unit!=="$"?s.unit:""}</div>
                      <div style={{fontSize:7,color:up?"#ef4444":"#10b981"}}>{up?"▲":"▼"}{Math.abs(d.change)}{s.unit&&s.unit!=="$"?s.unit:""}</div></>
                  }
                </div>
              );
            })}
          </div>
        </div>

        {/* News panel */}
        <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden",display:"flex",flexDirection:"column"}}>
          <div style={{display:"flex",borderBottom:"1px solid #131320",overflowX:"auto",flexShrink:0}}>
            {NEWS_TOPICS.map(t=>(
              <button key={t.id} onClick={()=>setNewsTopic(t.id)}
                style={{background:newsTopic===t.id?"rgba(212,175,55,.06)":"none",border:"none",borderBottom:newsTopic===t.id?"2px solid #d4af37":"2px solid transparent",color:newsTopic===t.id?"#d4af37":"#555",fontFamily:"inherit",fontSize:8,padding:"8px 10px",cursor:"pointer",whiteSpace:"nowrap"}}>
                {sl(t)}
              </button>
            ))}
            <div style={{flex:1}}/>
            <button onClick={getAIBrief} disabled={aiLoad||!arts.length}
              style={{background:"rgba(139,92,246,.08)",border:"none",borderLeft:"1px solid #1a1a28",color:"#a78bfa",fontFamily:"inherit",fontSize:8,padding:"0 12px",cursor:"pointer",flexShrink:0}}>
              {aiLoad?<span className="pulse">{L.aiThinking}</span>:L.aiBrief}
            </button>
          </div>
          {aiSummary&&(
            <div style={{background:"rgba(139,92,246,.04)",borderBottom:"1px solid rgba(139,92,246,.15)",padding:"10px 14px",flexShrink:0}} className="fi">
              <div style={{fontSize:8,color:"#8b5cf6",letterSpacing:".1em",marginBottom:5}}>{L.aiTitle}</div>
              <pre style={{fontSize:10,color:"#c4c0d8",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit",margin:0}}>{aiSummary}</pre>
              <button onClick={()=>setAiSummary("")} style={{background:"none",border:"none",color:"#333",cursor:"pointer",fontSize:8,marginTop:4}}>{L.dismiss}</button>
            </div>
          )}
          <div style={{overflowY:"auto",flex:1}}>
            {translating&&<div style={{padding:"6px 12px",background:"rgba(139,92,246,.05)",borderBottom:"1px solid rgba(139,92,246,.1)",textAlign:"center",fontSize:8,color:"#a78bfa"}} className="pulse">🌐 Traduciendo artículos al español...</div>}
            {newsLoad&&<div style={{padding:20,textAlign:"center",color:"#555",fontSize:10}} className="pulse">{L.loadingNews}</div>}
            {!newsLoad&&!arts.length&&<div style={{padding:20,textAlign:"center",color:"#2a2a3a",fontSize:10}}>{L.loadNews}</div>}
            {arts.map((a,i)=>(
              <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                style={{display:"block",padding:"9px 12px",borderBottom:"1px solid #0e0e18",textDecoration:"none"}} className="rh">
                <div style={{display:"flex",gap:8,marginBottom:3}}>
                  <span style={{fontSize:9,color:"#999",flex:1,lineHeight:1.5}}>{a.title}</span>
                  {a.image&&<img src={a.image} alt="" style={{width:40,height:40,objectFit:"cover",borderRadius:3,flexShrink:0,opacity:.7}} onError={e=>e.target.style.display="none"}/>}
                </div>
                {a.description&&<div style={{fontSize:8,color:"#444",lineHeight:1.5,marginBottom:3}}>{a.description.slice(0,110)}…</div>}
                <div style={{display:"flex",gap:6}}>
                  <span style={{fontSize:7,color:"#333"}}>{a.source}</span>
                  <span style={{fontSize:7,color:"#2a2a3a"}}>{a.published?new Date(a.published).toLocaleDateString():"—"}</span>
                </div>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LANDING PAGE ─────────────────────────────────────────────────────────────
const ZIAREM_SERVICES = [
  {icon:"🏦",name:"Mortgage",desc:"Residential & commercial lending. Purchase, refinance, FHA, VA, conventional and non-QM solutions."},
  {icon:"🏡",name:"Real Estate",desc:"Full-service brokerage. Buying, selling, and investment property advisory across all markets."},
  {icon:"📊",name:"Credit Optimization",desc:"Strategic credit optimization and score enhancement. Tradeline management and rapid rescoring."},
  {icon:"📋",name:"Accounting & Taxes",desc:"Tax preparation, planning, and filing for individuals and businesses. Year-round advisory."},
  {icon:"📒",name:"Bookkeeping",desc:"Monthly reconciliation, payroll processing, financial reporting, and QuickBooks management."},
  {icon:"⚙",name:"Processing",desc:"Loan processing, underwriting support, and pipeline management for mortgage professionals."},
  {icon:"🏗",name:"Construction & Renovation",desc:"New builds, renovations, and 203k rehab loans. From blueprint to closing."},
  {icon:"🛡",name:"Insurance",desc:"Property & casualty, life, health, title, and home warranty coverage. Full protection under one roof."},
  {icon:"📡",name:"Marketing & CRM",desc:"AI-powered VAULT CRM platform. Lead nurturing, campaign automation, and market intelligence."},
];

function LandingPage({ onGoLogin }) {
  const scrollTo = (id) => { document.getElementById(id)?.scrollIntoView({behavior:"smooth"}); };
  const F = "'Inter',-apple-system,BlinkMacSystemFont,sans-serif";

  return (
    <div style={{minHeight:"100vh",background:"#06060e",color:"#e0dcd0",fontFamily:F}}>
      {/* ── NAV ── */}
      <nav style={{position:"fixed",top:0,left:0,right:0,zIndex:100,background:"rgba(6,6,14,.85)",backdropFilter:"blur(12px)",borderBottom:"1px solid #1a1a28"}}>
        <div style={{maxWidth:1100,margin:"0 auto",padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <img src="/logo.svg" alt="Ziarem" style={{height:36,cursor:"pointer"}} onClick={()=>window.scrollTo({top:0,behavior:"smooth"})} />
          <div style={{display:"flex",alignItems:"center",gap:24}}>
            {["Services","About","Contact"].map(s=>(
              <button key={s} onClick={()=>scrollTo(s.toLowerCase())} style={{background:"none",border:"none",color:"#777",cursor:"pointer",fontFamily:F,fontSize:11,letterSpacing:".08em"}}>{s.toUpperCase()}</button>
            ))}
            <button onClick={onGoLogin} style={{background:"#d4af37",color:"#000",border:"none",borderRadius:4,padding:"8px 20px",cursor:"pointer",fontFamily:F,fontSize:10,fontWeight:600,letterSpacing:".15em"}}>LOGIN</button>
          </div>
        </div>
      </nav>

      {/* ── HERO ── */}
      <section style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",textAlign:"center",padding:"120px 24px 80px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:"50%",left:"50%",transform:"translate(-50%,-50%)",width:600,height:600,borderRadius:"50%",background:"radial-gradient(circle,rgba(212,175,55,.06) 0%,transparent 70%)",pointerEvents:"none"}} />
        <div style={{position:"relative",maxWidth:700}}>
          <img src="/logo.svg" alt="Ziarem" style={{width:"min(480px,80vw)",marginBottom:16}} />
          <div style={{fontSize:13,color:"#888",letterSpacing:".2em",marginBottom:32,lineHeight:1.8}}>
            MORTGAGE &nbsp;|&nbsp; REAL ESTATE &nbsp;|&nbsp; CREDIT &nbsp;|&nbsp; INSURANCE &nbsp;|&nbsp; CONSTRUCTION<br/>
            ACCOUNTING &nbsp;|&nbsp; PROCESSING &nbsp;|&nbsp; MARKETING
          </div>
          <p style={{fontSize:16,color:"#999",lineHeight:1.8,maxWidth:520,margin:"0 auto 40px",fontWeight:300}}>
            A unified business ecosystem built to serve every stage of the homeownership journey &mdash; from credit optimization to closing and beyond.
          </p>
          <div style={{display:"flex",gap:16,justifyContent:"center",flexWrap:"wrap"}}>
            <button onClick={()=>scrollTo("services")} style={{background:"transparent",border:"1px solid #d4af37",color:"#d4af37",borderRadius:4,padding:"12px 32px",cursor:"pointer",fontFamily:F,fontSize:11,fontWeight:500,letterSpacing:".15em"}}>OUR SERVICES</button>
            <button onClick={onGoLogin} style={{background:"#d4af37",color:"#000",border:"1px solid #d4af37",borderRadius:4,padding:"12px 32px",cursor:"pointer",fontFamily:F,fontSize:11,fontWeight:600,letterSpacing:".15em"}}>VAULT LOGIN</button>
          </div>
        </div>
      </section>

      {/* ── SERVICES ── */}
      <section id="services" style={{maxWidth:1100,margin:"0 auto",padding:"80px 24px"}}>
        <div style={{textAlign:"center",marginBottom:56}}>
          <div style={{fontSize:9,color:"#d4af37",letterSpacing:".3em",marginBottom:8}}>WHAT WE DO</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:38,letterSpacing:".15em",color:"#e0dcd0"}}>OUR SERVICES</div>
          <div style={{width:60,height:1,background:"#d4af37",margin:"16px auto 0"}} />
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:20}}>
          {ZIAREM_SERVICES.map(s=>(
            <div key={s.name} style={{background:"#0a0a16",border:"1px solid #1a1a28",borderRadius:6,padding:"28px 24px",transition:"border-color .3s,transform .3s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(212,175,55,.35)";e.currentTarget.style.transform="translateY(-2px)";}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor="#1a1a28";e.currentTarget.style.transform="translateY(0)";}}>
              <div style={{fontSize:28,marginBottom:12}}>{s.icon}</div>
              <div style={{fontSize:13,color:"#d4af37",letterSpacing:".1em",marginBottom:8,fontWeight:600}}>{s.name.toUpperCase()}</div>
              <div style={{fontSize:12,color:"#666",lineHeight:1.7}}>{s.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ABOUT ── */}
      <section id="about" style={{background:"#08080f",borderTop:"1px solid #12121e",borderBottom:"1px solid #12121e"}}>
        <div style={{maxWidth:800,margin:"0 auto",padding:"80px 24px",textAlign:"center"}}>
          <div style={{fontSize:9,color:"#d4af37",letterSpacing:".3em",marginBottom:8}}>LEADERSHIP</div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:38,letterSpacing:".15em",color:"#e0dcd0",marginBottom:8}}>KEN WOLF</div>
          <div style={{fontSize:11,color:"#555",letterSpacing:".15em",marginBottom:32}}>FOUNDER & CEO</div>
          <p style={{fontSize:14,color:"#888",lineHeight:1.9,maxWidth:600,margin:"0 auto 24px",fontWeight:300}}>
            With deep expertise spanning mortgage lending, real estate, credit strategy, and financial services, Ken Wolf built Ziarem to eliminate the fragmentation that plagues the homeownership industry.
          </p>
          <p style={{fontSize:14,color:"#777",lineHeight:1.9,maxWidth:600,margin:"0 auto",fontWeight:300}}>
            Every division &mdash; from credit optimization to construction &mdash; operates under one roof, ensuring seamless coordination and faster results for clients and partners alike.
          </p>
        </div>
      </section>

      {/* ── CONTACT ── */}
      <section id="contact" style={{maxWidth:800,margin:"0 auto",padding:"80px 24px",textAlign:"center"}}>
        <div style={{fontSize:9,color:"#d4af37",letterSpacing:".3em",marginBottom:8}}>GET IN TOUCH</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:38,letterSpacing:".15em",color:"#e0dcd0",marginBottom:32}}>CONTACT</div>
        <div style={{display:"flex",justifyContent:"center",gap:40,flexWrap:"wrap",marginBottom:40}}>
          {[
            {icon:"✉",label:"EMAIL",value:"info@ziarem.com"},
            {icon:"🌐",label:"WEB",value:"ziarem.com"},
          ].map(c=>(
            <div key={c.label}>
              <div style={{fontSize:20,marginBottom:6}}>{c.icon}</div>
              <div style={{fontSize:8,color:"#555",letterSpacing:".15em",marginBottom:4}}>{c.label}</div>
              <div style={{fontSize:13,color:"#e0dcd0"}}>{c.value}</div>
            </div>
          ))}
        </div>
        <button onClick={onGoLogin} style={{background:"rgba(212,175,55,.1)",border:"1px solid rgba(212,175,55,.3)",color:"#d4af37",borderRadius:4,padding:"12px 32px",cursor:"pointer",fontFamily:F,fontSize:11,fontWeight:500,letterSpacing:".15em"}}>ACCESS VAULT CRM</button>
      </section>

      {/* ── FOOTER ── */}
      <footer style={{borderTop:"1px solid #12121e",padding:"32px 24px",textAlign:"center"}}>
        <img src="/logo.svg" alt="Ziarem" style={{height:24,opacity:.4,marginBottom:8}} />
        <div style={{fontSize:9,color:"#2a2a3a",letterSpacing:".1em"}}>&copy; {new Date().getFullYear()} Ziarem. All rights reserved.</div>
      </footer>
    </div>
  );
}

// ─── LOGIN SCREEN ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin, onBack }) {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr(""); setLoading(true);
    const {session, error} = await authSignIn(email, pw);
    setLoading(false);
    if (error) { setErr(error); return; }
    onLogin(session);
  };

  return (
    <div style={{minHeight:"100vh",background:"#06060e",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Inter',-apple-system,sans-serif"}}>
      <form onSubmit={handleSubmit} style={{width:340,padding:40,background:"#0a0a16",border:"1px solid #1a1a28",borderRadius:8}}>
        <div style={{textAlign:"center",marginBottom:28}}>
          <img src="/favicon.svg" alt="Vault" style={{width:48,height:48,marginBottom:8}} />
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:".3em",color:"#d4af37",marginBottom:4}}>VAULT</div>
          <div style={{fontSize:10,color:"#444",letterSpacing:".15em"}}>ZIAREM BUSINESS PLATFORM</div>
        </div>
        {err&&<div style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.25)",color:"#ef4444",fontSize:10,padding:"8px 12px",borderRadius:4,marginBottom:14,textAlign:"center"}}>{err}</div>}
        <div style={{marginBottom:12}}>
          <label style={{display:"block",fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:4}}>EMAIL</label>
          <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoFocus style={{width:"100%",padding:"10px 12px",background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,color:"#e0dcd0",fontFamily:"inherit",fontSize:12,outline:"none"}} placeholder="you@example.com" />
        </div>
        <div style={{marginBottom:20}}>
          <label style={{display:"block",fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:4}}>PASSWORD</label>
          <input type="password" value={pw} onChange={e=>setPw(e.target.value)} required style={{width:"100%",padding:"10px 12px",background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,color:"#e0dcd0",fontFamily:"inherit",fontSize:12,outline:"none"}} placeholder="••••••••" />
        </div>
        <button type="submit" disabled={loading} style={{width:"100%",padding:"11px 0",background:loading?"#444":"#d4af37",color:"#000",border:"none",borderRadius:4,cursor:loading?"wait":"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,letterSpacing:".15em",marginBottom:12}}>{loading?"SIGNING IN…":"SIGN IN"}</button>
        {onBack&&<button type="button" onClick={onBack} style={{width:"100%",padding:"9px 0",background:"none",border:"1px solid #1e1e28",color:"#555",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:10,letterSpacing:".1em"}}>BACK TO HOME</button>}
      </form>
    </div>
  );
}

// ─── CLAWBOT CHAT PANEL ──────────────────────────────────────────────────────
function KenAIPanel({ user }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(localStorage.getItem("kenai_messages") || "[]"); } catch { return []; }
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId] = useState(() => localStorage.getItem("kenai_session") || crypto.randomUUID());
  const bottomRef = useRef(null);

  useEffect(() => { localStorage.setItem("kenai_session", sessionId); }, [sessionId]);
  useEffect(() => { localStorage.setItem("kenai_messages", JSON.stringify(messages.slice(-100))); }, [messages]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, loading]);

  const send = async () => {
    const txt = input.trim();
    if (!txt || loading) return;
    setInput("");
    const userMsg = { role: "user", text: txt, ts: Date.now() };
    setMessages(p => [...p, userMsg]);
    setLoading(true);
    try {
      const r = await fetch(`${SB_URL}/functions/v1/clawbot/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: txt, session_id: sessionId, user_email: user?.email || "" }),
      });
      const d = await r.json();
      setMessages(p => [...p, { role: "bot", text: d.reply || d.error || "No response", ts: Date.now(), actions: d.actions_taken }]);
    } catch (e) {
      setMessages(p => [...p, { role: "bot", text: "Connection error. Please try again.", ts: Date.now() }]);
    }
    setLoading(false);
  };

  const sPanel = { position: "fixed", bottom: 80, left: 20, width: 400, height: 600, background: "#08080f", border: "1px solid rgba(212,175,55,.25)", borderRadius: 12, display: "flex", flexDirection: "column", zIndex: 260, boxShadow: "0 0 60px rgba(212,175,55,.12)", overflow: "hidden", fontFamily: "'Inter',sans-serif" };
  const sHeader = { padding: "12px 16px", background: "linear-gradient(135deg,#0c0c18,#12121f)", borderBottom: "1px solid rgba(212,175,55,.2)", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 };
  const sMsgs = { flex: 1, overflowY: "auto", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 };
  const sInput = { display: "flex", gap: 8, padding: "10px 14px", borderTop: "1px solid rgba(212,175,55,.15)", background: "#0a0a14", flexShrink: 0 };
  const sBubbleBot = { alignSelf: "flex-start", background: "rgba(212,175,55,.1)", border: "1px solid rgba(212,175,55,.18)", borderRadius: "2px 12px 12px 12px", padding: "10px 14px", maxWidth: "85%", fontSize: 12, color: "#e8e4d9", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" };
  const sBubbleUser = { alignSelf: "flex-end", background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.08)", borderRadius: "12px 2px 12px 12px", padding: "10px 14px", maxWidth: "85%", fontSize: 12, color: "#c0bdb0", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" };
  const sBtn = { position: "fixed", bottom: 20, left: 20, width: 50, height: 50, borderRadius: "50%", background: open ? "rgba(212,175,55,.25)" : "linear-gradient(135deg,#d4af37,#b8962e)", border: "2px solid rgba(212,175,55,.5)", color: open ? "#d4af37" : "#0a0a14", cursor: "pointer", fontSize: 22, zIndex: 261, boxShadow: "0 0 30px rgba(212,175,55,.35)", display: "flex", alignItems: "center", justifyContent: "center", transition: "all .2s" };

  const formatText = (text) => {
    return text.replace(/\*\*(.+?)\*\*/g, "").replace(/\*\*([^*]+)\*\*/g, "$1");
  };

  return (
    <>
      <button onClick={() => setOpen(p => !p)} style={sBtn} title="Ken AI — Your Personal Assistant">{open ? "\u2716" : "K"}</button>
      {open && (
        <div style={sPanel}>
          <div style={sHeader}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 18 }}>{"\uD83E\uDD16"}</span>
              <div>
                <div style={{ fontSize: 13, color: "#d4af37", fontWeight: 600, letterSpacing: ".03em" }}>Hey Ken</div>
                <div style={{ fontSize: 9, color: "#555", letterSpacing: ".05em" }}>YOUR AI ASSISTANT</div>
              </div>
            </div>
            <button onClick={() => { setMessages([]); localStorage.removeItem("kenai_messages"); }} style={{ background: "none", border: "1px solid rgba(255,255,255,.08)", color: "#555", cursor: "pointer", fontSize: 9, padding: "3px 8px", borderRadius: 3, fontFamily: "inherit" }}>CLEAR</button>
          </div>
          <div style={sMsgs}>
            {messages.length === 0 && (
              <div style={{ textAlign: "center", color: "#444", fontSize: 11, padding: "40px 20px" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>{"\uD83E\uDD16"}</div>
                <div style={{ color: "#d4af37", fontWeight: 600, marginBottom: 6 }}>Hey Ken! I'm your AI assistant</div>
                <div>Your AI command center. Try &quot;help&quot; to see what I can do.</div>
              </div>
            )}
            {messages.map((m, i) => (
              <div key={i} style={m.role === "bot" ? sBubbleBot : sBubbleUser}>
                {m.text}
              </div>
            ))}
            {loading && (
              <div style={{ ...sBubbleBot, color: "#d4af37", fontStyle: "italic" }}>
                {"\u2022 \u2022 \u2022"} Thinking...
              </div>
            )}
            <div ref={bottomRef} />
          </div>
          <div style={sInput}>
            <input
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder="Hey Ken, what do you need?"
              style={{ flex: 1, background: "#0f0f1a", border: "1px solid rgba(212,175,55,.15)", color: "#e8e4d9", fontFamily: "inherit", fontSize: 12, padding: "8px 12px", borderRadius: 6, outline: "none" }}
            />
            <button onClick={send} disabled={loading || !input.trim()} style={{ background: loading ? "#333" : "linear-gradient(135deg,#d4af37,#b8962e)", border: "none", color: "#0a0a14", cursor: loading ? "not-allowed" : "pointer", fontSize: 14, padding: "0 14px", borderRadius: 6, fontWeight: 700 }}>{"\u27A4"}</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─── APP ROOT (landing / login / app) ─────────────────────────────────────────
export default function EmailVaultApp() {
  const [session, setSession] = useState(null);
  const [teamProfile, setTeamProfile] = useState(null);
  const [checking, setChecking] = useState(true);
  const [page, setPage] = useState("login"); // "landing" | "login"

  useEffect(()=>{
    const stored = localStorage.getItem("vault_token");
    if (!stored) { setChecking(false); return; }
    authGetUser(stored).then(async user=>{
      if (user?.id) {
        setSession({access_token:stored,user});
        const tp = await fetchTeamProfile(user.id);
        setTeamProfile(tp);
      } else localStorage.removeItem("vault_token");
      setChecking(false);
    });
  },[]);

  const handleLogin = async (sess) => {
    localStorage.setItem("vault_token", sess.access_token);
    setSession(sess);
    const tp = await fetchTeamProfile(sess.user.id);
    setTeamProfile(tp);
  };

  const handleLogout = async () => {
    const token = session?.access_token;
    setSession(null); setTeamProfile(null);
    localStorage.removeItem("vault_token");
    setPage("login");
    if (token) await authSignOut(token);
  };

  if (checking) return <div style={{minHeight:"100vh",background:"#06060e",display:"flex",alignItems:"center",justifyContent:"center",color:"#333",fontSize:12,fontFamily:"'Inter',sans-serif"}}>Loading…</div>;
  if (session) return <ErrorBoundary><EmailVault user={session.user} teamProfile={teamProfile} onSignOut={handleLogout} /></ErrorBoundary>;
  if (page==="login") return <LoginScreen onLogin={handleLogin} onBack={()=>setPage("landing")} />;
  return <LandingPage onGoLogin={()=>setPage("login")} />;
}

// ─── SETTINGS VIEW (Team + Email Config + Status) ────────────────────────────
// ─── CALL CENTER ──────────────────────────────────────────────────────────────
const CALL_LANG = {
  es: {
    newCall:"+ NUEVA LLAMADA", searchCalls:"Buscar llamadas...",
    all:"Todos", today:"Hoy", myCalls:"Mis Llamadas", referred:"Referidos", active:"Activos",
    noCalls:"Sin llamadas aún", callCenter:"CENTRO DE LLAMADAS", selectCall:"Seleccione una llamada o inicie una nueva",
    inbound:"ENTRANTE", outbound:"SALIENTE", inboundCall:"LLAMADA ENTRANTE", outboundCall:"LLAMADA SALIENTE",
    participants:"PARTICIPANTES", callerNotes:"NOTAS DEL AGENTE", recording:"GRABACIÓN", transcript:"TRANSCRIPCIÓN",
    aiSummary:"RESUMEN IA", aiLeadScore:"PUNTUACIÓN IA DEL LEAD", hotLead:"🔥 LEAD CALIENTE", warmLead:"LEAD TIBIO", coldLead:"LEAD FRÍO",
    callbackScheduled:"CALLBACK PROGRAMADO", referredTo:"REFERIDO A", partner:"SOCIO", newLead:"NUEVO LEAD",
    viewContact:"Ver Contacto →", today2:"HOY", calls:"llamadas", avg:"prom", referred2:"referidos",
    logCall:"☎ REGISTRAR LLAMADA", direction:"DIRECCIÓN", disposition:"DISPOSICIÓN", select:"Seleccionar...",
    participantsLabel:"PARTICIPANTES", primary:"PRIMARIO", secondary:"SECUNDARIO",
    newSearch:"Nuevo / Buscar contacto...", name:"Nombre", phone:"Teléfono",
    addParticipant:"+ AGREGAR PARTICIPANTE",
    callRecording:"GRABACIÓN DE LLAMADA", micOnly:"🎙 SOLO MIC", pcAudio:"🖥 AUDIO PC + MIC",
    stop:"⏹ PARAR", recording2:"Grabando...", recorded:"Grabado", discard:"Descartar", aiCleanup:"Limpieza IA", processing:"Procesando...",
    notesLabel:"NOTAS / COMENTARIOS", notesPlaceholder:"Notas de la llamada, observaciones, próximos pasos...",
    referTo:"REFERIR A", none:"Ninguno", callbackDateTime:"FECHA/HORA CALLBACK",
    saving:"GUARDANDO....", saveCall:"GUARDAR LLAMADA", cancel:"CANCELAR",
    micDenied:"Acceso al micrófono denegado", noTranscript:"No hay transcripción para procesar",
    transcriptCleaned:"Transcripción limpiada por IA", callSaved:"Llamada guardada", saveFailed:"Error al guardar llamada",
    justNow:"ahora", mAgo:"m atrás", hAgo:"h atrás",
    interested:"Interesado", callback:"Callback", notInterested:"No Interesado",
    noAnswer:"Sin Respuesta", wrongNumber:"# Equivocado", qualified:"Calificado", closed:"Cerrado",
  },
  en: {
    newCall:"+ NEW CALL", searchCalls:"Search calls...",
    all:"All", today:"Today", myCalls:"My Calls", referred:"Referred", active:"Active",
    noCalls:"No calls yet", callCenter:"CALL CENTER", selectCall:"Select a call or start a new one",
    inbound:"INBOUND", outbound:"OUTBOUND", inboundCall:"INBOUND CALL", outboundCall:"OUTBOUND CALL",
    participants:"PARTICIPANTS", callerNotes:"CALLER NOTES", recording:"RECORDING", transcript:"TRANSCRIPT",
    aiSummary:"AI SUMMARY", aiLeadScore:"AI LEAD SCORE", hotLead:"🔥 HOT LEAD", warmLead:"WARM LEAD", coldLead:"COLD LEAD",
    callbackScheduled:"CALLBACK SCHEDULED", referredTo:"REFERRED TO", partner:"PARTNER", newLead:"NEW LEAD",
    viewContact:"View Contact →", today2:"TODAY", calls:"calls", avg:"avg", referred2:"referred",
    logCall:"☎ LOG CALL", direction:"DIRECTION", disposition:"DISPOSITION", select:"Select...",
    participantsLabel:"PARTICIPANTS", primary:"PRIMARY", secondary:"SECONDARY",
    newSearch:"New / Search contact...", name:"Name", phone:"Phone",
    addParticipant:"+ ADD PARTICIPANT",
    callRecording:"CALL RECORDING", micOnly:"🎙 MIC ONLY", pcAudio:"🖥 PC AUDIO + MIC",
    stop:"⏹ STOP", recording2:"Recording...", recorded:"Recorded", discard:"Discard", aiCleanup:"AI Clean-up", processing:"Processing...",
    notesLabel:"NOTES / COMMENTS", notesPlaceholder:"Call notes, observations, next steps...",
    referTo:"REFER TO", none:"None", callbackDateTime:"CALLBACK DATE/TIME",
    saving:"SAVING....", saveCall:"SAVE CALL", cancel:"CANCEL",
    micDenied:"Microphone access denied", noTranscript:"No transcript to process",
    transcriptCleaned:"Transcript cleaned up by AI", callSaved:"Call saved", saveFailed:"Failed to save call",
    justNow:"just now", mAgo:"m ago", hAgo:"h ago",
    interested:"Interested", callback:"Callback", notInterested:"Not Interested",
    noAnswer:"No Answer", wrongNumber:"Wrong #", qualified:"Qualified", closed:"Closed",
  }
};
const DISPOSITION_CFG = {
  interested:{c:"#10b981",l:"Interested",lEs:"Interesado"},callback:{c:"#3b82f6",l:"Callback",lEs:"Callback"},
  not_interested:{c:"#ef4444",l:"Not Interested",lEs:"No Interesado"},no_answer:{c:"#6b7280",l:"No Answer",lEs:"Sin Respuesta"},
  wrong_number:{c:"#f59e0b",l:"Wrong #",lEs:"# Equivocado"},qualified:{c:"#8b5cf6",l:"Qualified",lEs:"Calificado"},closed:{c:"#d4af37",l:"Closed",lEs:"Cerrado"},
};

function CallCenterView({ user, teamProfile, isAdmin, calls, setCalls, callParticipants, setCallParts, callNotifs, setCallNotifs, selCall, setSelCall, showNewCall, setShowNewCall, callFilter, setCallFilter, callSearch, setCallSearch, contacts, setCon, deals, businesses, showToast, onNav }) {
  const [team, setTeam] = useState([]);
  const [ccLang, setCcLang] = useState("es");
  const L = CALL_LANG[ccLang];
  useEffect(()=>{ fetchAllTeam().then(t=>{ if(t) setTeam(t); }); },[]);

  const callerName = id => { const m=team.find(t=>t.user_id===id); return m?.display_name||m?.email||"Unknown"; };
  const contactName = id => { const c=contacts.find(x=>x.id===id); return c?.full_name||"Unknown"; };
  const fmtDur = s => { if(!s) return "0:00"; const m=Math.floor(s/60); return `${m}:${String(s%60).padStart(2,"0")}`; };
  const timeAgo = d => { if(!d) return ""; const s=Math.floor((Date.now()-new Date(d))/1000); if(s<60) return L.justNow; if(s<3600) return `${Math.floor(s/60)} ${L.mAgo}`; if(s<86400) return `${Math.floor(s/3600)} ${L.hAgo}`; return new Date(d).toLocaleDateString(); };

  const today = new Date().toDateString();
  const filtered = useMemo(()=>{
    return calls.filter(c=>{
      if(callFilter==="today") return new Date(c.started_at).toDateString()===today;
      if(callFilter==="mine") return c.caller_id===user.id;
      if(callFilter==="referred") return c.referred_to===user.id;
      if(callFilter==="active") return c.status==="active";
      return true;
    }).filter(c=>{
      if(!callSearch) return true;
      const s=callSearch.toLowerCase();
      const parts=callParticipants.filter(p=>p.call_id===c.id);
      return (c.notes||"").toLowerCase().includes(s)||parts.some(p=>(p.name||"").toLowerCase().includes(s));
    });
  },[calls,callFilter,callSearch,callParticipants,user.id,today]);

  const selParts = selCall ? callParticipants.filter(p=>p.call_id===selCall.id) : [];

  // Admin stats
  const todayCalls = calls.filter(c=>new Date(c.started_at).toDateString()===today);
  const avgDur = todayCalls.length ? Math.round(todayCalls.reduce((a,c)=>a+(c.duration_seconds||0),0)/todayCalls.length) : 0;
  const referralQueue = calls.filter(c=>c.referred_to===user.id&&c.status==="completed");

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Left sidebar */}
      <div style={{width:300,borderRight:"1px solid #0e0e18",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #0e0e18"}}>
          <div style={{display:"flex",gap:4,marginBottom:6}}>
            <button onClick={()=>setCcLang(ccLang==="es"?"en":"es")} style={{flex:1,background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.2)",color:"#d4af37",fontFamily:"inherit",fontSize:9,padding:"4px 0",borderRadius:3,cursor:"pointer",letterSpacing:".05em"}}>{ccLang==="es"?"🇺🇸 English":"🇪🇸 Español"}</button>
          </div>
          <button onClick={()=>setShowNewCall(true)} style={{width:"100%",padding:"8px 0",background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",borderRadius:4,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".12em",marginBottom:8}}>{L.newCall}</button>
          <input value={callSearch} onChange={e=>setCallSearch(e.target.value)} placeholder={L.searchCalls} style={{width:"100%",padding:"6px 10px",background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:3,color:"#e0dcd0",fontFamily:"inherit",fontSize:10,outline:"none"}} />
        </div>
        <div style={{display:"flex",gap:2,padding:"6px 10px",borderBottom:"1px solid #0e0e18",flexWrap:"wrap"}}>
          {[{id:"all",l:L.all},{id:"today",l:L.today},{id:"mine",l:L.myCalls},{id:"referred",l:L.referred},{id:"active",l:L.active}].map(f=>(
            <button key={f.id} onClick={()=>setCallFilter(f.id)} style={{background:callFilter===f.id?"rgba(212,175,55,.1)":"none",border:`1px solid ${callFilter===f.id?"rgba(212,175,55,.3)":"transparent"}`,color:callFilter===f.id?"#d4af37":"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"2px 7px",borderRadius:2,letterSpacing:".06em"}}>{f.l}</button>
          ))}
        </div>
        <div style={{flex:1,overflow:"auto"}}>
          {filtered.map(c=>{
            const parts=callParticipants.filter(p=>p.call_id===c.id);
            const mainP=parts[0];
            const disp=DISPOSITION_CFG[c.disposition];
            return (
              <div key={c.id} onClick={()=>setSelCall(c)} style={{padding:"8px 12px",borderBottom:"1px solid #0a0a14",cursor:"pointer",background:selCall?.id===c.id?"rgba(212,175,55,.06)":"none"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:12}}>{c.direction==="inbound"?"↙":"↗"}</span>
                    <span style={{fontSize:10,color:"#e0dcd0",fontWeight:500}}>{mainP?.name||contactName(mainP?.contact_id)||"Unknown"}</span>
                    {parts.length>1&&<span style={{fontSize:7,color:"#6366f1",background:"rgba(99,102,241,.1)",padding:"0 4px",borderRadius:2}}>+{parts.length-1}</span>}
                  </div>
                  <span style={{fontSize:7,color:"#333"}}>{timeAgo(c.started_at)}</span>
                </div>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  <span style={{fontSize:8,color:"#444"}}>{callerName(c.caller_id)}</span>
                  <span style={{fontSize:8,color:"#333"}}>·</span>
                  <span style={{fontSize:8,color:"#555"}}>{fmtDur(c.duration_seconds)}</span>
                  {disp&&<span style={{fontSize:7,color:disp.c,background:`${disp.c}15`,border:`1px solid ${disp.c}30`,padding:"0 4px",borderRadius:2}}>{ccLang==="es"?(disp.lEs||disp.l):disp.l}</span>}
                  {c.referred_to&&<span style={{fontSize:7,color:"#f59e0b"}}>🔁</span>}
                  {c.recording_url&&<span style={{fontSize:7,color:"#8b5cf6"}}>🎙</span>}
                </div>
                {c.notes&&<div style={{fontSize:8,color:"#333",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.notes}</div>}
              </div>
            );
          })}
          {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:"#1e1e2e"}}><div style={{fontSize:28,marginBottom:8}}>☎</div><div style={{fontSize:10}}>{L.noCalls}</div></div>}
        </div>
        {/* Admin stats footer */}
        {isAdmin&&<div style={{borderTop:"1px solid #0e0e18",padding:"8px 12px",background:"#07070e"}}>
          <div style={{fontSize:7,color:"#d4af37",letterSpacing:".1em",marginBottom:4}}>{L.today2}</div>
          <div style={{display:"flex",gap:10,fontSize:9}}>
            <span style={{color:"#555"}}>{todayCalls.length} {L.calls}</span>
            <span style={{color:"#555"}}>{L.avg} {fmtDur(avgDur)}</span>
            <span style={{color:referralQueue.length?"#f59e0b":"#333"}}>{referralQueue.length} {L.referred2}</span>
          </div>
        </div>}
      </div>

      {/* Right panel */}
      <div style={{flex:1,overflow:"auto",padding:selCall?20:40}}>
        {!selCall&&(
          <div style={{textAlign:"center",color:"#1e1e2e",marginTop:80}}>
            <div style={{fontSize:48,marginBottom:12}}>☎</div>
            <div style={{fontSize:13,marginBottom:4}}>{L.callCenter}</div>
            <div style={{fontSize:9,color:"#333"}}>{L.selectCall}</div>
          </div>
        )}
        {selCall&&(
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
              <div>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:16}}>{selCall.direction==="inbound"?"↙":"↗"}</span>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:"#d4af37",letterSpacing:".15em"}}>{selCall.direction==="inbound"?L.inboundCall:L.outboundCall}</span>
                  <Bd label={selCall.status} color={selCall.status==="active"?"#10b981":"#555"} />
                  {DISPOSITION_CFG[selCall.disposition]&&<Bd label={ccLang==="es"?(DISPOSITION_CFG[selCall.disposition].lEs||DISPOSITION_CFG[selCall.disposition].l):DISPOSITION_CFG[selCall.disposition].l} color={DISPOSITION_CFG[selCall.disposition].c} />}
                </div>
                <div style={{fontSize:9,color:"#444"}}>{new Date(selCall.started_at).toLocaleString()} · {fmtDur(selCall.duration_seconds)} · by {callerName(selCall.caller_id)}</div>
              </div>
              {selCall.referred_to&&<div style={{background:"rgba(245,158,11,.06)",border:"1px solid rgba(245,158,11,.2)",borderRadius:4,padding:"6px 10px"}}>
                <div style={{fontSize:7,color:"#f59e0b",letterSpacing:".08em"}}>{L.referredTo}</div>
                <div style={{fontSize:10,color:"#e0dcd0"}}>{callerName(selCall.referred_to)}</div>
              </div>}
            </div>

            {/* Participants */}
            <div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:6}}>{L.participants} ({selParts.length})</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                {selParts.map(p=>{
                  const con=contacts.find(x=>x.id===p.contact_id);
                  return (
                    <div key={p.id} style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"8px 12px",minWidth:160}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                        <Av name={p.name||con?.full_name||"?"} size={22} color={p.role==="primary"?"#d4af37":"#6366f1"} />
                        <div>
                          <div style={{fontSize:10,color:"#e0dcd0"}}>{p.name||con?.full_name||"Unknown"}</div>
                          <div style={{fontSize:7,color:"#444"}}>{p.phone||con?.phone||""} · {p.role}</div>
                        </div>
                      </div>
                      {con?.is_partner&&<Bd label={L.partner} color="#d4af37" />}
                      {p.is_new_lead&&<Bd label={L.newLead} color="#10b981" />}
                      {p.contact_id&&<button onClick={()=>{onNav("crm","contacts");}} style={{fontSize:7,color:"#3b82f6",background:"none",border:"none",cursor:"pointer",fontFamily:"inherit",padding:0,marginTop:2}}>{L.viewContact}</button>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Notes */}
            {selCall.notes&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:4}}>{L.callerNotes}</div>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"10px 14px",fontSize:10,color:"#888",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{selCall.notes}</div>
            </div>}

            {/* Recording */}
            {selCall.recording_url&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#8b5cf6",letterSpacing:".1em",marginBottom:4}}>{L.recording}</div>
              <audio controls src={selCall.recording_url} style={{width:"100%",height:36,borderRadius:4}} />
            </div>}

            {/* Transcript */}
            {selCall.transcript&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:4}}>{L.transcript}</div>
              <div style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"10px 14px",fontSize:9,color:"#666",lineHeight:1.7,whiteSpace:"pre-wrap",maxHeight:300,overflow:"auto"}}>{selCall.transcript}</div>
            </div>}

            {/* Summary */}
            {selCall.summary&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#10b981",letterSpacing:".1em",marginBottom:4}}>{L.aiSummary}</div>
              <div style={{background:"rgba(16,185,129,.04)",border:"1px solid rgba(16,185,129,.15)",borderRadius:4,padding:"10px 14px",fontSize:9,color:"#10b981",lineHeight:1.6,whiteSpace:"pre-wrap"}}>{selCall.summary}</div>
            </div>}

            {selCall.ai_score!=null&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#8b5cf6",letterSpacing:".1em",marginBottom:4}}>{L.aiLeadScore}</div>
              <div style={{display:"flex",alignItems:"center",gap:10,background:"rgba(139,92,246,.04)",border:"1px solid rgba(139,92,246,.15)",borderRadius:4,padding:"10px 14px"}}>
                <div style={{fontSize:28,fontWeight:700,color:selCall.ai_score>=7?"#10b981":selCall.ai_score>=4?"#f59e0b":"#ef4444"}}>{selCall.ai_score}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:9,color:"#e0dcd0",marginBottom:2}}>{selCall.ai_score>=7?L.hotLead:selCall.ai_score>=4?L.warmLead:L.coldLead}</div>
                  {selCall.ai_score_reason&&<div style={{fontSize:8,color:"#555"}}>{selCall.ai_score_reason}</div>}
                </div>
              </div>
            </div>}

            {/* Callback */}
            {selCall.callback_at&&<div style={{marginBottom:16}}>
              <div style={{fontSize:8,color:"#3b82f6",letterSpacing:".1em",marginBottom:4}}>{L.callbackScheduled}</div>
              <div style={{fontSize:11,color:"#3b82f6"}}>{new Date(selCall.callback_at).toLocaleString()}</div>
            </div>}
          </div>
        )}
      </div>

      {/* New Call Modal */}
      {showNewCall&&<NewCallModal user={user} contacts={contacts} setCon={setCon} team={team} calls={calls} setCalls={setCalls} setCallParts={setCallParts} setCallNotifs={setCallNotifs} showToast={showToast} onClose={()=>setShowNewCall(false)} setSelCall={setSelCall} ccLang={ccLang} />}
    </div>
  );
}

function NewCallModal({ user, contacts, setCon, team, calls, setCalls, setCallParts, setCallNotifs, showToast, onClose, setSelCall, ccLang }) {
  const L = CALL_LANG[ccLang||"es"];
  const [direction, setDirection] = useState("outbound");
  const [disposition, setDisposition] = useState("");
  const [notes, setNotes] = useState("");
  const [callbackAt, setCallbackAt] = useState("");
  const [referTo, setReferTo] = useState("");
  const [participants, setParticipants] = useState([{name:"",phone:"",contact_id:"",role:"primary",is_partner:false,is_new:false}]);
  const [saving, setSaving] = useState(false);
  // Recording
  const [recording, setRecording] = useState(false);
  const [recordTime, setRecordTime] = useState(0);
  const [audioBlob, setAudioBlob] = useState(null);
  const [transcribing, setTranscribing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const mediaRef = useRef(null);
  const chunksRef = useRef([]);
  const timerRef = useRef(null);
  // Speech recognition for live transcription
  const recognitionRef = useRef(null);
  const liveTranscriptRef = useRef("");

  const addParticipant = ()=>setParticipants(p=>[...p,{name:"",phone:"",contact_id:"",role:"secondary",is_partner:false,is_new:false}]);
  const updatePart = (i,k,v)=>setParticipants(p=>p.map((x,j)=>j===i?{...x,[k]:v}:x));
  const removePart = i=>setParticipants(p=>p.filter((_,j)=>j!==i));

  const linkContact = (i, cid)=>{
    const con=contacts.find(c=>c.id===cid);
    if(con) updatePart(i,"contact_id",cid);
    updatePart(i,"name",con?.full_name||"");
    updatePart(i,"phone",con?.phone||"");
    updatePart(i,"is_partner",con?.is_partner||false);
  };

  const startRecording = async(mode="mic")=>{
    try {
      let stream;
      if(mode==="system"){
        // Capture system/computer audio via getDisplayMedia + mic mix
        const sysStream = await navigator.mediaDevices.getDisplayMedia({video:true,audio:true});
        const micStream = await navigator.mediaDevices.getUserMedia({audio:true});
        const ctx = new AudioContext();
        const dest = ctx.createMediaStreamDestination();
        // Mix system audio + mic into one stream
        if(sysStream.getAudioTracks().length>0) ctx.createMediaStreamSource(sysStream).connect(dest);
        ctx.createMediaStreamSource(micStream).connect(dest);
        stream = dest.stream;
        // Stop video track (we only need audio)
        sysStream.getVideoTracks().forEach(t=>t.stop());
        // Clean up all tracks on stop
        stream._cleanup = ()=>{ sysStream.getTracks().forEach(t=>t.stop()); micStream.getTracks().forEach(t=>t.stop()); ctx.close(); };
      } else {
        stream = await navigator.mediaDevices.getUserMedia({audio:true});
      }
      const mr = new MediaRecorder(stream, {mimeType:"audio/webm;codecs=opus"});
      chunksRef.current = [];
      mr.ondataavailable = e=>{ if(e.data.size>0) chunksRef.current.push(e.data); };
      mr.onstop = ()=>{
        const blob = new Blob(chunksRef.current,{type:"audio/webm"});
        setAudioBlob(blob);
        stream.getTracks().forEach(t=>t.stop());
        if(stream._cleanup) stream._cleanup();
      };
      mr.start(1000);
      mediaRef.current = mr;
      setRecording(true); setRecordTime(0);
      timerRef.current = setInterval(()=>setRecordTime(t=>t+1),1000);
      // Start speech recognition if available
      if(window.webkitSpeechRecognition||window.SpeechRecognition){
        const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
        const recognition = new SR();
        recognition.continuous = true; recognition.interimResults = true; recognition.lang = ccLang==="es"?"es-MX":"en-US";
        liveTranscriptRef.current = "";
        recognition.onresult = e=>{
          let t="";
          for(let i=0;i<e.results.length;i++) t+=e.results[i][0].transcript+" ";
          liveTranscriptRef.current = t.trim();
          setTranscript(t.trim());
        };
        recognition.start();
        recognitionRef.current = recognition;
      }
    } catch(e){ showToast(L.micDenied); }
  };

  const stopRecording = ()=>{
    if(mediaRef.current&&mediaRef.current.state!=="inactive") mediaRef.current.stop();
    if(timerRef.current) clearInterval(timerRef.current);
    if(recognitionRef.current) try{recognitionRef.current.stop();}catch{}
    setRecording(false);
  };

  const transcribeWithAI = async()=>{
    if(!liveTranscriptRef.current&&!transcript) { showToast(L.noTranscript); return; }
    setTranscribing(true);
    const d = await n8nPost("transcribe",{transcript_text: transcript||liveTranscriptRef.current});
    if(d?.transcript) setTranscript(d.transcript);
    setTranscribing(false);
    showToast(L.transcriptCleaned);
  };

  const handleSave = async()=>{
    setSaving(true);
    const callData = {
      caller_id: user.id,
      direction,
      status: "completed",
      started_at: new Date(Date.now()-recordTime*1000).toISOString(),
      ended_at: new Date().toISOString(),
      duration_seconds: recordTime||0,
      notes: notes||null,
      disposition: disposition||null,
      callback_at: callbackAt||null,
      referred_to: referTo||null,
      transcript: transcript||null,
      summary: null,
    };

    // Upload recording if exists
    if(audioBlob){
      const path = `call-${Date.now()}.webm`;
      const upRes = await fetch(`${SB_URL}/storage/v1/object/vault-documents/${path}`, {
        method:"POST",headers:{apikey:SB_KEY,Authorization:`Bearer ${SB_KEY}`,"Content-Type":"audio/webm","x-upsert":"true"},body:audioBlob
      });
      if(upRes.ok) callData.recording_url = `${SB_URL}/storage/v1/object/public/vault-documents/${path}`;
    }

    // Generate AI summary + score if transcript exists
    if(transcript){
      const sum = await claude("Summarize this call in 2-3 bullet points. Include action items.",transcript,400);
      if(sum) callData.summary = sum;
      const scoreRes = await claude("Rate this call 1-10 as a lead quality score. 10 = hot buyer ready to close, 1 = spam/wrong number. Return ONLY a JSON object: {\"score\":N,\"reason\":\"brief reason\",\"hot_lead\":true/false}. hot_lead = true if score >= 7.",transcript,200);
      try { const parsed = JSON.parse(scoreRes); callData.ai_score = parsed.score; callData.ai_score_reason = parsed.reason; callData.is_hot_lead = parsed.hot_lead; } catch(e) {}
    }

    // Insert call
    const saved = await sb("vault_calls","POST",callData);
    if(!saved?.[0]){ showToast(L.saveFailed); setSaving(false); return; }
    const call = saved[0];

    // Insert participants + create new contacts if needed
    for(const p of participants){
      if(!p.name&&!p.contact_id) continue;
      let cid = p.contact_id||null;
      // Create new contact if no link
      if(!cid&&p.name){
        const newCon = await sb("contacts","POST",{full_name:p.name,phone:p.phone||null,lead_status:"new",is_partner:p.is_partner});
        if(newCon?.[0]){ cid=newCon[0].id; setCon(prev=>[...prev,newCon[0]]); }
      }
      // Update partner flag if toggled
      if(cid&&p.is_partner){
        await sb("contacts","PATCH",{is_partner:true},`?id=eq.${cid}`);
      }
      await sb("vault_call_participants","POST",{call_id:call.id,contact_id:cid,role:p.role,phone:p.phone,name:p.name,is_new_lead:!p.contact_id&&!!p.name});
    }

    // Create notifications
    if(referTo){
      await sb("vault_call_notifications","POST",{call_id:call.id,recipient_id:referTo,type:"referral",message:`${teamProfile?.display_name||user.email} referred a call with ${participants[0]?.name||"unknown"} to you (${fmtDur(recordTime)})`});
    }
    // Notify admin of every call (if caller is not admin)
    const adminId = "b7a67688-73f1-4f4b-9745-f357e81affa3"; // Ken's user ID
    if(user.id!==adminId){
      await sb("vault_call_notifications","POST",{call_id:call.id,recipient_id:adminId,type:"new_call",message:`${teamProfile?.display_name||user.email} logged a ${direction} call with ${participants[0]?.name||"unknown"} (${fmtDur(recordTime)})`});
    }
    if(callbackAt){
      await sb("vault_call_notifications","POST",{call_id:call.id,recipient_id:referTo||user.id,type:"callback_due",message:`Callback due: ${participants[0]?.name||"unknown"} at ${new Date(callbackAt).toLocaleString()}`});
    }

    // Telegram notification
    sendTelegram(`📞 <b>New Call Logged</b>\nBy: ${teamProfile?.display_name||user.email}\nWith: ${participants[0]?.name||"unknown"}\nDuration: ${fmtDur(recordTime)}\nType: ${direction}${callData.summary?"\nSummary: "+callData.summary:""}`);
    auditLog(user.id,"create","call",call.id,{direction,duration:recordTime});

    // Reload data
    const [allCalls,allParts,allNotifs] = await Promise.all([
      sb("vault_calls","GET",null,"?order=started_at.desc&limit=200"),
      sb("vault_call_participants","GET",null,"?order=call_id"),
      sb("vault_call_notifications","GET",null,`?recipient_id=eq.${user.id}&order=created_at.desc&limit=50`),
    ]);
    if(allCalls) setCalls(allCalls);
    if(allParts) setCallParts(allParts);
    if(allNotifs) setCallNotifs(allNotifs);
    setSelCall(call);
    setSaving(false);
    showToast(L.callSaved);
    onClose();
  };

  const fmtDur = s=>{ const m=Math.floor(s/60); return `${m}:${String(s%60).padStart(2,"0")}`; };
  const teamProfile = team.find(t=>t.user_id===user.id);

  return (
    <Modal onClose={onClose} title={L.logCall} width="620px">
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <Fld label={L.direction}>
          <div style={{display:"flex",gap:6}}>
            {["outbound","inbound"].map(d=>(
              <button key={d} onClick={()=>setDirection(d)} style={{flex:1,padding:"7px 0",background:direction===d?"rgba(212,175,55,.1)":"#0d0d18",border:`1px solid ${direction===d?"rgba(212,175,55,.3)":"#1e1e28"}`,color:direction===d?"#d4af37":"#555",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:10,letterSpacing:".08em"}}>{d==="outbound"?"↗ "+L.outbound:"↙ "+L.inbound}</button>
            ))}
          </div>
        </Fld>
        <Fld label={L.disposition}>
          <select value={disposition} onChange={e=>setDisposition(e.target.value)} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}}>
            <option value="">{L.select}</option>
            {Object.entries(DISPOSITION_CFG).map(([k,v])=><option key={k} value={k}>{ccLang==="es"?(v.lEs||v.l):v.l}</option>)}
          </select>
        </Fld>
      </div>

      {/* Participants */}
      <div style={{fontSize:8,color:"#555",letterSpacing:".1em",marginBottom:6,marginTop:4}}>{L.participantsLabel}</div>
      {participants.map((p,i)=>(
        <div key={i} style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"8px 10px",marginBottom:6}}>
          <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:4}}>
            <span style={{fontSize:7,color:"#d4af37",minWidth:50}}>{p.role==="primary"?L.primary:L.secondary}</span>
            <select value={p.contact_id} onChange={e=>{if(e.target.value) linkContact(i,e.target.value); else updatePart(i,"contact_id","");}} style={{flex:1,background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 8px",borderRadius:3}}>
              <option value="">{L.newSearch}</option>
              {contacts.map(c=><option key={c.id} value={c.id}>{c.full_name} {c.phone?`(${c.phone})`:""}</option>)}
            </select>
            {i>0&&<button onClick={()=>removePart(i)} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:14}}>✕</button>}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr auto",gap:6}}>
            <input value={p.name} onChange={e=>updatePart(i,"name",e.target.value)} placeholder={L.name} style={{background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 8px",borderRadius:3}} />
            <input value={p.phone} onChange={e=>updatePart(i,"phone",e.target.value)} placeholder={L.phone} style={{background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 8px",borderRadius:3}} />
            <label style={{display:"flex",alignItems:"center",gap:3,fontSize:8,color:p.is_partner?"#d4af37":"#444",cursor:"pointer"}}>
              <input type="checkbox" checked={p.is_partner} onChange={e=>updatePart(i,"is_partner",e.target.checked)} /> {L.partner}
            </label>
          </div>
        </div>
      ))}
      <button onClick={addParticipant} style={{background:"none",border:"1px solid #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 10px",borderRadius:3,letterSpacing:".06em",marginBottom:12}}>{L.addParticipant}</button>

      {/* Recording */}
      <div style={{fontSize:8,color:"#8b5cf6",letterSpacing:".1em",marginBottom:6}}>{L.callRecording}</div>
      <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
        {!recording&&!audioBlob&&<div style={{display:"flex",gap:6}}>
          <button onClick={()=>startRecording("mic")} style={{background:"rgba(239,68,68,.1)",border:"1px solid rgba(239,68,68,.3)",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:10,padding:"6px 14px",borderRadius:3,letterSpacing:".08em"}}>{L.micOnly}</button>
          <button onClick={()=>startRecording("system")} style={{background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",cursor:"pointer",fontFamily:"inherit",fontSize:10,padding:"6px 14px",borderRadius:3,letterSpacing:".08em"}}>{L.pcAudio}</button>
        </div>}
        {recording&&<>
          <button onClick={stopRecording} style={{background:"#ef4444",border:"none",color:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:10,padding:"6px 14px",borderRadius:4,letterSpacing:".08em",animation:"pulse 1.5s infinite"}}>{L.stop} ({fmtDur(recordTime)})</button>
          <span style={{fontSize:9,color:"#ef4444"}}>{L.recording2}</span>
        </>}
        {audioBlob&&!recording&&<>
          <span style={{fontSize:9,color:"#10b981"}}>{L.recorded} {fmtDur(recordTime)}</span>
          <button onClick={()=>{setAudioBlob(null);setRecordTime(0);setTranscript("");}} style={{background:"none",border:"1px solid #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"3px 8px",borderRadius:2}}>{L.discard}</button>
        </>}
        {(audioBlob||transcript)&&!recording&&<button onClick={transcribeWithAI} disabled={transcribing} style={{background:"rgba(139,92,246,.1)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",cursor:transcribing?"wait":"pointer",fontFamily:"inherit",fontSize:8,padding:"3px 10px",borderRadius:3}}>{transcribing?L.processing:L.aiCleanup}</button>}
      </div>
      {transcript&&<div style={{background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"8px 10px",fontSize:9,color:"#666",lineHeight:1.5,maxHeight:150,overflow:"auto",marginBottom:12,whiteSpace:"pre-wrap"}}>{transcript}</div>}

      {/* Notes */}
      <Fld label={L.notesLabel}>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder={L.notesPlaceholder} rows={3} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3,resize:"vertical"}} />
      </Fld>

      {/* Refer + Callback */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <Fld label={L.referTo}>
          <select value={referTo} onChange={e=>setReferTo(e.target.value)} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}}>
            <option value="">{L.none}</option>
            {team.filter(t=>t.user_id!==user.id).map(t=><option key={t.user_id} value={t.user_id}>{t.display_name||t.email}</option>)}
          </select>
        </Fld>
        <Fld label={L.callbackDateTime}>
          <input type="datetime-local" value={callbackAt} onChange={e=>setCallbackAt(e.target.value)} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}} />
        </Fld>
      </div>

      <div style={{display:"flex",gap:8,marginTop:8}}>
        <button onClick={handleSave} disabled={saving} style={{background:saving?"#333":"linear-gradient(135deg,#d4af37,#8b6914)",color:"#000",border:"none",borderRadius:4,padding:"9px 24px",cursor:saving?"wait":"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,letterSpacing:".12em"}}>{saving?L.saving:L.saveCall}</button>
        <button onClick={onClose} style={{background:"none",border:"1px solid #1e1e28",color:"#555",borderRadius:4,padding:"9px 16px",cursor:"pointer",fontFamily:"inherit",fontSize:10}}>{L.cancel}</button>
      </div>
    </Modal>
  );
}

// ─── SETTINGS ─────────────────────────────────────────────────────────────────
const API_SUGGESTIONS = [
  {slug:"zillow",name:"Zillow / Zestimate",desc:"Property valuations, Zestimates, listing data, market trends",cat:"real-estate",icon:"🏠",color:"#006AFF",why:"Instant property valuations for mortgage pre-quals and real estate comps"},
  {slug:"attom",name:"ATTOM Property Data",desc:"Deed history, tax assessments, foreclosures, neighborhood data",cat:"real-estate",icon:"📊",color:"#e74c3c",why:"Deep property intel for underwriting, construction feasibility, and deal analysis"},
  {slug:"plaid",name:"Plaid",desc:"Bank account verification, income/asset data, transaction history",cat:"finance",icon:"🏦",color:"#00D632",why:"Verify borrower financials instantly for mortgage applications"},
  {slug:"twilio",name:"Twilio",desc:"SMS, voice, WhatsApp messaging for client outreach",cat:"marketing",icon:"📱",color:"#F22F46",why:"Automated appointment reminders, lead follow-ups, campaign SMS blasts"},
  {slug:"sendgrid",name:"SendGrid",desc:"Transactional & marketing email delivery at scale",cat:"marketing",icon:"📧",color:"#1A82E2",why:"Send branded email campaigns, receipts, and notifications to clients"},
  {slug:"quickbooks",name:"QuickBooks API",desc:"Accounting, invoicing, expense tracking, payroll",cat:"accounting",icon:"📋",color:"#2CA01C",why:"Sync bookkeeping data, auto-generate invoices, track business expenses"},
  {slug:"stripe",name:"Stripe",desc:"Payment processing, invoicing, subscription billing",cat:"finance",icon:"💳",color:"#635BFF",why:"Collect processing fees, consulting payments, and service subscriptions"},
  {slug:"google-maps",name:"Google Maps Platform",desc:"Geocoding, place details, distance matrix, street view",cat:"real-estate",icon:"📍",color:"#4285F4",why:"Property location intelligence, neighborhood analysis, construction site mapping"},
  {slug:"calendly",name:"Calendly",desc:"Appointment scheduling, availability management, reminders",cat:"operations",icon:"📅",color:"#006BFF",why:"Let clients self-book mortgage consultations, property showings, tax appointments"},
  {slug:"docusign",name:"DocuSign",desc:"Electronic signatures, document workflows, contract management",cat:"operations",icon:"📝",color:"#FFCD00",why:"Close deals faster with e-signatures on mortgages, contracts, tax forms"},
  {slug:"credit-karma",name:"Credit Data API",desc:"Credit score monitoring, credit report pulls, dispute tracking",cat:"credit",icon:"📈",color:"#00A44B",why:"Core tool for credit optimization — track client scores, plan repair strategies"},
  {slug:"corelogic",name:"CoreLogic",desc:"MLS data, property analytics, flood/risk data, rental estimates",cat:"real-estate",icon:"🏘",color:"#003DA5",why:"MLS access + risk data for mortgage underwriting and real estate deals"},
  {slug:"permitio",name:"Building Permits API",desc:"Permit applications, status tracking, code compliance",cat:"construction",icon:"🏗",color:"#FF8C00",why:"Track construction permits, inspection schedules, renovation compliance"},
  {slug:"openai",name:"OpenAI GPT",desc:"Additional AI model for comparison, embeddings, vision",cat:"ai",icon:"🤖",color:"#10A37F",why:"Second AI perspective for document analysis, lead scoring, market reports"},
  {slug:"zapier",name:"Zapier Webhooks",desc:"Connect 6,000+ apps with no-code automation",cat:"operations",icon:"⚡",color:"#FF4F00",why:"Auto-sync leads from Facebook Ads, sync contacts to Mailchimp, and 6K+ more"},
];

// ─── DOCUMENT TEMPLATE PANEL ─────────
function DocTemplatePanel({ contacts, businesses, user, showToast }) {
  const [templates, setTemplates] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({name:"",category:"contract",template_html:"",merge_fields:[]});
  const [genContact, setGenContact] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(()=>{
    sb("vault_doc_templates","GET",null,"?order=created_at.desc&limit=50").then(r=>{ if(r) setTemplates(r); });
  },[]);

  const MERGE_FIELDS = ["{{contact.name}}","{{contact.email}}","{{contact.phone}}","{{contact.company}}","{{deal.title}}","{{deal.value}}","{{business.name}}","{{date.today}}","{{date.year}}"];
  const categories = ["contract","agreement","letter","invoice","disclosure","proposal","other"];

  const save = async ()=>{
    if(!form.name||!form.template_html) { showToast("Name and template content required"); return; }
    const r = await sb("vault_doc_templates","POST",{...form,business_id:form.business_id||null,merge_fields:MERGE_FIELDS,created_by:user.id});
    if(r?.[0]) { setTemplates(p=>[r[0],...p]); showToast("Template saved"); }
    setShowNew(false);
    setForm({name:"",category:"contract",template_html:"",merge_fields:[]});
  };

  const generate = (tpl) => {
    const con = contacts.find(c=>c.id===genContact);
    if(!con) { showToast("Select a contact first"); return; }
    let html = tpl.template_html;
    html = html.replace(/\{\{contact\.name\}\}/g, con.full_name||"");
    html = html.replace(/\{\{contact\.email\}\}/g, con.email||"");
    html = html.replace(/\{\{contact\.phone\}\}/g, con.phone||"");
    html = html.replace(/\{\{contact\.company\}\}/g, con.company||"");
    html = html.replace(/\{\{business\.name\}\}/g, businesses.find(b=>b.id===tpl.business_id)?.name||"");
    html = html.replace(/\{\{date\.today\}\}/g, new Date().toLocaleDateString());
    html = html.replace(/\{\{date\.year\}\}/g, new Date().getFullYear().toString());
    setPreview({name:tpl.name,html});
  };

  return (
    <div style={{marginBottom:16,background:"#0a0a14",border:"1px solid rgba(139,92,246,.15)",borderRadius:5,padding:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:".15em",color:"#8b5cf6"}}>DOCUMENT TEMPLATES</span>
        <Btn onClick={()=>setShowNew(!showNew)} style={{fontSize:8,background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.25)",color:"#8b5cf6"}}>{showNew?"CANCEL":"+ NEW TEMPLATE"}</Btn>
      </div>

      {showNew&&(
        <div style={{background:"#07070e",border:"1px solid #1e1e28",borderRadius:4,padding:12,marginBottom:10}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Fld label="TEMPLATE NAME"><Inp value={form.name} onChange={v=>setForm(p=>({...p,name:v}))} placeholder="e.g. Listing Agreement" /></Fld>
            <Fld label="CATEGORY"><Sel value={form.category} onChange={v=>setForm(p=>({...p,category:v}))}>{categories.map(c=><option key={c} value={c}>{c.charAt(0).toUpperCase()+c.slice(1)}</option>)}</Sel></Fld>
          </div>
          <Fld label="TEMPLATE CONTENT (HTML with merge fields)">
            <textarea value={form.template_html} onChange={e=>setForm(p=>({...p,template_html:e.target.value}))} rows={8} placeholder="Dear {{contact.name}},\n\nThis {{business.name}} agreement..." style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"'DM Mono',monospace",fontSize:10,padding:"8px 12px",borderRadius:3,resize:"vertical"}} />
          </Fld>
          <div style={{fontSize:8,color:"#555",marginBottom:8}}>Merge fields: {MERGE_FIELDS.map(f=><span key={f} onClick={()=>setForm(p=>({...p,template_html:p.template_html+f}))} style={{cursor:"pointer",color:"#8b5cf6",marginRight:6,background:"rgba(139,92,246,.06)",padding:"1px 4px",borderRadius:2}}>{f}</span>)}</div>
          <Btn onClick={save} variant="gold">SAVE TEMPLATE</Btn>
        </div>
      )}

      {preview&&(
        <div style={{background:"#fff",color:"#000",borderRadius:4,padding:16,marginBottom:10,maxHeight:300,overflow:"auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:10,fontWeight:600}}>{preview.name} — Preview</span>
            <button onClick={()=>setPreview(null)} style={{fontSize:9,background:"none",border:"none",color:"#999",cursor:"pointer"}}>✕</button>
          </div>
          <div style={{fontSize:11,lineHeight:1.6}} dangerouslySetInnerHTML={{__html:preview.html}} />
        </div>
      )}

      <div style={{display:"flex",gap:6,marginBottom:8,alignItems:"center"}}>
        <span style={{fontSize:8,color:"#444"}}>Generate for:</span>
        <select value={genContact} onChange={e=>setGenContact(e.target.value)} style={{flex:1,maxWidth:200,background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:9,padding:"4px 8px",borderRadius:2}}>
          <option value="">Select contact...</option>
          {contacts.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}
        </select>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:8}}>
        {templates.map(t=>(
          <div key={t.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"10px 12px"}}>
            <div style={{fontSize:10,color:"#e0dcd0",marginBottom:3}}>{t.name}</div>
            <div style={{fontSize:7,color:"#8b5cf6",textTransform:"uppercase",letterSpacing:".06em",marginBottom:6}}>{t.category}</div>
            <button onClick={()=>generate(t)} style={{fontSize:8,background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.2)",color:"#8b5cf6",borderRadius:2,padding:"3px 8px",cursor:"pointer",fontFamily:"inherit"}}>GENERATE</button>
          </div>
        ))}
      </div>
      {templates.length===0&&!showNew&&<div style={{textAlign:"center",padding:20,fontSize:9,color:"#2a2a3a"}}>No templates yet — create your first template</div>}
    </div>
  );
}

// ─── REFERRAL TRACKER ─────────
function ReferralTracker({ user, contacts, deals, businesses, showToast }) {
  const [refs, setRefs] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({referrer_contact_id:"",referred_contact_id:"",business_id:"",deal_id:"",fee_amount:"",notes:""});

  useEffect(()=>{
    sb("vault_referrals","GET",null,"?order=created_at.desc&limit=100").then(r=>{ if(r) setRefs(r); });
  },[]);

  const conName = id => { const c=contacts.find(x=>x.id===id); return c?.full_name||"Unknown"; };
  const bizName = id => { const b=businesses.find(x=>x.id===id); return b?.name||"—"; };

  const save = async ()=>{
    if(!form.referrer_contact_id||!form.referred_contact_id) { showToast("Select referrer and referred contact"); return; }
    const r = await sb("vault_referrals","POST",{...form,fee_amount:parseFloat(form.fee_amount)||0});
    if(r?.[0]) {
      setRefs(p=>[r[0],...p]);
      showToast("Referral tracked");
      sendTelegram(`🔁 <b>New Referral</b>\n${conName(form.referrer_contact_id)} referred ${conName(form.referred_contact_id)}\nFee: $${form.fee_amount||0}`);
      auditLog(user.id,"create","referral",r[0].id,{referrer:form.referrer_contact_id,referred:form.referred_contact_id});
    }
    setShowNew(false);
    setForm({referrer_contact_id:"",referred_contact_id:"",business_id:"",deal_id:"",fee_amount:"",notes:""});
  };

  const totalFees = refs.reduce((s,r)=>s+Number(r.fee_amount||0),0);
  const paidFees = refs.filter(r=>r.fee_status==="paid").reduce((s,r)=>s+Number(r.fee_amount||0),0);
  const pendingFees = totalFees-paidFees;

  const markPaid = async (ref) => {
    await sb("vault_referrals","PATCH",{fee_status:"paid"},`?id=eq.${ref.id}`);
    setRefs(p=>p.map(r=>r.id===ref.id?{...r,fee_status:"paid"}:r));
    showToast("Fee marked as paid");
  };

  return (
    <div style={{flex:1,overflow:"auto",padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".2em",color:"#d4af37"}}>REFERRAL NETWORK</span>
        <Btn onClick={()=>setShowNew(true)} variant="gold" style={{fontSize:9}}>+ ADD REFERRAL</Btn>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:16}}>
        {[{l:"Total Referrals",v:refs.length,c:"#d4af37"},{l:"Pending Fees",v:`$${pendingFees.toLocaleString()}`,c:"#f59e0b"},{l:"Paid Fees",v:`$${paidFees.toLocaleString()}`,c:"#10b981"}].map((s,i)=>(
          <div key={i} style={{background:"#0d0d18",border:`1px solid ${s.c}22`,borderRadius:5,padding:"12px 14px",textAlign:"center"}}>
            <div style={{fontSize:20,color:s.c,fontWeight:700}}>{s.v}</div>
            <div style={{fontSize:8,color:"#444",letterSpacing:".08em",marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>

      {showNew&&(
        <div style={{background:"#0a0a16",border:"1px solid #1e1e28",borderRadius:5,padding:14,marginBottom:16}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Fld label="REFERRER"><Sel value={form.referrer_contact_id} onChange={v=>setForm(p=>({...p,referrer_contact_id:v}))}><option value="">Select referrer...</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</Sel></Fld>
            <Fld label="REFERRED CONTACT"><Sel value={form.referred_contact_id} onChange={v=>setForm(p=>({...p,referred_contact_id:v}))}><option value="">Select referred...</option>{contacts.map(c=><option key={c.id} value={c.id}>{c.full_name}</option>)}</Sel></Fld>
            <Fld label="BUSINESS"><Sel value={form.business_id} onChange={v=>setForm(p=>({...p,business_id:v}))}><option value="">Select business...</option>{businesses.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</Sel></Fld>
            <Fld label="LINKED DEAL"><Sel value={form.deal_id} onChange={v=>setForm(p=>({...p,deal_id:v}))}><option value="">Select deal...</option>{deals.map(d=><option key={d.id} value={d.id}>{d.title} (${d.value})</option>)}</Sel></Fld>
            <Fld label="FEE AMOUNT ($)"><Inp type="number" value={form.fee_amount} onChange={v=>setForm(p=>({...p,fee_amount:v}))} placeholder="0.00" /></Fld>
            <Fld label="NOTES"><Inp value={form.notes} onChange={v=>setForm(p=>({...p,notes:v}))} placeholder="Optional notes..." /></Fld>
          </div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <Btn onClick={save} variant="gold">SAVE REFERRAL</Btn>
            <Btn onClick={()=>setShowNew(false)}>CANCEL</Btn>
          </div>
        </div>
      )}

      {refs.map(r=>(
        <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #0e0e18"}}>
          <span style={{fontSize:16}}>🔁</span>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:"#e0dcd0"}}>{conName(r.referrer_contact_id)} → {conName(r.referred_contact_id)}</div>
            <div style={{fontSize:8,color:"#444"}}>{bizName(r.business_id)}{r.notes?` · ${r.notes}`:""}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:11,color:"#d4af37",fontWeight:600}}>${Number(r.fee_amount||0).toLocaleString()}</div>
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              <span style={{fontSize:7,color:r.fee_status==="paid"?"#10b981":"#f59e0b",background:r.fee_status==="paid"?"rgba(16,185,129,.08)":"rgba(245,158,11,.08)",padding:"1px 5px",borderRadius:2,textTransform:"uppercase"}}>{r.fee_status||"pending"}</span>
              {r.fee_status!=="paid"&&<button onClick={()=>markPaid(r)} style={{fontSize:7,background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.2)",color:"#10b981",borderRadius:2,padding:"1px 5px",cursor:"pointer",fontFamily:"inherit"}}>MARK PAID</button>}
            </div>
          </div>
        </div>
      ))}
      {refs.length===0&&!showNew&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:24,marginBottom:8}}>🔁</div><div style={{fontSize:11}}>No referrals tracked yet</div></div>}
    </div>
  );
}

// ─── REVIEW COLLECTOR ─────────
function ReviewCollector({ user, contacts, deals, businesses, showToast }) {
  const [reviews, setReviews] = useState([]);
  const [sending, setSending] = useState(null);

  useEffect(()=>{
    sb("vault_reviews","GET",null,"?order=created_at.desc&limit=100").then(r=>{ if(r) setReviews(r); });
  },[]);

  const conName = id => { const c=contacts.find(x=>x.id===id); return c?.full_name||"Unknown"; };
  const conFor = id => contacts.find(x=>x.id===id);

  const requestReview = async (contact) => {
    setSending(contact.id);
    const r = await sb("vault_reviews","POST",{contact_id:contact.id,business_id:contact.business_id||null,status:"pending",request_sent_at:new Date().toISOString()});
    if(r?.[0]) {
      setReviews(p=>[r[0],...p]);
      showToast(`Review request sent to ${contact.full_name}`);
      sendTelegram(`⭐ <b>Review Requested</b>\nSent to: ${contact.full_name}\n${contact.phone||contact.email||""}`);
    }
    setSending(null);
  };

  // Closed-won deals whose contacts haven't been asked for review
  const eligibleContacts = useMemo(()=>{
    const closedDeals = deals.filter(d=>d.stage==="closed_won"||d.status==="won");
    const reviewedIds = new Set(reviews.map(r=>r.contact_id));
    const eligible = [];
    closedDeals.forEach(d=>{
      if(d.contact_id&&!reviewedIds.has(d.contact_id)){
        const c = contacts.find(x=>x.id===d.contact_id);
        if(c) eligible.push({...c,deal:d});
      }
    });
    return eligible;
  },[deals,contacts,reviews]);

  const stats = {total:reviews.length, pending:reviews.filter(r=>r.status==="pending").length, completed:reviews.filter(r=>r.status==="completed").length, avgRating:reviews.filter(r=>r.rating).length?Math.round(reviews.filter(r=>r.rating).reduce((s,r)=>s+r.rating,0)/reviews.filter(r=>r.rating).length*10)/10:0};
  const platformColors = {google:"#4285F4",zillow:"#006AFF",yelp:"#FF1A1A",internal:"#d4af37"};

  return (
    <div style={{flex:1,overflow:"auto",padding:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".2em",color:"#d4af37"}}>REVIEWS & TESTIMONIALS</span>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
        {[{l:"Total Reviews",v:stats.total,c:"#d4af37"},{l:"Pending",v:stats.pending,c:"#f59e0b"},{l:"Completed",v:stats.completed,c:"#10b981"},{l:"Avg Rating",v:stats.avgRating?"⭐ "+stats.avgRating:"—",c:"#8b5cf6"}].map((s,i)=>(
          <div key={i} style={{background:"#0d0d18",border:`1px solid ${s.c}22`,borderRadius:5,padding:"10px 12px",textAlign:"center"}}>
            <div style={{fontSize:18,color:s.c,fontWeight:700}}>{s.v}</div>
            <div style={{fontSize:7,color:"#444",letterSpacing:".06em",marginTop:2}}>{s.l}</div>
          </div>
        ))}
      </div>

      {/* Eligible contacts for review request */}
      {eligibleContacts.length>0&&(
        <div style={{marginBottom:16}}>
          <div style={{fontSize:9,color:"#10b981",letterSpacing:".08em",marginBottom:8}}>ELIGIBLE FOR REVIEW REQUEST ({eligibleContacts.length})</div>
          {eligibleContacts.slice(0,10).map(c=>(
            <div key={c.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"6px 0",borderBottom:"1px solid #0e0e18"}}>
              <div>
                <span style={{fontSize:10,color:"#e0dcd0"}}>{c.full_name}</span>
                <span style={{fontSize:8,color:"#444",marginLeft:8}}>Deal: {c.deal?.title||"—"}</span>
              </div>
              <button onClick={()=>requestReview(c)} disabled={sending===c.id} style={{fontSize:8,background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.25)",color:"#d4af37",borderRadius:3,padding:"4px 10px",cursor:sending===c.id?"wait":"pointer",fontFamily:"inherit",letterSpacing:".06em"}}>{sending===c.id?"SENDING...":"REQUEST REVIEW"}</button>
            </div>
          ))}
        </div>
      )}

      {/* Review history */}
      <div style={{fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:8}}>ALL REVIEWS</div>
      {reviews.map(r=>(
        <div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:"1px solid #0e0e18"}}>
          <span style={{fontSize:16}}>{r.status==="completed"?"⭐":"⏳"}</span>
          <div style={{flex:1}}>
            <div style={{fontSize:10,color:"#e0dcd0"}}>{conName(r.contact_id)}</div>
            <div style={{fontSize:8,color:"#444"}}>{r.review_text?r.review_text.slice(0,80)+"...":r.status==="pending"?"Awaiting response":"—"}</div>
          </div>
          <div style={{textAlign:"right"}}>
            {r.rating&&<div style={{fontSize:11,color:"#d4af37"}}>{"⭐".repeat(r.rating)}</div>}
            <div style={{display:"flex",gap:4,alignItems:"center"}}>
              {r.platform&&<span style={{fontSize:7,color:platformColors[r.platform]||"#555",background:`${platformColors[r.platform]||"#555"}15`,padding:"1px 5px",borderRadius:2}}>{r.platform}</span>}
              <span style={{fontSize:7,color:r.status==="completed"?"#10b981":"#f59e0b"}}>{r.status}</span>
            </div>
          </div>
        </div>
      ))}
      {reviews.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:24,marginBottom:8}}>⭐</div><div style={{fontSize:11}}>No reviews yet — request reviews from closed-won contacts</div></div>}
    </div>
  );
}

// ─── TELEGRAM CONFIG COMPONENT ─────────
function TelegramConfig({ user, showToast }) {
  const [cfg, setCfg] = useState({ bot_token:"", chat_id:"", notify_calls:true, notify_referrals:true, notify_deals:true, notify_messages:true, notify_appointments:true });
  const [cfgId, setCfgId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(()=>{
    sb("vault_telegram_config","GET",null,`?user_id=eq.${user.id}&limit=1`).then(r=>{
      if(r?.[0]) { setCfg(r[0]); setCfgId(r[0].id); }
    });
  },[user.id]);

  const save = async ()=>{
    setSaving(true);
    if(cfgId) {
      await sb("vault_telegram_config","PATCH",{ bot_token:cfg.bot_token, chat_id:cfg.chat_id, notify_calls:cfg.notify_calls, notify_referrals:cfg.notify_referrals, notify_deals:cfg.notify_deals, notify_messages:cfg.notify_messages, notify_appointments:cfg.notify_appointments },`?id=eq.${cfgId}`);
    } else {
      const r = await sb("vault_telegram_config","POST",{ user_id:user.id, bot_token:cfg.bot_token, chat_id:cfg.chat_id, notify_calls:cfg.notify_calls, notify_referrals:cfg.notify_referrals, notify_deals:cfg.notify_deals, notify_messages:cfg.notify_messages, notify_appointments:cfg.notify_appointments, is_active:true });
      if(r?.[0]) setCfgId(r[0].id);
    }
    setSaving(false);
    showToast("Telegram config saved");
  };

  const test = async ()=>{
    if(!cfg.bot_token||!cfg.chat_id) { showToast("Enter bot token and chat ID first"); return; }
    setTesting(true);
    try {
      const res = await fetch(`https://api.telegram.org/bot${cfg.bot_token}/sendMessage`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ chat_id:cfg.chat_id, text:"✅ <b>VAULT Connected!</b>\nTelegram notifications are working.", parse_mode:"HTML" })
      });
      const data = await res.json();
      if(data.ok) showToast("Test message sent to Telegram!"); else showToast("Failed: "+(data.description||"unknown error"));
    } catch(e) { showToast("Error: "+e.message); }
    setTesting(false);
  };

  const Toggle = ({label,val,onChange})=>(
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"5px 0",borderBottom:"1px solid #0e0e18"}}>
      <span style={{fontSize:9,color:"#e0dcd0"}}>{label}</span>
      <button onClick={()=>onChange(!val)} style={{width:36,height:18,borderRadius:9,background:val?"#10b981":"#1e1e28",border:"none",cursor:"pointer",position:"relative",transition:"background .2s"}}>
        <span style={{position:"absolute",top:2,left:val?20:2,width:14,height:14,borderRadius:7,background:"#fff",transition:"left .2s"}} />
      </button>
    </div>
  );

  return (
    <div style={{background:"#07070e",border:"1px solid #1a1a28",borderRadius:5,padding:"12px 14px",marginBottom:12}}>
      <Fld label="BOT TOKEN"><Inp type="password" value={cfg.bot_token} onChange={v=>setCfg(p=>({...p,bot_token:v}))} placeholder="123456:ABC-DEF..." /></Fld>
      <Fld label="CHAT ID"><Inp value={cfg.chat_id} onChange={v=>setCfg(p=>({...p,chat_id:v}))} placeholder="Your Telegram chat ID" /></Fld>
      <div style={{fontSize:8,color:"#444",letterSpacing:".06em",marginBottom:6,marginTop:8}}>NOTIFICATION TOGGLES</div>
      <Toggle label="📞 Calls" val={cfg.notify_calls} onChange={v=>setCfg(p=>({...p,notify_calls:v}))} />
      <Toggle label="🔁 Referrals" val={cfg.notify_referrals} onChange={v=>setCfg(p=>({...p,notify_referrals:v}))} />
      <Toggle label="💼 Deals" val={cfg.notify_deals} onChange={v=>setCfg(p=>({...p,notify_deals:v}))} />
      <Toggle label="💬 Messages" val={cfg.notify_messages} onChange={v=>setCfg(p=>({...p,notify_messages:v}))} />
      <Toggle label="📅 Appointments" val={cfg.notify_appointments} onChange={v=>setCfg(p=>({...p,notify_appointments:v}))} />
      <div style={{display:"flex",gap:8,marginTop:10}}>
        <button onClick={save} disabled={saving} style={{background:saving?"#333":"#d4af37",color:"#000",border:"none",borderRadius:3,padding:"8px 18px",cursor:saving?"wait":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".1em"}}>{saving?"SAVING...":"SAVE CONFIG"}</button>
        <button onClick={test} disabled={testing} style={{background:testing?"#333":"rgba(16,185,129,.12)",color:"#10b981",border:"1px solid rgba(16,185,129,.25)",borderRadius:3,padding:"8px 18px",cursor:testing?"wait":"pointer",fontFamily:"inherit",fontSize:10,letterSpacing:".1em"}}>{testing?"SENDING...":"TEST CONNECTION"}</button>
      </div>
    </div>
  );
}

// ─── AUDIT LOG PANEL ─────────
function AuditLogPanel({ user }) {
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    setLoading(true);
    const q = filter==="all" ? "?order=created_at.desc&limit=100" : `?entity_type=eq.${filter}&order=created_at.desc&limit=100`;
    sb("vault_audit_log","GET",null,q).then(r=>{
      if(r) setLogs(r);
      setLoading(false);
    });
  },[filter]);

  const entityColors = {deal:"#d4af37",contact:"#3b82f6",call:"#10b981",task:"#8b5cf6",invoice:"#f59e0b",appointment:"#6366f1",automation:"#f43f5e",compliance:"#00A44B"};
  const filters = ["all","deal","contact","call","task","invoice","appointment","automation","compliance"];

  return (
    <div style={{background:"#07070e",border:"1px solid #1a1a28",borderRadius:5,padding:"12px 14px",marginBottom:12}}>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",marginBottom:10}}>
        {filters.map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{fontSize:7,padding:"3px 8px",borderRadius:2,cursor:"pointer",fontFamily:"inherit",letterSpacing:".06em",textTransform:"uppercase",
            background:filter===f?"rgba(212,175,55,.15)":"transparent",color:filter===f?"#d4af37":"#555",border:`1px solid ${filter===f?"rgba(212,175,55,.3)":"#1e1e28"}`
          }}>{f}</button>
        ))}
      </div>
      <div style={{maxHeight:300,overflow:"auto"}}>
        {loading&&<div style={{textAlign:"center",padding:20,fontSize:9,color:"#333"}}>Loading...</div>}
        {!loading&&logs.length===0&&<div style={{textAlign:"center",padding:20,fontSize:9,color:"#2a2a3a"}}>No audit entries found</div>}
        {logs.map(l=>(
          <div key={l.id} style={{display:"flex",alignItems:"center",gap:8,padding:"5px 0",borderBottom:"1px solid #0e0e18"}}>
            <span style={{fontSize:7,color:entityColors[l.entity_type]||"#555",background:`${entityColors[l.entity_type]||"#555"}15`,border:`1px solid ${entityColors[l.entity_type]||"#555"}33`,padding:"1px 5px",borderRadius:2,textTransform:"uppercase",letterSpacing:".06em",minWidth:55,textAlign:"center"}}>{l.entity_type}</span>
            <span style={{fontSize:9,color:"#e0dcd0",flex:1}}>{l.action}</span>
            <span style={{fontSize:7,color:"#333"}}>{new Date(l.created_at).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function AffiliatedBizManager({ showToast, isAdmin }) {
  const [bizList, setBizList] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({entity_name:"",business_type:"general",license_info:"",location:"Naples, FL",owner_name:"Kenneth Wolf",ownership_pct:"100%",fee_structure:"",extra_info:""});
  const [saving, setSaving] = useState(false);

  useEffect(()=>{ loadBiz(); },[]);
  const loadBiz = ()=>{ sb("vault_affiliated_businesses","GET",null,"?order=sort_order").then(r=>{ if(r) setBizList(r); }); };

  const BIZ_TYPES = [{v:"mortgage",l:"Mortgage"},{v:"real_estate",l:"Real Estate"},{v:"insurance",l:"Insurance"},{v:"tax",l:"Tax/Accounting"},{v:"credit",l:"Credit"},{v:"title",l:"Title"},{v:"construction",l:"Construction"},{v:"hha",l:"HHA"},{v:"general",l:"General"}];

  const handleSave = async ()=>{
    if(!form.entity_name){ showToast("Entity name required"); return; }
    setSaving(true);
    if(editing){
      await sb("vault_affiliated_businesses","PATCH",{...form},`?id=eq.${editing}`);
    } else {
      await sb("vault_affiliated_businesses","POST",{...form,sort_order:bizList.length+1,is_active:true});
    }
    setSaving(false); setShowAdd(false); setEditing(null);
    setForm({entity_name:"",business_type:"general",license_info:"",location:"Naples, FL",owner_name:"Kenneth Wolf",ownership_pct:"100%",fee_structure:"",extra_info:""});
    loadBiz(); showToast(editing?"Business updated":"Business added");
  };

  const toggleActive = async (b)=>{
    await sb("vault_affiliated_businesses","PATCH",{is_active:!b.is_active},`?id=eq.${b.id}`);
    loadBiz(); showToast(b.is_active?"Business deactivated":"Business reactivated");
  };

  const startEdit = (b)=>{
    setForm({entity_name:b.entity_name,business_type:b.business_type,license_info:b.license_info||"",location:b.location||"Naples, FL",owner_name:b.owner_name||"Kenneth Wolf",ownership_pct:b.ownership_pct||"100%",fee_structure:b.fee_structure||"",extra_info:b.extra_info||""});
    setEditing(b.id); setShowAdd(true);
  };

  const SS={background:"#0d0d18",border:"1px solid #1e1e28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"6px 10px",borderRadius:3,width:"100%"};

  return (
    <div style={{marginBottom:16}}>
      <div style={{borderBottom:"1px solid #1a1a28",margin:"8px 0 16px"}} />
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37"}}>AFFILIATED BUSINESSES</div>
        {isAdmin&&<button onClick={()=>{setShowAdd(!showAdd);setEditing(null);setForm({entity_name:"",business_type:"general",license_info:"",location:"Naples, FL",owner_name:"Kenneth Wolf",ownership_pct:"100%",fee_structure:"",extra_info:""});}} style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.25)",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 10px",borderRadius:3,letterSpacing:".08em"}}>{showAdd?"CANCEL":"+ ADD BUSINESS"}</button>}
      </div>
      <div style={{fontSize:8,color:"#444",marginBottom:10}}>These entities auto-populate the ABA Disclosure form. Add or remove businesses anytime — forms update automatically.</div>

      {showAdd&&(
        <div style={{background:"#0a0a14",border:"1px solid rgba(212,175,55,.15)",borderRadius:6,padding:14,marginBottom:12}}>
          <div style={{fontSize:9,color:"#d4af37",letterSpacing:".1em",marginBottom:8}}>{editing?"EDIT":"NEW"} AFFILIATED ENTITY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>ENTITY NAME *</div><input value={form.entity_name} onChange={e=>setForm(p=>({...p,entity_name:e.target.value}))} placeholder="Alda Group LLC dba Laenan" style={SS}/></div>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>BUSINESS TYPE</div><select value={form.business_type} onChange={e=>setForm(p=>({...p,business_type:e.target.value}))} style={SS}>{BIZ_TYPES.map(t=><option key={t.v} value={t.v}>{t.l}</option>)}</select></div>
            <div style={{gridColumn:"1/-1"}}><div style={{fontSize:7,color:"#555",marginBottom:2}}>LICENSE / DESCRIPTION</div><input value={form.license_info} onChange={e=>setForm(p=>({...p,license_info:e.target.value}))} placeholder="Mortgage Brokerage (NMLS ID #2497125)" style={SS}/></div>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>LOCATION</div><input value={form.location} onChange={e=>setForm(p=>({...p,location:e.target.value}))} style={SS}/></div>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>OWNER</div><input value={form.owner_name} onChange={e=>setForm(p=>({...p,owner_name:e.target.value}))} style={SS}/></div>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>OWNERSHIP %</div><input value={form.ownership_pct} onChange={e=>setForm(p=>({...p,ownership_pct:e.target.value}))} style={SS}/></div>
            <div><div style={{fontSize:7,color:"#555",marginBottom:2}}>FEE STRUCTURE</div><input value={form.fee_structure} onChange={e=>setForm(p=>({...p,fee_structure:e.target.value}))} placeholder="Up to 3% of loan amount" style={SS}/></div>
            <div style={{gridColumn:"1/-1"}}><div style={{fontSize:7,color:"#555",marginBottom:2}}>EXTRA INFO (optional)</div><input value={form.extra_info} onChange={e=>setForm(p=>({...p,extra_info:e.target.value}))} placeholder="Third Party Processor Fee: Up to $2,000" style={SS}/></div>
          </div>
          <button onClick={handleSave} disabled={saving} style={{marginTop:10,padding:"6px 20px",background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",borderRadius:3,cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600}}>{saving?"SAVING...":(editing?"UPDATE":"ADD ENTITY")}</button>
        </div>
      )}

      {bizList.map((b,i)=>(
        <div key={b.id} style={{background:b.is_active?"#0d0d18":"#0a0a12",border:`1px solid ${b.is_active?"#1e1e28":"#151520"}`,borderRadius:4,padding:"8px 12px",marginBottom:4,opacity:b.is_active?1:.5,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{flex:1}}>
            <div style={{fontSize:11,color:b.is_active?"#e0dcd0":"#555"}}><span style={{color:"#d4af37",marginRight:6}}>{i+1}.</span>{b.entity_name}</div>
            <div style={{fontSize:8,color:"#444"}}>{b.license_info||b.business_type} · {b.location} · {b.ownership_pct} · {b.fee_structure}</div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>startEdit(b)} style={{background:"none",border:"1px solid #1e1e28",color:"#888",fontSize:7,padding:"2px 6px",borderRadius:2,cursor:"pointer",fontFamily:"inherit"}}>Edit</button>
            <button onClick={()=>toggleActive(b)} style={{background:"none",border:"1px solid #1e1e28",color:b.is_active?"#ef4444":"#10b981",fontSize:7,padding:"2px 6px",borderRadius:2,cursor:"pointer",fontFamily:"inherit"}}>{b.is_active?"Deactivate":"Activate"}</button>
          </div>
        </div>
      ))}
      {bizList.length===0&&<div style={{textAlign:"center",padding:20,color:"#2a2a3a",fontSize:9}}>No affiliated businesses yet</div>}
    </div>
  );
}

function SettingsView({ user, teamProfile, isAdmin, spend, showToast }) {
  const [team, setTeam] = useState([]);
  const [mailCfg, setMailCfg] = useState({email:"",password:"",display_name:"",imap_host:"imap.hostinger.com",imap_port:"993",smtp_host:"smtp.hostinger.com",smtp_port:"465"});
  const [showInvite, setShowInvite] = useState(false);
  const [invEmail, setInvEmail] = useState("");
  const [invName, setInvName] = useState("");
  const [invRole, setInvRole] = useState("employee");
  const [inviting, setInviting] = useState(false);
  const [invResult, setInvResult] = useState(null);
  const [saving, setSaving] = useState(false);
  // API management
  const [apis, setApis] = useState([]);
  const [showAddApi, setShowAddApi] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [newApi, setNewApi] = useState({name:"",slug:"",description:"",category:"general",base_url:"",api_key:""});
  const [addingApi, setAddingApi] = useState(false);
  const [apiFilter, setApiFilter] = useState("all");

  const loadApis = useCallback(()=>{
    sb("vault_apis","GET",null,"?order=created_at").then(a=>{ if(a) setApis(a); });
  },[]);

  useEffect(()=>{
    loadApis();
    if (isAdmin) fetchAllTeam().then(t=>{ if(t) setTeam(t); });
    if (teamProfile) setMailCfg({
      email: teamProfile.mail_user||teamProfile.email||"",
      password: teamProfile.mail_pass||"",
      display_name: teamProfile.display_name||"",
      imap_host: teamProfile.imap_host||"imap.hostinger.com",
      imap_port: String(teamProfile.imap_port||993),
      smtp_host: teamProfile.smtp_host||"smtp.hostinger.com",
      smtp_port: String(teamProfile.smtp_port||465),
    });
  },[isAdmin, teamProfile]);

  const handleSaveMail = async ()=>{
    if (!teamProfile?.id) { showToast("No team profile found"); return; }
    setSaving(true);
    await updateTeamMember(teamProfile.id, {
      mail_user: mailCfg.email,
      mail_pass: mailCfg.password,
      display_name: mailCfg.display_name,
      imap_host: mailCfg.imap_host,
      imap_port: parseInt(mailCfg.imap_port)||993,
      smtp_host: mailCfg.smtp_host,
      smtp_port: parseInt(mailCfg.smtp_port)||465,
    });
    setSaving(false);
    showToast("Settings saved");
  };

  const handleInvite = async ()=>{
    if (!invEmail||!invName) return;
    setInviting(true); setInvResult(null);
    const res = await inviteTeamMember(invEmail, invName, invRole, user.id);
    setInviting(false);
    if (res.error) { setInvResult({error:res.error}); return; }
    setInvResult({pass:res.tempPass});
    fetchAllTeam().then(t=>{ if(t) setTeam(t); });
    setInvEmail(""); setInvName("");
  };

  const roleColors = {super_admin:"#d4af37",admin:"#8b5cf6",moderator:"#6366f1",user:"#10b981",employee:"#3b82f6"};
  const isOnline = m => m.last_seen_at && (Date.now()-new Date(m.last_seen_at).getTime()) < 120000;

  // Google Drive state
  const [drives, setDrives] = useState([]);
  const [driveFolders, setDriveFolders] = useState([]);
  const [showAddDrive, setShowAddDrive] = useState(false);
  const [driveEmail, setDriveEmail] = useState("");
  const [businesses, setBiz] = useState([]);

  useEffect(()=>{
    sb("vault_google_drives","GET",null,`?owner_id=eq.${user.id}&order=created_at`).then(d=>{ if(d) setDrives(d); });
    sb("vault_drive_folders","GET",null,"?order=created_at").then(f=>{ if(f) setDriveFolders(f); });
    sb("businesses","GET",null,"?order=name").then(b=>{ if(b) setBiz(b); });
  },[user.id]);

  return (
    <div style={{flex:1,overflow:"auto",padding:24,maxWidth:620}}>
      {/* ── TEAM MANAGEMENT (admin only) ── */}
      {isAdmin&&(<>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:4}}>TEAM</div>
        <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:14}}>MANAGE EMPLOYEES & ACCESS</div>
        <div style={{background:"#07070e",border:"1px solid #1a1a28",borderRadius:5,padding:"12px 14px",marginBottom:12}}>
          {team.map(m=>{
            const online = isOnline(m);
            return (
            <div key={m.id} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"7px 0",borderBottom:"1px solid #0e0e18"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:7,height:7,borderRadius:"50%",background:online?"#10b981":"#333",flexShrink:0,boxShadow:online?"0 0 6px rgba(16,185,129,.5)":"none"}} title={online?"Online":"Offline"} />
                <span style={{fontSize:11,color:"#e0dcd0"}}>{m.display_name||m.email}</span>
                <span style={{fontSize:8,color:"#444"}}>{m.email}</span>
                {online&&<span style={{fontSize:7,color:"#10b981",letterSpacing:".06em"}}>ONLINE</span>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:7,color:roleColors[m.role]||"#555",background:`${roleColors[m.role]||"#555"}15`,border:`1px solid ${roleColors[m.role]||"#555"}33`,padding:"1px 6px",borderRadius:2,textTransform:"uppercase",letterSpacing:".08em"}}>{m.role?.replace("_"," ")}</span>
                <span style={{fontSize:7,color:m.status==="active"?"#10b981":"#f59e0b",background:m.status==="active"?"rgba(16,185,129,.08)":"rgba(245,158,11,.08)",padding:"1px 5px",borderRadius:2}}>{m.status}</span>
              </div>
            </div>
            );
          })}
          {team.length===0&&<div style={{fontSize:9,color:"#2a2a3a",padding:8,textAlign:"center"}}>No team members yet</div>}
        </div>
        <button onClick={()=>{setShowInvite(!showInvite);setInvResult(null);}} style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.25)",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:10,padding:"6px 14px",borderRadius:3,letterSpacing:".1em",marginBottom:12}}>
          {showInvite?"CANCEL":"+ INVITE MEMBER"}
        </button>
        {showInvite&&(
          <div style={{background:"#0a0a16",border:"1px solid #1e1e28",borderRadius:5,padding:14,marginBottom:16}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
              <Fld label="EMAIL"><Inp value={invEmail} onChange={v=>setInvEmail(v)} placeholder="employee@company.com" /></Fld>
              <Fld label="DISPLAY NAME"><Inp value={invName} onChange={v=>setInvName(v)} placeholder="Full Name" /></Fld>
            </div>
            <Fld label="ROLE">
              <select value={invRole} onChange={e=>setInvRole(e.target.value)} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#d4af37",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}}>
                <option value="employee">Employee</option>
                <option value="user">User</option>
                <option value="moderator">Moderator</option>
                <option value="admin">Admin</option>
              </select>
            </Fld>
            <button onClick={handleInvite} disabled={inviting||!invEmail||!invName} style={{background:inviting?"#333":"#d4af37",color:"#000",border:"none",borderRadius:3,padding:"8px 18px",cursor:inviting?"wait":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".1em"}}>{inviting?"INVITING...":"SEND INVITE"}</button>
            {invResult?.error&&<div style={{marginTop:8,fontSize:10,color:"#ef4444",background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",padding:"6px 10px",borderRadius:3}}>{invResult.error}</div>}
            {invResult?.pass&&(
              <div style={{marginTop:8,background:"rgba(16,185,129,.06)",border:"1px solid rgba(16,185,129,.2)",borderRadius:4,padding:"10px 12px"}}>
                <div style={{fontSize:9,color:"#10b981",marginBottom:4}}>INVITE SUCCESSFUL</div>
                <div style={{fontSize:10,color:"#e0dcd0",marginBottom:2}}>Temporary password:</div>
                <div style={{fontFamily:"monospace",fontSize:13,color:"#d4af37",background:"#0a0a14",padding:"6px 10px",borderRadius:3,userSelect:"all",letterSpacing:".05em"}}>{invResult.pass}</div>
                <div style={{fontSize:8,color:"#444",marginTop:4}}>Share this with the employee. They should change it after first login.</div>
              </div>
            )}
          </div>
        )}
        <div style={{borderBottom:"1px solid #1a1a28",margin:"16px 0"}} />
      </>)}

      {/* ── EMAIL CONFIG ── */}
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:4}}>EMAIL CONFIG</div>
      <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:14}}>SMTP / IMAP · YOUR MAIL ACCOUNT</div>
      <Fld label="MAIL EMAIL"><Inp value={mailCfg.email} onChange={v=>setMailCfg(p=>({...p,email:v}))} placeholder="you@domain.com" /></Fld>
      <Fld label="MAIL PASSWORD"><Inp type="password" value={mailCfg.password} onChange={v=>setMailCfg(p=>({...p,password:v}))} placeholder="mail password" /></Fld>
      <Fld label="DISPLAY NAME"><Inp value={mailCfg.display_name} onChange={v=>setMailCfg(p=>({...p,display_name:v}))} placeholder="Your Name" /></Fld>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 14px"}}>
        <Fld label="IMAP HOST"><Inp value={mailCfg.imap_host} onChange={v=>setMailCfg(p=>({...p,imap_host:v}))} /></Fld>
        <Fld label="IMAP PORT"><Inp value={mailCfg.imap_port} onChange={v=>setMailCfg(p=>({...p,imap_port:v}))} /></Fld>
        <Fld label="SMTP HOST"><Inp value={mailCfg.smtp_host} onChange={v=>setMailCfg(p=>({...p,smtp_host:v}))} /></Fld>
        <Fld label="SMTP PORT"><Inp value={mailCfg.smtp_port} onChange={v=>setMailCfg(p=>({...p,smtp_port:v}))} /></Fld>
      </div>
      <button onClick={handleSaveMail} disabled={saving} style={{background:saving?"#333":"#d4af37",color:"#000",border:"none",borderRadius:4,cursor:saving?"wait":"pointer",fontFamily:"inherit",fontSize:11,fontWeight:600,letterSpacing:".15em",padding:"10px 20px",marginBottom:20}}>{saving?"SAVING...":"SAVE & CONNECT"}</button>

      {/* ── STATUS PANELS ── */}
      <div style={{borderBottom:"1px solid #1a1a28",margin:"8px 0 16px"}} />
      <div style={{background:"#07070e",border:"1px solid #1a1a28",borderRadius:5,padding:"13px 15px",marginBottom:16}}>
        <div style={{fontSize:8,color:"#10b981",letterSpacing:".1em",marginBottom:8}}>SUPABASE CONNECTED</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:4,fontSize:9,color:"#444",lineHeight:2}}>
          <span>Project</span><span style={{color:"#666"}}>sfelhasepvaoianyuvxe</span>
          <span>Tables</span><span style={{color:"#555",fontSize:8}}>businesses · contacts · crm_deals · crm_pipelines · crm_tasks · crm_activities · documents · email_intelligence · marketing_campaigns · vault_emails · vault_team</span>
        </div>
      </div>
      <div style={{background:"#07070e",border:"1px solid rgba(139,92,246,.2)",borderRadius:5,padding:"13px 15px",marginBottom:16}}>
        <div style={{fontSize:8,color:"#8b5cf6",letterSpacing:".1em",marginBottom:6}}>CLAUDE AI</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:4,fontSize:9,color:"#444",lineHeight:2}}>
          <span>Model</span><span style={{color:"#666"}}>claude-sonnet-4-20250514</span>
          <span>Session Calls</span><span style={{color:"#a78bfa"}}>{spend.calls}</span>
          <span>Est. Cost</span><span style={{color:Number(spend.estUSD)>.10?"#f59e0b":"#666"}}>${spend.estUSD}</span>
        </div>
      </div>
      {/* ── AFFILIATED BUSINESSES ── */}
      <AffiliatedBizManager showToast={showToast} isAdmin={isAdmin} />
      {/* ── API MANAGEMENT ── */}
      <div style={{borderBottom:"1px solid #1a1a28",margin:"8px 0 16px"}} />
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37"}}>API INTEGRATIONS</div>
        <div style={{display:"flex",gap:6}}>
          <button onClick={()=>{setShowSuggestions(!showSuggestions);setShowAddApi(false);}} style={{background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.25)",color:"#6366f1",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 10px",borderRadius:3,letterSpacing:".08em"}}>{showSuggestions?"HIDE":"MARKETPLACE"}</button>
          {isAdmin&&<button onClick={()=>{setShowAddApi(!showAddApi);setShowSuggestions(false);}} style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.25)",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 10px",borderRadius:3,letterSpacing:".08em"}}>{showAddApi?"CANCEL":"+ CUSTOM API"}</button>}
        </div>
      </div>
      <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:12}}>CONNECTED SERVICES & DATA SOURCES</div>

      {/* Active APIs */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
        {apis.map(api=>{
          const catColors = {"ai":"#8b5cf6","finance":"#d4af37","news":"#6366f1","real-estate":"#3b82f6","marketing":"#f43f5e","accounting":"#10b981","operations":"#f59e0b","credit":"#00A44B","construction":"#FF8C00","general":"#555"};
          const c = catColors[api.category]||"#555";
          return (
            <div key={api.id} style={{background:"#0a0a14",border:`1px solid ${c}22`,borderRadius:4,padding:"9px 11px",opacity:api.enabled?1:.5}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:3}}>
                <span style={{fontSize:10,color:c,fontWeight:500}}>{api.name}</span>
                <div style={{display:"flex",gap:4,alignItems:"center"}}>
                  {api.base_url==="via n8n proxy"&&<span style={{fontSize:7,background:"rgba(16,185,129,.1)",color:"#10b981",border:"1px solid rgba(16,185,129,.2)",borderRadius:2,padding:"1px 5px"}}>N8N</span>}
                  <button onClick={async()=>{
                    await sb("vault_apis","PATCH",{enabled:!api.enabled,updated_at:new Date().toISOString()},`?id=eq.${api.id}`);
                    loadApis();
                    showToast(api.enabled?"API disabled":"API enabled");
                  }} style={{fontSize:7,background:api.enabled?"rgba(16,185,129,.1)":"rgba(239,68,68,.1)",color:api.enabled?"#10b981":"#ef4444",border:`1px solid ${api.enabled?"rgba(16,185,129,.2)":"rgba(239,68,68,.2)"}`,borderRadius:2,padding:"1px 5px",cursor:"pointer",fontFamily:"inherit"}}>{api.enabled?"ON":"OFF"}</button>
                </div>
              </div>
              <div style={{fontSize:7,color:"#444",lineHeight:1.5}}>{api.description}</div>
              <div style={{fontSize:7,color:"#2a2a3a",marginTop:2,textTransform:"uppercase",letterSpacing:".08em"}}>{api.category}</div>
            </div>
          );
        })}
      </div>

      {/* Add Custom API Form */}
      {showAddApi&&(
        <div style={{background:"#0a0a16",border:"1px solid #1e1e28",borderRadius:5,padding:14,marginBottom:16}}>
          <div style={{fontSize:9,color:"#d4af37",letterSpacing:".1em",marginBottom:10}}>ADD CUSTOM API</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Fld label="NAME"><Inp value={newApi.name} onChange={v=>setNewApi(p=>({...p,name:v}))} placeholder="API Name" /></Fld>
            <Fld label="SLUG (unique ID)"><Inp value={newApi.slug} onChange={v=>setNewApi(p=>({...p,slug:v.toLowerCase().replace(/[^a-z0-9-]/g,"")}))} placeholder="my-api" /></Fld>
          </div>
          <Fld label="DESCRIPTION"><Inp value={newApi.description} onChange={v=>setNewApi(p=>({...p,description:v}))} placeholder="What does this API do?" /></Fld>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"0 12px"}}>
            <Fld label="BASE URL"><Inp value={newApi.base_url} onChange={v=>setNewApi(p=>({...p,base_url:v}))} placeholder="https://api.example.com/v1" /></Fld>
            <Fld label="CATEGORY">
              <select value={newApi.category} onChange={e=>setNewApi(p=>({...p,category:e.target.value}))} style={{width:"100%",background:"#0d0d18",border:"1px solid #1e1e28",color:"#d4af37",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3}}>
                {["general","real-estate","finance","mortgage","credit","marketing","accounting","construction","operations","ai"].map(c=><option key={c} value={c}>{c}</option>)}
              </select>
            </Fld>
          </div>
          <Fld label="API KEY"><Inp type="password" value={newApi.api_key} onChange={v=>setNewApi(p=>({...p,api_key:v}))} placeholder="sk-..." /></Fld>
          <button onClick={async()=>{
            if(!newApi.name||!newApi.slug){showToast("Name and slug required");return;}
            setAddingApi(true);
            const exists = apis.find(a=>a.slug===newApi.slug);
            if(exists){showToast("Slug already exists");setAddingApi(false);return;}
            await sb("vault_apis","POST",{...newApi,added_by:user.id});
            setAddingApi(false);
            setNewApi({name:"",slug:"",description:"",category:"general",base_url:"",api_key:""});
            loadApis();
            showToast("API added");
            setShowAddApi(false);
          }} disabled={addingApi} style={{background:addingApi?"#333":"#d4af37",color:"#000",border:"none",borderRadius:3,padding:"8px 18px",cursor:addingApi?"wait":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".1em"}}>{addingApi?"ADDING...":"ADD API"}</button>
        </div>
      )}

      {/* API Marketplace / Suggestions */}
      {showSuggestions&&(
        <div style={{background:"#07070e",border:"1px solid rgba(99,102,241,.15)",borderRadius:5,padding:14,marginBottom:16}}>
          <div style={{fontSize:9,color:"#6366f1",letterSpacing:".1em",marginBottom:4}}>API MARKETPLACE</div>
          <div style={{fontSize:8,color:"#333",marginBottom:10}}>Recommended integrations for your mortgage, real estate, credit & construction businesses</div>
          <div style={{display:"flex",gap:4,marginBottom:10,flexWrap:"wrap"}}>
            {["all","real-estate","finance","marketing","credit","accounting","construction","operations","ai"].map(c=>(
              <button key={c} onClick={()=>setApiFilter(c)} style={{background:apiFilter===c?"rgba(99,102,241,.15)":"none",border:`1px solid ${apiFilter===c?"rgba(99,102,241,.3)":"#1a1a28"}`,color:apiFilter===c?"#6366f1":"#444",cursor:"pointer",fontFamily:"inherit",fontSize:7,padding:"2px 7px",borderRadius:2,letterSpacing:".06em",textTransform:"uppercase"}}>{c}</button>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr",gap:8,maxHeight:400,overflow:"auto"}}>
            {API_SUGGESTIONS.filter(s=>apiFilter==="all"||s.cat===apiFilter).filter(s=>!apis.find(a=>a.slug===s.slug)).map(s=>(
              <div key={s.slug} style={{background:"#0a0a14",border:`1px solid ${s.color}18`,borderRadius:4,padding:"10px 12px",display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:3}}>
                    <span style={{fontSize:14}}>{s.icon}</span>
                    <span style={{fontSize:11,color:s.color,fontWeight:500}}>{s.name}</span>
                    <span style={{fontSize:7,color:"#333",textTransform:"uppercase",letterSpacing:".06em",background:"#0d0d18",padding:"1px 5px",borderRadius:2}}>{s.cat}</span>
                  </div>
                  <div style={{fontSize:8,color:"#555",lineHeight:1.5,marginBottom:3}}>{s.desc}</div>
                  <div style={{fontSize:8,color:"#d4af37",lineHeight:1.4}}>Why: {s.why}</div>
                </div>
                <button onClick={async()=>{
                  await sb("vault_apis","POST",{name:s.name,slug:s.slug,description:s.desc,category:s.cat,base_url:"",api_key:"",enabled:false,added_by:user.id});
                  loadApis();
                  showToast(`${s.name} added — configure API key to activate`);
                }} style={{background:"rgba(99,102,241,.1)",border:"1px solid rgba(99,102,241,.25)",color:"#6366f1",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"5px 10px",borderRadius:3,letterSpacing:".06em",whiteSpace:"nowrap",flexShrink:0}}>+ ADD</button>
              </div>
            ))}
            {API_SUGGESTIONS.filter(s=>apiFilter==="all"||s.cat===apiFilter).filter(s=>!apis.find(a=>a.slug===s.slug)).length===0&&(
              <div style={{textAlign:"center",padding:20,color:"#2a2a3a",fontSize:9}}>All suggestions in this category are already added</div>
            )}
          </div>
        </div>
      )}

      {/* ── GOOGLE DRIVE INTEGRATION ── */}
      {isAdmin&&(<>
        <div style={{borderBottom:"1px solid #1a1a28",margin:"8px 0 16px"}} />
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37"}}>GOOGLE DRIVE</div>
          <button onClick={()=>setShowAddDrive(!showAddDrive)} style={{background:"rgba(66,133,244,.08)",border:"1px solid rgba(66,133,244,.25)",color:"#4285F4",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 10px",borderRadius:3,letterSpacing:".08em"}}>{showAddDrive?"CANCEL":"+ ADD DRIVE"}</button>
        </div>
        <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:12}}>CONNECT MULTIPLE GOOGLE DRIVE ACCOUNTS · ASSIGN FOLDERS PER BUSINESS</div>

        {/* Connected drives */}
        {drives.map(d=>{
          const folders = driveFolders.filter(f=>f.drive_id===d.id);
          return (
            <div key={d.id} style={{background:"#0a0a14",border:"1px solid rgba(66,133,244,.15)",borderRadius:5,padding:"12px 14px",marginBottom:10}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:6}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14}}>📁</span>
                  <span style={{fontSize:11,color:"#4285F4"}}>{d.account_email}</span>
                  <span style={{fontSize:7,color:d.is_active?"#10b981":"#ef4444",background:d.is_active?"rgba(16,185,129,.08)":"rgba(239,68,68,.08)",padding:"1px 5px",borderRadius:2}}>{d.is_active?"CONNECTED":"DISCONNECTED"}</span>
                </div>
                <button onClick={async()=>{
                  await sb("vault_google_drives","PATCH",{is_active:!d.is_active},`?id=eq.${d.id}`);
                  setDrives(p=>p.map(x=>x.id===d.id?{...x,is_active:!x.is_active}:x));
                }} style={{fontSize:7,background:"none",border:"1px solid #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",padding:"2px 6px",borderRadius:2}}>{d.is_active?"DISCONNECT":"RECONNECT"}</button>
              </div>
              {/* Business folder mappings */}
              <div style={{fontSize:8,color:"#444",marginBottom:4,letterSpacing:".06em"}}>BUSINESS FOLDER MAPPINGS</div>
              {businesses.length>0 ? businesses.map(biz=>{
                const mapping = folders.find(f=>f.business_id===biz.id);
                return (
                  <div key={biz.id} style={{display:"flex",alignItems:"center",gap:8,padding:"3px 0",borderBottom:"1px solid #0e0e18"}}>
                    <span style={{fontSize:9,color:"#e0dcd0",minWidth:120}}>{biz.name}</span>
                    <input placeholder="Google Drive Folder ID" value={mapping?.folder_id||""} onChange={async(e)=>{
                      const fid = e.target.value;
                      if(mapping) {
                        await sb("vault_drive_folders","PATCH",{folder_id:fid},`?id=eq.${mapping.id}`);
                        setDriveFolders(p=>p.map(x=>x.id===mapping.id?{...x,folder_id:fid}:x));
                      } else if(fid) {
                        const r = await sb("vault_drive_folders","POST",{drive_id:d.id,business_id:biz.id,folder_id:fid,folder_name:biz.name});
                        if(r?.[0]) setDriveFolders(p=>[...p,r[0]]);
                      }
                    }} style={{flex:1,background:"#0d0d18",border:"1px solid #1e1e28",color:"#888",fontFamily:"inherit",fontSize:9,padding:"4px 8px",borderRadius:2,outline:"none"}} />
                    {mapping&&<span style={{fontSize:7,color:"#10b981"}}>✓</span>}
                  </div>
                );
              }) : <div style={{fontSize:8,color:"#2a2a3a",padding:4}}>Add businesses first to map folders</div>}
            </div>
          );
        })}

        {drives.length===0&&!showAddDrive&&<div style={{textAlign:"center",padding:30,color:"#2a2a3a",fontSize:9}}>No Google Drive accounts connected</div>}

        {showAddDrive&&(
          <div style={{background:"#0a0a16",border:"1px solid #1e1e28",borderRadius:5,padding:14,marginBottom:16}}>
            <div style={{fontSize:9,color:"#4285F4",letterSpacing:".1em",marginBottom:8}}>ADD GOOGLE DRIVE ACCOUNT</div>
            <div style={{fontSize:8,color:"#444",marginBottom:10,lineHeight:1.6}}>
              To connect Google Drive, you'll need to set up OAuth in Google Cloud Console and provide the credentials. For now, enter the Google account email to register it.
            </div>
            <Fld label="GOOGLE ACCOUNT EMAIL"><Inp value={driveEmail} onChange={v=>setDriveEmail(v)} placeholder="your-account@gmail.com" /></Fld>
            <button onClick={async()=>{
              if(!driveEmail) return;
              const r = await sb("vault_google_drives","POST",{owner_id:user.id,account_email:driveEmail,is_active:true});
              if(r?.[0]) setDrives(p=>[...p,r[0]]);
              setDriveEmail("");
              setShowAddDrive(false);
              showToast("Drive account added — configure OAuth to enable sync");
            }} style={{background:"#4285F4",color:"#fff",border:"none",borderRadius:3,padding:"8px 18px",cursor:"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".1em"}}>ADD DRIVE</button>
          </div>
        )}

        {/* Client Document Links */}
        <div style={{fontSize:8,color:"#333",letterSpacing:".08em",marginTop:8,marginBottom:6}}>CLIENT DOC SUBMISSION LINKS</div>
        <div style={{fontSize:8,color:"#444",lineHeight:1.6,background:"#0a0a14",border:"1px solid #1a1a28",borderRadius:4,padding:"10px 12px"}}>
          Auto-generated unique links for each client allow them to submit documents directly to their assigned Google Drive folder. Links are created when you add a contact and assign them to a business with a mapped drive folder.
        </div>

        {/* ── TELEGRAM BOT CONFIG ── */}
        <div style={{borderBottom:"1px solid #1a1a28",margin:"16px 0"}} />
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:4}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37"}}>TELEGRAM BOT</div>
        </div>
        <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:12}}>BIDIRECTIONAL NOTIFICATIONS · REPLY FROM TELEGRAM</div>
        <TelegramConfig user={user} showToast={showToast} />

        {/* ── AUDIT LOG ── */}
        <div style={{borderBottom:"1px solid #1a1a28",margin:"16px 0"}} />
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:4}}>AUDIT LOG</div>
        <div style={{fontSize:8,color:"#333",letterSpacing:".1em",marginBottom:12}}>ALL ACTIONS ACROSS THE PLATFORM</div>
        <AuditLogPanel user={user} />
      </>)}
    </div>
  );
}

// ─── MESSAGES VIEW (internal messaging between employees & admin) ─────────
function MessagesView({ user, teamProfile, isAdmin, showToast }) {
  const KEN_ID = "b7a67688-73f1-4f4b-9745-f357e81affa3";
  const [msgs, setMsgs] = useState([]);
  const [team, setTeam] = useState([]);
  const [chatWith, setChatWith] = useState(isAdmin ? null : KEN_ID);
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const endRef = useRef(null);

  const load = useCallback(()=>{
    const q = isAdmin ? "?order=created_at.desc&limit=200" : `?or=(from_id.eq.${user.id},to_id.eq.${user.id})&order=created_at.desc&limit=200`;
    sb("vault_messages","GET",null,q).then(m=>{ if(m) setMsgs(m); });
    fetchAllTeam().then(t=>{ if(t) setTeam(t); });
  },[user.id,isAdmin]);

  useEffect(()=>{ load(); const iv=setInterval(load,8000); return()=>clearInterval(iv); },[load]);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[msgs,chatWith]);

  const memberName = id => { const m=team.find(t=>t.user_id===id); return m?.display_name||m?.email||"Unknown"; };
  const isOnline = m => m.last_seen_at && (Date.now()-new Date(m.last_seen_at).getTime()) < 120000;

  // For admin: group conversations by other user
  const convos = useMemo(()=>{
    if(!isAdmin) return [];
    const map = {};
    msgs.forEach(m=>{
      const other = m.from_id===user.id ? m.to_id : m.from_id;
      if(!map[other]) map[other]={userId:other,lastMsg:m,unread:0};
      if(!m.is_read && m.to_id===user.id) map[other].unread++;
    });
    return Object.values(map).sort((a,b)=>new Date(b.lastMsg.created_at)-new Date(a.lastMsg.created_at));
  },[msgs,user.id,isAdmin]);

  const chatMsgs = useMemo(()=>{
    if(!chatWith) return [];
    return msgs.filter(m=>(m.from_id===chatWith&&m.to_id===user.id)||(m.from_id===user.id&&m.to_id===chatWith)).reverse();
  },[msgs,chatWith,user.id]);

  const send = async ()=>{
    if(!body.trim()||!chatWith) return;
    setSending(true);
    const target = isAdmin ? chatWith : KEN_ID;
    await sb("vault_messages","POST",{from_id:user.id,to_id:target,body:body.trim()});
    if(!isAdmin) sendTelegram(`💬 <b>New Message</b>\nFrom: ${teamProfile?.display_name||user.email}\n"${body.trim().slice(0,200)}"`);
    setBody("");
    setSending(false);
    load();
  };

  // Mark messages read
  useEffect(()=>{
    if(!chatWith) return;
    const unread = chatMsgs.filter(m=>m.to_id===user.id&&!m.is_read);
    unread.forEach(m=>sb("vault_messages","PATCH",{is_read:true},`?id=eq.${m.id}`));
    if(unread.length) setMsgs(p=>p.map(m=>unread.find(u=>u.id===m.id)?{...m,is_read:true}:m));
  },[chatWith,chatMsgs,user.id]);

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Sidebar - conversations (admin sees all employees, employee sees only Ken) */}
      <div style={{width:240,borderRight:"1px solid #0e0e18",display:"flex",flexDirection:"column",flexShrink:0}}>
        <div style={{padding:"12px 14px",borderBottom:"1px solid #0e0e18"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:".15em",color:"#d4af37"}}>MESSAGES</div>
          <div style={{fontSize:8,color:"#333",letterSpacing:".08em"}}>{isAdmin?"ALL TEAM CONVERSATIONS":"CONTACT ADMIN"}</div>
        </div>
        <div style={{flex:1,overflow:"auto"}}>
          {isAdmin ? convos.map(c=>{
            const m = team.find(t=>t.user_id===c.userId);
            const online = m && isOnline(m);
            return (
              <div key={c.userId} onClick={()=>setChatWith(c.userId)} className="rh" style={{padding:"10px 14px",cursor:"pointer",borderBottom:"1px solid #0a0a14",background:chatWith===c.userId?"rgba(212,175,55,.06)":"none",borderLeft:chatWith===c.userId?"2px solid #d4af37":"2px solid transparent"}}>
                <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
                  <span style={{width:6,height:6,borderRadius:"50%",background:online?"#10b981":"#333",flexShrink:0}} />
                  <span style={{fontSize:10,color:"#e0dcd0"}}>{memberName(c.userId)}</span>
                  {c.unread>0&&<span style={{marginLeft:"auto",width:16,height:16,borderRadius:"50%",background:"#ef4444",fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>{c.unread}</span>}
                </div>
                <div style={{fontSize:8,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",paddingLeft:12}}>{c.lastMsg.body}</div>
              </div>
            );
          }) : (
            <div onClick={()=>setChatWith(KEN_ID)} className="rh" style={{padding:"10px 14px",cursor:"pointer",background:"rgba(212,175,55,.06)",borderLeft:"2px solid #d4af37"}}>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <span style={{width:6,height:6,borderRadius:"50%",background:team.find(t=>t.user_id===KEN_ID&&isOnline(t))?"#10b981":"#333"}} />
                <span style={{fontSize:10,color:"#d4af37"}}>Admin (Ken)</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {!chatWith ? (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
            <div style={{fontSize:32,opacity:.06}}>💬</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".2em",fontSize:12,color:"#1a1a2a"}}>SELECT A CONVERSATION</div>
          </div>
        ) : (<>
          <div style={{padding:"10px 16px",borderBottom:"1px solid #0e0e18",background:"#0b0b14",flexShrink:0}}>
            <span style={{fontSize:11,color:"#d4af37"}}>{memberName(chatWith)}</span>
            <span style={{fontSize:8,color:team.find(t=>t.user_id===chatWith&&isOnline(t))?"#10b981":"#444",marginLeft:8}}>{team.find(t=>t.user_id===chatWith&&isOnline(t))?"online":"offline"}</span>
          </div>
          <div style={{flex:1,overflow:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:6}}>
            {chatMsgs.map(m=>{
              const mine = m.from_id===user.id;
              return (
                <div key={m.id} style={{alignSelf:mine?"flex-end":"flex-start",maxWidth:"70%"}}>
                  <div style={{background:mine?"rgba(212,175,55,.12)":"rgba(255,255,255,.03)",border:`1px solid ${mine?"rgba(212,175,55,.2)":"#1a1a28"}`,borderRadius:8,padding:"8px 12px",fontSize:10,color:"#e0dcd0",lineHeight:1.5}}>{m.body}</div>
                  <div style={{fontSize:7,color:"#333",marginTop:2,textAlign:mine?"right":"left"}}>{new Date(m.created_at).toLocaleString()}</div>
                </div>
              );
            })}
            <div ref={endRef} />
          </div>
          <div style={{padding:"10px 16px",borderTop:"1px solid #0e0e18",display:"flex",gap:8,flexShrink:0}}>
            <input value={body} onChange={e=>setBody(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Type a message..." style={{flex:1,background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"8px 12px",outline:"none"}} />
            <button onClick={send} disabled={sending||!body.trim()} style={{background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",borderRadius:4,padding:"0 16px",cursor:sending?"wait":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".08em"}}>SEND</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── SMS / TEXTING VIEW ───────────────────────────────────────────────────────
function SMSView({ user, contacts, showToast }) {
  const [lines, setLines] = useState([]);
  const [selLine, setSelLine] = useState("all");
  const [messages, setMessages] = useState([]);
  const [convos, setConvos] = useState([]);
  const [selConvo, setSelConvo] = useState(null);
  const [thread, setThread] = useState([]);
  const [msgText, setMsgText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [convoSearch, setConvoSearch] = useState("");
  const [showRight, setShowRight] = useState(true);
  const [showAddLine, setShowAddLine] = useState(false);
  const [addLineTab, setAddLineTab] = useState("twilio");
  const [showNewConvo, setShowNewConvo] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newLineId, setNewLineId] = useState("");
  const [twilioConfig, setTwilioConfig] = useState(null);
  const [twilioSid, setTwilioSid] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [twilioPhone, setTwilioPhone] = useState("");
  const [twilioLabel, setTwilioLabel] = useState("");
  const [androidName, setAndroidName] = useState("");
  const [generatedToken, setGeneratedToken] = useState("");
  const [savingLine, setSavingLine] = useState(false);
  const threadRef = useRef(null);
  const pollRef = useRef(null);

  const WEBHOOK_BASE = SB_URL + "/functions/v1/sms-webhook";

  // ── Load lines ──
  useEffect(() => {
    (async () => {
      const l = await sb("vault_sms_lines", "GET", null, "?order=label.asc");
      setLines(l || []);
      // Load twilio config
      const cfg = await sb("vault_sms_config", "GET", null, "?limit=1");
      if (cfg && cfg.length) setTwilioConfig(cfg[0]);
    })();
  }, []);

  // ── Load messages when line changes ──
  useEffect(() => {
    loadMessages();
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(loadMessages, 15000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [selLine, lines]);

  async function loadMessages() {
    setLoading(true);
    try {
      let q = "?order=timestamp.desc&limit=5000";
      if (selLine !== "all") q += `&line_id=eq.${selLine}`;
      const m = await sb("vault_sms_messages", "GET", null, q);
      setMessages(m || []);
    } catch (e) { console.error("SMS load error:", e); }
    setLoading(false);
  }

  // ── Build conversations ──
  useEffect(() => {
    const map = {};
    (messages || []).forEach(m => {
      const other = m.direction === "outbound" ? m.to_number : m.from_number;
      const key = (selLine === "all") ? `${m.line_id}::${other}` : other;
      if (!map[key]) map[key] = { phone: other, line_id: m.line_id, messages: [], unread: 0, contactName: m.contact_name || null, contact_id: m.contact_id || null };
      map[key].messages.push(m);
      if (!m.is_read && m.direction === "inbound") map[key].unread++;
    });
    // Resolve contact names from contacts prop
    Object.values(map).forEach(c => {
      if (!c.contactName && contacts) {
        const match = contacts.find(ct => ct.phone === c.phone || ct.mobile === c.phone);
        if (match) { c.contactName = `${match.first_name || ""} ${match.last_name || ""}`.trim(); c.contact_id = match.id; }
      }
      c.lastMsg = c.messages[0];
      c.lastTime = c.messages[0]?.timestamp;
    });
    const sorted = Object.values(map).sort((a, b) => (b.lastTime || "").localeCompare(a.lastTime || ""));
    setConvos(sorted);
  }, [messages, selLine, contacts]);

  // ── Select conversation → build thread ──
  useEffect(() => {
    if (!selConvo) { setThread([]); return; }
    const t = (messages || []).filter(m => {
      const other = m.direction === "outbound" ? m.to_number : m.from_number;
      return other === selConvo.phone && (selLine === "all" ? m.line_id === selConvo.line_id : true);
    }).sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
    setThread(t);
    // Mark as read
    const unreadIds = t.filter(m => !m.is_read && m.direction === "inbound").map(m => m.id);
    if (unreadIds.length) {
      unreadIds.forEach(id => sb("vault_sms_messages", "PATCH", { is_read: true }, `?id=eq.${id}`));
    }
  }, [selConvo, messages, selLine]);

  // ── Auto-scroll ──
  useEffect(() => {
    if (threadRef.current) threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [thread]);

  // ── Send message ──
  async function sendMessage() {
    if (!msgText.trim() || !selConvo) return;
    const lineId = selConvo.line_id || selLine;
    if (!lineId || lineId === "all") { showToast("Select a line to send from", "error"); return; }
    setSending(true);
    try {
      const r = await fetch(WEBHOOK_BASE + "?action=send", {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: SB_KEY, Authorization: "Bearer " + SB_KEY },
        body: JSON.stringify({ line_id: lineId, to: selConvo.phone, body: msgText.trim() })
      });
      if (!r.ok) { const e = await r.text(); throw new Error(e); }
      setMsgText("");
      showToast("Message sent", "success");
      setTimeout(loadMessages, 1000);
    } catch (e) { showToast("Send failed: " + e.message, "error"); }
    setSending(false);
  }

  // ── Start new conversation ──
  function startNewConvo() {
    if (!newPhone.trim()) return;
    const lid = newLineId || (lines.length === 1 ? lines[0].id : null);
    if (!lid) { showToast("Select a line", "error"); return; }
    const phone = newPhone.trim().replace(/[^\d+]/g, "");
    const match = contacts?.find(c => c.phone === phone || c.mobile === phone);
    setSelConvo({ phone, line_id: lid, contactName: match ? `${match.first_name || ""} ${match.last_name || ""}`.trim() : null, contact_id: match?.id || null, messages: [], unread: 0 });
    setShowNewConvo(false);
    setNewPhone("");
    setNewLineId("");
  }

  // ── Save Twilio config ──
  async function saveTwilioConfig() {
    setSavingLine(true);
    try {
      if (twilioConfig) {
        await sb("vault_sms_config", "PATCH", { twilio_account_sid: twilioSid, twilio_auth_token: twilioToken }, `?id=eq.${twilioConfig.id}`);
      } else {
        const r = await sb("vault_sms_config", "POST", { twilio_account_sid: twilioSid, twilio_auth_token: twilioToken, webhook_url: WEBHOOK_BASE + "?source=twilio" });
        if (r && r.length) setTwilioConfig(r[0]);
      }
      showToast("Twilio config saved", "success");
    } catch (e) { showToast("Error saving config", "error"); }
    setSavingLine(false);
  }

  // ── Add Twilio number ──
  async function addTwilioLine() {
    if (!twilioPhone.trim()) return;
    setSavingLine(true);
    try {
      const r = await sb("vault_sms_lines", "POST", { label: twilioLabel || twilioPhone, phone_number: twilioPhone.trim(), type: "twilio", status: "active" });
      if (r && r.length) { setLines(p => [...p, r[0]]); showToast("Twilio line added", "success"); setTwilioPhone(""); setTwilioLabel(""); }
    } catch (e) { showToast("Error adding line", "error"); }
    setSavingLine(false);
  }

  // ── Add Android Gateway ──
  async function addAndroidLine() {
    if (!androidName.trim()) return;
    setSavingLine(true);
    const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    try {
      const r = await sb("vault_sms_lines", "POST", { label: androidName.trim(), phone_number: "pending", type: "android_gateway", device_name: androidName.trim(), api_token: token, status: "active" });
      if (r && r.length) { setLines(p => [...p, r[0]]); setGeneratedToken(token); showToast("Android gateway added", "success"); }
    } catch (e) { showToast("Error adding gateway", "error"); }
    setSavingLine(false);
  }

  function getLine(id) { return lines.find(l => l.id === id); }

  function charInfo(text) {
    const len = text.length;
    const segments = len <= 160 ? 1 : Math.ceil(len / 153);
    return `${len} chars · ${segments} segment${segments > 1 ? "s" : ""}`;
  }

  // ── Contact suggestions for new convo ──
  const contactSuggestions = useMemo(() => {
    if (!newPhone || newPhone.length < 2 || !contacts) return [];
    const q = newPhone.toLowerCase();
    return contacts.filter(c => {
      const name = `${c.first_name || ""} ${c.last_name || ""}`.toLowerCase();
      return name.includes(q) || (c.phone || "").includes(q) || (c.mobile || "").includes(q);
    }).slice(0, 8);
  }, [newPhone, contacts]);

  const filteredConvos = useMemo(() => {
    if (!convoSearch.trim()) return convos;
    const q = convoSearch.toLowerCase();
    return convos.filter(c => (c.contactName || "").toLowerCase().includes(q) || (c.phone || "").includes(q));
  }, [convos, convoSearch]);

  const selLineObj = selLine !== "all" ? getLine(selLine) : null;
  const convoLine = selConvo ? getLine(selConvo.line_id) : null;

  // ── Contact info for right panel ──
  const linkedContact = useMemo(() => {
    if (!selConvo || !contacts) return null;
    if (selConvo.contact_id) return contacts.find(c => c.id === selConvo.contact_id) || null;
    return contacts.find(c => c.phone === selConvo.phone || c.mobile === selConvo.phone) || null;
  }, [selConvo, contacts]);

  const threadStats = useMemo(() => {
    if (!thread.length) return null;
    return { total: thread.length, firstDate: thread[0]?.timestamp, inbound: thread.filter(m => m.direction === "inbound").length, outbound: thread.filter(m => m.direction === "outbound").length };
  }, [thread]);

  // ─── RENDER ────────────────────────────────────────────────────────────────────
  const panelStyle = { background: "#0a0a12", border: "1px solid #1e1e2e", borderRadius: 8, display: "flex", flexDirection: "column" };
  const surfaceStyle = { background: "#12121e", borderRadius: 6, border: "1px solid #1e1e2e" };
  const goldBtn = { background: "#d4af37", color: "#0a0a12", border: "none", borderRadius: 6, padding: "6px 16px", fontFamily: "'DM Mono',monospace", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  const ghostBtn = { background: "transparent", color: "#d4af37", border: "1px solid #d4af37", borderRadius: 6, padding: "5px 12px", fontFamily: "'DM Mono',monospace", fontSize: 12, cursor: "pointer" };
  const inputStyle = { background: "#12121e", border: "1px solid #1e1e2e", borderRadius: 6, color: "#e0dcd0", padding: "8px 10px", fontFamily: "'DM Mono',monospace", fontSize: 13, width: "100%", outline: "none" };

  return (
    <div style={{ display: "flex", gap: 8, height: "100%", fontFamily: "'DM Mono',monospace", color: "#e0dcd0" }}>
      {/* ── LEFT PANEL ── */}
      <div style={{ ...panelStyle, width: 240, minWidth: 240 }}>
        {/* Line selector */}
        <div style={{ padding: 10, borderBottom: "1px solid #1e1e2e" }}>
          <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>SMS Line</div>
          <select value={selLine} onChange={e => { setSelLine(e.target.value); setSelConvo(null); }} style={{ ...inputStyle, cursor: "pointer" }}>
            <option value="all">ALL LINES</option>
            {lines.map(l => <option key={l.id} value={l.id}>{l.label} ({l.phone_number}) {l.type === "twilio" ? "🔵" : "📱"}</option>)}
          </select>
          <button onClick={() => setShowAddLine(true)} style={{ ...ghostBtn, width: "100%", marginTop: 6, fontSize: 11 }}>➕ Add Line</button>
        </div>

        {/* Search + New */}
        <div style={{ padding: "6px 10px", borderBottom: "1px solid #1e1e2e", display: "flex", gap: 4 }}>
          <input placeholder="Search..." value={convoSearch} onChange={e => setConvoSearch(e.target.value)} style={{ ...inputStyle, padding: "5px 8px", fontSize: 12, flex: 1 }} />
          <button onClick={() => setShowNewConvo(true)} style={{ ...goldBtn, padding: "5px 10px", fontSize: 11 }}>New</button>
        </div>

        {/* Conversation list */}
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading && !convos.length && <div style={{ padding: 20, textAlign: "center", color: "#888", fontSize: 12 }}>Loading...</div>}
          {!loading && !convos.length && <div style={{ padding: 20, textAlign: "center", color: "#888", fontSize: 12 }}>No conversations yet</div>}
          {filteredConvos.map((c, i) => {
            const line = getLine(c.line_id);
            const isSel = selConvo && selConvo.phone === c.phone && selConvo.line_id === c.line_id;
            return (
              <div key={i} onClick={() => setSelConvo(c)} style={{ padding: "8px 10px", cursor: "pointer", borderBottom: "1px solid #1e1e2e", borderLeft: isSel ? "3px solid #d4af37" : "3px solid transparent", background: isSel ? "rgba(212,175,55,0.08)" : "transparent" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: isSel ? "#d4af37" : "#e0dcd0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{c.contactName || c.phone}</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {c.unread > 0 && <span style={{ background: "#d4af37", color: "#0a0a12", fontSize: 10, fontWeight: 700, borderRadius: 10, padding: "1px 6px", minWidth: 18, textAlign: "center" }}>{c.unread}</span>}
                    <span style={{ fontSize: 10 }}>{line?.type === "twilio" ? "🔵" : "📱"}</span>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "#888", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.lastMsg?.body?.slice(0, 40) || "..."}</div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
                  {c.lastTime ? new Date(c.lastTime).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
                  {selLine === "all" && line ? ` · ${line.label}` : ""}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── CENTER PANEL ── */}
      <div style={{ ...panelStyle, flex: 1, minWidth: 0 }}>
        {!selConvo ? (
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#555", fontSize: 14 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>📱</div>
              <div>Select a conversation or start a new one</div>
              <div style={{ fontSize: 12, marginTop: 4 }}>{lines.length} line{lines.length !== 1 ? "s" : ""} configured · {convos.length} conversation{convos.length !== 1 ? "s" : ""}</div>
            </div>
          </div>
        ) : (
          <>
            {/* Thread header */}
            <div style={{ padding: "10px 14px", borderBottom: "1px solid #1e1e2e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#d4af37" }}>{selConvo.contactName || selConvo.phone}</div>
                <div style={{ fontSize: 11, color: "#888" }}>
                  {selConvo.phone}{convoLine ? ` · via ${convoLine.label}` : ""}
                  <span style={{ marginLeft: 6 }}>{convoLine?.type === "twilio" ? "🔵 Twilio" : "📱 Android"}</span>
                </div>
              </div>
              <button onClick={() => setShowRight(p => !p)} style={{ ...ghostBtn, fontSize: 11, padding: "4px 10px" }}>{showRight ? "Hide ▶" : "◀ Info"}</button>
            </div>

            {/* Messages */}
            <div ref={threadRef} style={{ flex: 1, overflowY: "auto", padding: 14, display: "flex", flexDirection: "column", gap: 6 }}>
              {!thread.length && <div style={{ textAlign: "center", color: "#555", fontSize: 12, marginTop: 40 }}>No messages yet — send the first one!</div>}
              {thread.map(m => {
                const out = m.direction === "outbound";
                return (
                  <div key={m.id} style={{ display: "flex", justifyContent: out ? "flex-end" : "flex-start" }}>
                    <div style={{ maxWidth: "65%", padding: "8px 12px", borderRadius: 10, background: out ? "rgba(212,175,55,0.08)" : "#12121e", border: out ? "1px solid rgba(212,175,55,0.15)" : "1px solid #1e1e2e" }}>
                      <div style={{ fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{m.body}</div>
                      {m.media_urls && (() => {
                        try {
                          const urls = typeof m.media_urls === "string" ? JSON.parse(m.media_urls) : m.media_urls;
                          return (Array.isArray(urls) ? urls : []).map((u, i) => <img key={i} src={u} alt="" style={{ maxWidth: 200, borderRadius: 6, marginTop: 6, display: "block" }} />);
                        } catch { return null; }
                      })()}
                      <div style={{ fontSize: 10, color: "#555", marginTop: 4, textAlign: out ? "right" : "left" }}>
                        {m.timestamp ? new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                        {out && <span style={{ marginLeft: 6 }}>{m.status === "delivered" ? "✓✓" : m.status === "failed" ? "✗" : "✓"}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Input */}
            <div style={{ padding: 10, borderTop: "1px solid #1e1e2e" }}>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <textarea value={msgText} onChange={e => setMsgText(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }} placeholder="Type a message..." rows={1} style={{ ...inputStyle, flex: 1, resize: "none", minHeight: 36, maxHeight: 120, lineHeight: 1.4 }} onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }} />
                <button onClick={sendMessage} disabled={sending || !msgText.trim()} style={{ ...goldBtn, opacity: sending || !msgText.trim() ? 0.5 : 1, minWidth: 60 }}>{sending ? "..." : "Send"}</button>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4, fontSize: 10, color: "#555" }}>
                <span>{convoLine ? `Sending from: ${convoLine.label} (${convoLine.phone_number})` : ""}</span>
                <span>{charInfo(msgText)}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* ── RIGHT PANEL ── */}
      {showRight && selConvo && (
        <div style={{ ...panelStyle, width: 260, minWidth: 260 }}>
          <div style={{ padding: 12, borderBottom: "1px solid #1e1e2e" }}>
            <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 8 }}>Contact Info</div>
            <div style={{ fontSize: 16, textAlign: "center", marginBottom: 6 }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "rgba(212,175,55,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 8px", fontSize: 20, color: "#d4af37" }}>{(selConvo.contactName || selConvo.phone || "?")[0].toUpperCase()}</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{selConvo.contactName || "Unknown"}</div>
              <div style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{selConvo.phone}</div>
            </div>
          </div>

          {/* Line info */}
          <div style={{ padding: 12, borderBottom: "1px solid #1e1e2e" }}>
            <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Line</div>
            {convoLine ? (
              <div style={{ ...surfaceStyle, padding: 8, fontSize: 12 }}>
                <div>{convoLine.label}</div>
                <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>{convoLine.phone_number}</div>
                <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>{convoLine.type === "twilio" ? "🔵 Twilio" : "📱 Android Gateway"}{convoLine.device_name ? ` · ${convoLine.device_name}` : ""}</div>
              </div>
            ) : <div style={{ fontSize: 12, color: "#555" }}>Unknown line</div>}
          </div>

          {/* CRM Contact */}
          <div style={{ padding: 12, borderBottom: "1px solid #1e1e2e" }}>
            <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>CRM Contact</div>
            {linkedContact ? (
              <div style={{ ...surfaceStyle, padding: 8, fontSize: 12 }}>
                <div style={{ fontWeight: 600 }}>{linkedContact.first_name} {linkedContact.last_name}</div>
                {linkedContact.email && <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>{linkedContact.email}</div>}
                {linkedContact.company && <div style={{ color: "#888", fontSize: 11, marginTop: 2 }}>{linkedContact.company}</div>}
              </div>
            ) : (
              <div>
                <div style={{ fontSize: 12, color: "#555", marginBottom: 6 }}>Not linked to a contact</div>
                <button onClick={() => showToast("Use contact search to link", "info")} style={{ ...ghostBtn, fontSize: 11, width: "100%" }}>Link to Contact</button>
              </div>
            )}
          </div>

          {/* Stats */}
          {threadStats && (
            <div style={{ padding: 12 }}>
              <div style={{ fontSize: 10, color: "#888", textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>Stats</div>
              <div style={{ ...surfaceStyle, padding: 8, fontSize: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#888" }}>Total</span><span>{threadStats.total}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#888" }}>Inbound</span><span>{threadStats.inbound}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}><span style={{ color: "#888" }}>Outbound</span><span>{threadStats.outbound}</span></div>
                <div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ color: "#888" }}>First msg</span><span>{threadStats.firstDate ? new Date(threadStats.firstDate).toLocaleDateString() : "—"}</span></div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ADD LINE MODAL ── */}
      {showAddLine && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => { setShowAddLine(false); setGeneratedToken(""); }}>
          <div style={{ ...surfaceStyle, width: 440, maxHeight: "80vh", overflowY: "auto", padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e1e2e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>Add SMS Line</span>
              <button onClick={() => { setShowAddLine(false); setGeneratedToken(""); }} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>

            {/* Tabs */}
            <div style={{ display: "flex", borderBottom: "1px solid #1e1e2e" }}>
              {["twilio", "android"].map(t => (
                <button key={t} onClick={() => setAddLineTab(t)} style={{ flex: 1, padding: "10px 0", background: addLineTab === t ? "rgba(212,175,55,0.08)" : "transparent", border: "none", borderBottom: addLineTab === t ? "2px solid #d4af37" : "2px solid transparent", color: addLineTab === t ? "#d4af37" : "#888", fontFamily: "'DM Mono',monospace", fontSize: 12, cursor: "pointer" }}>
                  {t === "twilio" ? "🔵 Twilio" : "📱 Android Gateway"}
                </button>
              ))}
            </div>

            <div style={{ padding: 18 }}>
              {addLineTab === "twilio" ? (
                <div>
                  {/* Twilio config */}
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Twilio Account</div>
                  {!twilioConfig ? (
                    <div style={{ marginBottom: 16 }}>
                      <input placeholder="Account SID" value={twilioSid} onChange={e => setTwilioSid(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                      <input placeholder="Auth Token" value={twilioToken} onChange={e => setTwilioToken(e.target.value)} type="password" style={{ ...inputStyle, marginBottom: 8 }} />
                      <button onClick={saveTwilioConfig} disabled={savingLine || !twilioSid || !twilioToken} style={{ ...goldBtn, width: "100%", opacity: savingLine ? 0.5 : 1 }}>{savingLine ? "Saving..." : "Save Config"}</button>
                    </div>
                  ) : (
                    <div style={{ ...surfaceStyle, padding: 8, marginBottom: 16, fontSize: 12, color: "#888" }}>Twilio account configured ✓</div>
                  )}

                  {/* Add number */}
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Add Twilio Number</div>
                  <input placeholder="Phone number (+1234567890)" value={twilioPhone} onChange={e => setTwilioPhone(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                  <input placeholder="Friendly name" value={twilioLabel} onChange={e => setTwilioLabel(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                  <button onClick={addTwilioLine} disabled={savingLine || !twilioPhone} style={{ ...goldBtn, width: "100%", opacity: savingLine || !twilioPhone ? 0.5 : 1 }}>{savingLine ? "Adding..." : "Add Number"}</button>

                  <div style={{ marginTop: 12, fontSize: 11, color: "#555", background: "#0a0a12", padding: 10, borderRadius: 6, wordBreak: "break-all" }}>
                    <div style={{ marginBottom: 4 }}>Configure webhook URL in Twilio console:</div>
                    <code style={{ color: "#d4af37" }}>{WEBHOOK_BASE}?source=twilio</code>
                  </div>
                </div>
              ) : (
                <div>
                  <div style={{ fontSize: 12, color: "#888", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>Android Device</div>
                  <input placeholder="Device name (e.g. Ken's Galaxy S24)" value={androidName} onChange={e => setAndroidName(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                  <button onClick={addAndroidLine} disabled={savingLine || !androidName} style={{ ...goldBtn, width: "100%", opacity: savingLine || !androidName ? 0.5 : 1 }}>{savingLine ? "Adding..." : "Add Device"}</button>

                  {generatedToken && (
                    <div style={{ marginTop: 14 }}>
                      <div style={{ ...surfaceStyle, padding: 12, fontSize: 12 }}>
                        <div style={{ color: "#d4af37", fontWeight: 600, marginBottom: 8 }}>Device Added Successfully!</div>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ color: "#888", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>API Token</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <code style={{ flex: 1, fontSize: 11, background: "#0a0a12", padding: 6, borderRadius: 4, wordBreak: "break-all", color: "#e0dcd0" }}>{generatedToken}</code>
                            <button onClick={() => { navigator.clipboard.writeText(generatedToken); showToast("Copied!", "success"); }} style={{ ...ghostBtn, fontSize: 10, whiteSpace: "nowrap" }}>Copy</button>
                          </div>
                        </div>
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ color: "#888", fontSize: 10, textTransform: "uppercase", marginBottom: 4 }}>Webhook URL</div>
                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <code style={{ flex: 1, fontSize: 11, background: "#0a0a12", padding: 6, borderRadius: 4, wordBreak: "break-all", color: "#e0dcd0" }}>{WEBHOOK_BASE}?source=android</code>
                            <button onClick={() => { navigator.clipboard.writeText(WEBHOOK_BASE + "?source=android"); showToast("Copied!", "success"); }} style={{ ...ghostBtn, fontSize: 10, whiteSpace: "nowrap" }}>Copy</button>
                          </div>
                        </div>
                        <div style={{ fontSize: 11, color: "#888", marginTop: 8 }}>
                          1. Install an SMS Gateway app on your Android device<br />
                          2. Configure the webhook URL and API token above<br />
                          3. The app will forward incoming SMS to VAULT and relay outbound messages
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── NEW CONVERSATION MODAL ── */}
      {showNewConvo && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999 }} onClick={() => setShowNewConvo(false)}>
          <div style={{ ...surfaceStyle, width: 380, padding: 0 }} onClick={e => e.stopPropagation()}>
            <div style={{ padding: "14px 18px", borderBottom: "1px solid #1e1e2e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>New SMS Conversation</span>
              <button onClick={() => setShowNewConvo(false)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: 18 }}>×</button>
            </div>
            <div style={{ padding: 18 }}>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 6 }}>Phone Number or Contact Name</div>
              <input value={newPhone} onChange={e => setNewPhone(e.target.value)} placeholder="+1234567890 or search..." style={{ ...inputStyle, marginBottom: 4 }} />
              {contactSuggestions.length > 0 && (
                <div style={{ ...surfaceStyle, maxHeight: 160, overflowY: "auto", marginBottom: 8 }}>
                  {contactSuggestions.map(c => (
                    <div key={c.id} onClick={() => setNewPhone(c.phone || c.mobile || "")} style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #1e1e2e" }} onMouseEnter={e => e.currentTarget.style.background = "rgba(212,175,55,0.08)"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                      <span>{c.first_name} {c.last_name}</span>
                      <span style={{ color: "#888", marginLeft: 8 }}>{c.phone || c.mobile || ""}</span>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ fontSize: 12, color: "#888", marginBottom: 6, marginTop: 8 }}>Send From</div>
              <select value={newLineId} onChange={e => setNewLineId(e.target.value)} style={{ ...inputStyle, cursor: "pointer" }}>
                <option value="">Select a line...</option>
                {lines.map(l => <option key={l.id} value={l.id}>{l.label} ({l.phone_number})</option>)}
              </select>

              <button onClick={startNewConvo} disabled={!newPhone.trim()} style={{ ...goldBtn, width: "100%", marginTop: 14, opacity: !newPhone.trim() ? 0.5 : 1 }}>Start Conversation</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WA PERSONAL VIEW (multi-session WhatsApp via wa-bridge) ──────────────────
function WAPersonalView({ user, contacts, showToast }) {
  const WA_BRIDGE_URL = window.location.hostname === 'localhost' ? 'http://localhost:3100' : 'https://wa-bridge.ziarem.com';
  const WA_WS_URL = WA_BRIDGE_URL.replace('http','ws') + '/ws';

  // Sessions
  const [sessions, setSessions] = useState([]);
  const [selSession, setSelSession] = useState(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  // Chats
  const [chats, setChats] = useState([]);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [chatSearch, setChatSearch] = useState("");
  const [selChat, setSelChat] = useState(null);
  // Messages
  const [messages, setMessages] = useState([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  const [msgBody, setMsgBody] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Right panel
  const [showInfo, setShowInfo] = useState(false);
  const [linkSearch, setLinkSearch] = useState("");
  const [showLinkModal, setShowLinkModal] = useState(false);
  // Add session / QR
  const [showAddSession, setShowAddSession] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [addingSession, setAddingSession] = useState(false);
  const [qrData, setQrData] = useState(null);
  const [showQrModal, setShowQrModal] = useState(false);
  // Expand image
  const [expandImg, setExpandImg] = useState(null);

  const msgsEndRef = useRef(null);
  const msgsContainerRef = useRef(null);
  const wsRef = useRef(null);
  const prevScrollH = useRef(0);

  // ── Fetch helpers ──
  const apiFetch = useCallback(async (path, opts={}) => {
    try {
      const r = await fetch(`${WA_BRIDGE_URL}${path}`, {
        headers:{"Content-Type":"application/json"}, ...opts,
        ...(opts.body ? {body: typeof opts.body==="string" ? opts.body : JSON.stringify(opts.body)} : {})
      });
      if (!r.ok) { const t=await r.text(); console.error("wa-bridge error:",t); return null; }
      const t = await r.text(); return t ? JSON.parse(t) : null;
    } catch(e) { console.error("wa-bridge fetch error:",e); return null; }
  },[WA_BRIDGE_URL]);

  // ── Load sessions ──
  const loadSessions = useCallback(async ()=>{
    setSessionsLoading(true);
    const data = await apiFetch("/api/sessions");
    if (data) {
      setSessions(data);
      if (!selSession && data.length > 0) setSelSession(data[0]);
    }
    setSessionsLoading(false);
  },[apiFetch, selSession]);

  useEffect(()=>{ loadSessions(); },[]);// eslint-disable-line

  // ── Load chats when session changes ──
  const loadChats = useCallback(async (sid)=>{
    if (!sid) return;
    setChatsLoading(true);
    setSelChat(null); setMessages([]);
    const data = await apiFetch(`/api/sessions/${sid.id || sid}/chats`);
    if (data) {
      const sorted = [...data].sort((a,b)=>(b.last_message_at||"").localeCompare(a.last_message_at||""));
      setChats(sorted);
    } else setChats([]);
    setChatsLoading(false);
  },[apiFetch]);

  useEffect(()=>{ if(selSession) loadChats(selSession); },[selSession]);// eslint-disable-line

  // ── Load messages when chat changes ──
  const loadMessages = useCallback(async (chat, before=null)=>{
    if (!selSession || !chat) return;
    setMsgsLoading(true);
    const sid = selSession.id || selSession;
    const jid = chat.jid || chat.id;
    let url = `/api/sessions/${sid}/chats/${encodeURIComponent(jid)}/messages?limit=50`;
    if (before) url += `&before=${encodeURIComponent(before)}`;
    const data = await apiFetch(url);
    if (data) {
      if (before) {
        setMessages(prev => [...data, ...prev]);
        setHasMore(data.length >= 50);
      } else {
        setMessages(data);
        setHasMore(data.length >= 50);
        setTimeout(()=> msgsEndRef.current?.scrollIntoView({behavior:"auto"}), 50);
      }
    }
    setMsgsLoading(false);
  },[apiFetch, selSession]);

  useEffect(()=>{ if(selChat) loadMessages(selChat); },[selChat]);// eslint-disable-line

  // ── Scroll up = load more ──
  const handleMsgsScroll = useCallback(()=>{
    const el = msgsContainerRef.current;
    if (!el || msgsLoading || !hasMore) return;
    if (el.scrollTop < 60 && messages.length > 0) {
      prevScrollH.current = el.scrollHeight;
      const oldest = messages[0]?.timestamp || messages[0]?.created_at;
      if (oldest) loadMessages(selChat, oldest).then(()=>{
        requestAnimationFrame(()=>{
          if (msgsContainerRef.current) msgsContainerRef.current.scrollTop = msgsContainerRef.current.scrollHeight - prevScrollH.current;
        });
      });
    }
  },[msgsLoading, hasMore, messages, selChat, loadMessages]);

  // ── Send message ──
  const sendMessage = useCallback(async ()=>{
    if (!msgBody.trim() || !selSession || !selChat || sending) return;
    const text = msgBody.trim();
    setMsgBody("");
    setSending(true);
    const sid = selSession.id || selSession;
    const jid = selChat.jid || selChat.id;
    // Optimistic
    const optimistic = { id:"tmp-"+Date.now(), from_me:true, body:text, timestamp:new Date().toISOString(), status:"sending" };
    setMessages(prev=>[...prev, optimistic]);
    setTimeout(()=> msgsEndRef.current?.scrollIntoView({behavior:"smooth"}), 50);
    const res = await apiFetch(`/api/sessions/${sid}/chats/${encodeURIComponent(jid)}/send`, {method:"POST", body:{message:text}});
    if (res) {
      setMessages(prev=> prev.map(m=> m.id===optimistic.id ? {...m, ...res, status:"sent"} : m));
    } else {
      setMessages(prev=> prev.map(m=> m.id===optimistic.id ? {...m, status:"failed"} : m));
      showToast("Failed to send message","error");
    }
    setSending(false);
  },[msgBody, selSession, selChat, sending, apiFetch, showToast]);

  // ── Add session ──
  const addSession = useCallback(async ()=>{
    if (!newLabel.trim() || addingSession) return;
    setAddingSession(true);
    const res = await apiFetch("/api/sessions", {method:"POST", body:{label:newLabel.trim(), user_id:user.id}});
    if (res) {
      setShowAddSession(false); setNewLabel("");
      await loadSessions();
      // Auto-connect to get QR
      const sid = res.id || res;
      const conn = await apiFetch(`/api/sessions/${sid}/connect`, {method:"POST"});
      if (conn?.qr) { setQrData(conn.qr); setShowQrModal(true); }
      else if (conn) { setShowQrModal(true); } // WS will send QR
      showToast("Session created — scan QR code");
    } else showToast("Failed to create session","error");
    setAddingSession(false);
  },[newLabel, addingSession, apiFetch, user.id, loadSessions, showToast]);

  // ── Connect existing session (get QR) ──
  const connectSession = useCallback(async (sid)=>{
    const res = await apiFetch(`/api/sessions/${sid}/connect`, {method:"POST"});
    if (res?.qr) { setQrData(res.qr); setShowQrModal(true); }
    else if (res) { setShowQrModal(true); showToast("Connecting..."); }
    else showToast("Failed to connect","error");
  },[apiFetch, showToast]);

  // ── Link chat to CRM contact ──
  const linkContact = useCallback(async (contactId)=>{
    if (!selChat) return;
    const jid = selChat.jid || selChat.id;
    await sb("vault_wa_contacts","POST",{ jid, contact_id:contactId, user_id:user.id, phone:selChat.phone||jid.split("@")[0], wa_name:selChat.name||"" });
    setShowLinkModal(false); setLinkSearch("");
    showToast("Contact linked");
    loadChats(selSession);
  },[selChat, user.id, showToast, selSession, loadChats]);

  // ── WebSocket ──
  useEffect(()=>{
    let ws;
    try {
      ws = new WebSocket(WA_WS_URL);
      wsRef.current = ws;
      ws.onmessage = (evt)=>{
        try {
          const data = JSON.parse(evt.data);
          if (data.event === "qr") { setQrData(data.qr); setShowQrModal(true); }
          else if (data.event === "connected") {
            setShowQrModal(false); setQrData(null);
            showToast("WhatsApp connected");
            loadSessions();
          }
          else if (data.event === "disconnected") {
            showToast("WhatsApp session disconnected","error");
            loadSessions();
          }
          else if (data.event === "message") {
            const msg = data.message;
            // Update chat list
            setChats(prev=> {
              const idx = prev.findIndex(c=> (c.jid||c.id) === msg.chat_jid);
              if (idx >= 0) {
                const updated = [...prev];
                updated[idx] = {...updated[idx], last_message:msg.body, last_message_at:msg.timestamp, unread_count:(updated[idx].unread_count||0)+(msg.from_me?0:1)};
                return updated.sort((a,b)=>(b.last_message_at||"").localeCompare(a.last_message_at||""));
              }
              return prev;
            });
            // Append to current chat if matching
            const currentJid = selChat?.jid || selChat?.id;
            if (msg.chat_jid === currentJid) {
              setMessages(prev=> {
                if (prev.find(m=> m.id === msg.id)) return prev;
                return [...prev, msg];
              });
              setTimeout(()=> msgsEndRef.current?.scrollIntoView({behavior:"smooth"}), 80);
            }
          }
        } catch(e) { console.error("WS parse error:",e); }
      };
      ws.onerror = ()=> console.error("WA WS error");
      ws.onclose = ()=> console.log("WA WS closed");
    } catch(e) { console.error("WS connect error:",e); }
    return ()=>{ if(ws) ws.close(); };
  },[]);// eslint-disable-line

  // ── Chat polling fallback (every 30s) ──
  useEffect(()=>{
    if (!selSession) return;
    const iv = setInterval(()=> loadChats(selSession), 30000);
    return ()=> clearInterval(iv);
  },[selSession, loadChats]);

  // ── Derived ──
  const filteredChats = useMemo(()=>{
    if (!chatSearch.trim()) return chats;
    const q = chatSearch.toLowerCase();
    return chats.filter(c=> (c.name||"").toLowerCase().includes(q) || (c.phone||"").includes(q) || (c.jid||"").includes(q));
  },[chats, chatSearch]);

  const linkedContactMap = useMemo(()=>{
    const m = {};
    contacts.forEach(c=>{ if(c.phone) m[c.phone.replace(/\D/g,"")] = c; });
    return m;
  },[contacts]);

  const getCrmContact = useCallback((chat)=>{
    if (chat?.contact_id) return contacts.find(c=>c.id===chat.contact_id);
    const phone = (chat?.phone || (chat?.jid||"").split("@")[0] || "").replace(/\D/g,"");
    return linkedContactMap[phone] || null;
  },[contacts, linkedContactMap]);

  const formatTime = (ts)=>{
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    if (d.toDateString()===now.toDateString()) return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
    const diff = (now-d)/(1000*60*60*24);
    if (diff < 7) return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][d.getDay()];
    return d.toLocaleDateString([],{month:"short",day:"numeric"});
  };

  const chatInitials = (name)=>{
    if (!name) return "?";
    return name.split(" ").map(w=>w[0]).join("").toUpperCase().slice(0,2);
  };

  const filterContactResults = useMemo(()=>{
    if (!linkSearch.trim()) return [];
    const q = linkSearch.toLowerCase();
    return contacts.filter(c=> (c.full_name||"").toLowerCase().includes(q) || (c.phone||"").includes(q) || (c.email||"").toLowerCase().includes(q)).slice(0,10);
  },[contacts, linkSearch]);

  const currentCrm = selChat ? getCrmContact(selChat) : null;

  // ── Styles ──
  const sPanel = {width:220,borderRight:"1px solid #1e1e2e",display:"flex",flexDirection:"column",background:"#0a0a12",flexShrink:0};
  const sCenter = {flex:1,display:"flex",flexDirection:"column",background:"#0a0a12",minWidth:0};
  const sRight = {width:280,borderLeft:"1px solid #1e1e2e",display:"flex",flexDirection:"column",background:"#0a0a12",flexShrink:0,overflow:"auto"};
  const sBubbleOut = {maxWidth:"65%",background:"rgba(212,175,55,0.10)",border:"1px solid rgba(212,175,55,0.15)",borderRadius:"8px 8px 2px 8px",padding:"8px 12px",marginLeft:"auto",marginBottom:4};
  const sBubbleIn = {maxWidth:"65%",background:"#12121e",border:"1px solid #1e1e2e",borderRadius:"8px 8px 8px 2px",padding:"8px 12px",marginRight:"auto",marginBottom:4};
  const sInput = {background:"#0d0d18",border:"1px solid #1e1e2e",borderRadius:6,color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"8px 12px",outline:"none",width:"100%"};
  const sBtn = {background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",borderRadius:4,padding:"6px 14px",cursor:"pointer",fontFamily:"inherit",fontSize:9,fontWeight:600,letterSpacing:".08em"};
  const sBtnGhost = {background:"none",border:"1px solid #1e1e2e",color:"#888",borderRadius:4,padding:"4px 10px",cursor:"pointer",fontFamily:"inherit",fontSize:9};
  const sModal = {position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:9999};
  const sModalBox = {background:"#12121e",border:"1px solid #1e1e2e",borderRadius:8,padding:24,minWidth:340,maxWidth:420};

  return (
    <div style={{flex:1,display:"flex",height:"100%",overflow:"hidden",fontFamily:"'DM Mono','Courier New',monospace"}}>
      {/* ─── LEFT PANEL: Sessions + Chats ─── */}
      <div style={sPanel}>
        {/* Session selector */}
        <div style={{padding:"10px 10px 6px",borderBottom:"1px solid #1e1e2e"}}>
          <div style={{display:"flex",alignItems:"center",gap:4,marginBottom:6}}>
            <select value={selSession?.id||""} onChange={e=>{const s=sessions.find(x=>x.id===e.target.value); if(s) setSelSession(s);}}
              style={{...sInput, flex:1, fontSize:9, padding:"5px 8px"}}>
              {sessions.map(s=><option key={s.id} value={s.id}>{s.label||s.phone||s.id.slice(0,8)}</option>)}
              {sessions.length===0&&<option value="">No sessions</option>}
            </select>
            <button onClick={()=>setShowAddSession(true)} title="Add Number" style={{...sBtnGhost,padding:"4px 6px",fontSize:11}}>➕</button>
          </div>
          {selSession && (
            <div style={{display:"flex",alignItems:"center",gap:6,fontSize:8,color:"#666",marginBottom:4}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:selSession.status==="connected"?"#25d366":"#ef4444",display:"inline-block"}}/>
              <span>{selSession.phone||"Connecting..."}</span>
              {selSession.status!=="connected"&&<button onClick={()=>connectSession(selSession.id)} style={{...sBtnGhost,padding:"2px 6px",fontSize:7}}>Connect</button>}
            </div>
          )}
        </div>
        {/* Chat search */}
        <div style={{padding:"6px 10px"}}>
          <input value={chatSearch} onChange={e=>setChatSearch(e.target.value)} placeholder="Search chats..." style={{...sInput,fontSize:9,padding:"5px 8px"}} />
        </div>
        {/* Chat list */}
        <div style={{flex:1,overflow:"auto"}}>
          {chatsLoading && <div style={{textAlign:"center",padding:20,color:"#444",fontSize:9}}>Loading chats...</div>}
          {!chatsLoading && filteredChats.length===0 && <div style={{textAlign:"center",padding:20,color:"#333",fontSize:9}}>{selSession?"No chats yet":"Select a session"}</div>}
          {filteredChats.map(chat=>{
            const jid = chat.jid||chat.id;
            const active = (selChat?.jid||selChat?.id) === jid;
            const crm = getCrmContact(chat);
            return (
              <div key={jid} onClick={()=>setSelChat(chat)}
                style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",cursor:"pointer",borderLeft:active?"2px solid #d4af37":"2px solid transparent",
                  background:active?"rgba(212,175,55,0.08)":"transparent",transition:"background .15s"}}>
                {/* Avatar */}
                {chat.profile_pic ? (
                  <img src={chat.profile_pic} alt="" style={{width:32,height:32,borderRadius:"50%",objectFit:"cover",flexShrink:0}} />
                ) : (
                  <div style={{width:32,height:32,borderRadius:"50%",background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:"#d4af37",fontWeight:600,flexShrink:0}}>{chatInitials(chat.name)}</div>
                )}
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <span style={{fontSize:10,fontWeight:600,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:100}}>{chat.name||jid.split("@")[0]}</span>
                    <span style={{fontSize:7,color:"#555",flexShrink:0}}>{formatTime(chat.last_message_at)}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:8,color:"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flex:1}}>{chat.last_message||""}</span>
                    {(chat.unread_count||0)>0 && <span style={{background:"#d4af37",color:"#000",fontSize:7,fontWeight:700,borderRadius:"50%",width:16,height:16,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{chat.unread_count}</span>}
                    {crm && <span style={{width:5,height:5,borderRadius:"50%",background:"#25d366",flexShrink:0}} title="Linked to CRM"/>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── CENTER PANEL: Chat Messages ─── */}
      <div style={sCenter}>
        {!selChat ? (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,color:"#333"}}>
            <div style={{fontSize:32,opacity:.3}}>💬</div>
            <div style={{fontSize:10}}>Select a chat to start messaging</div>
          </div>
        ) : (
          <>
            {/* Top bar */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderBottom:"1px solid #1e1e2e",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                {selChat.profile_pic ? (
                  <img src={selChat.profile_pic} alt="" style={{width:28,height:28,borderRadius:"50%",objectFit:"cover"}} />
                ) : (
                  <div style={{width:28,height:28,borderRadius:"50%",background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#d4af37",fontWeight:600}}>{chatInitials(selChat.name)}</div>
                )}
                <div>
                  <div style={{fontSize:11,fontWeight:600,color:"#e0dcd0"}}>{selChat.name||(selChat.jid||selChat.id).split("@")[0]}</div>
                  <div style={{fontSize:8,color:"#555"}}>{selChat.phone||(selChat.jid||selChat.id).split("@")[0]}</div>
                </div>
              </div>
              <div style={{display:"flex",gap:6}}>
                {!currentCrm && <button onClick={()=>{setShowLinkModal(true);setLinkSearch("");}} style={sBtnGhost}>Link to CRM</button>}
                <button onClick={()=>setShowInfo(!showInfo)} style={sBtnGhost}>{showInfo?"Hide Info":"ℹ Info"}</button>
              </div>
            </div>
            {/* Messages */}
            <div ref={msgsContainerRef} onScroll={handleMsgsScroll} style={{flex:1,overflow:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:2}}>
              {msgsLoading && messages.length===0 && <div style={{textAlign:"center",padding:30,color:"#444",fontSize:9}}>Loading messages...</div>}
              {hasMore && messages.length>0 && <div style={{textAlign:"center",padding:8,color:"#333",fontSize:8}}>↑ Scroll up for older messages</div>}
              {messages.map((msg,i)=>{
                const isOut = msg.from_me || msg.direction==="outbound";
                const bubble = isOut ? sBubbleOut : sBubbleIn;
                return (
                  <div key={msg.id||i} style={{display:"flex",flexDirection:"column",alignItems:isOut?"flex-end":"flex-start"}}>
                    {/* Group sender */}
                    {!isOut && msg.sender_name && <div style={{fontSize:7,color:"#d4af37",marginBottom:1,marginLeft:4}}>{msg.sender_name}</div>}
                    {/* Quoted / reply */}
                    {msg.quoted_body && (
                      <div style={{fontSize:7,color:"#666",background:"rgba(255,255,255,0.03)",borderLeft:"2px solid #d4af37",padding:"2px 8px",borderRadius:3,marginBottom:2,maxWidth:"60%"}}>
                        {msg.quoted_body.slice(0,80)}{msg.quoted_body.length>80?"...":""}
                      </div>
                    )}
                    <div style={bubble}>
                      {/* Image */}
                      {msg.media_url && /\.(jpg|jpeg|png|gif|webp)/i.test(msg.media_url) && (
                        <img src={msg.media_url} alt="" onClick={()=>setExpandImg(msg.media_url)}
                          style={{maxWidth:"100%",maxHeight:200,borderRadius:4,cursor:"pointer",marginBottom:msg.body?4:0}} />
                      )}
                      {msg.body && <div style={{fontSize:10,color:"#e0dcd0",lineHeight:1.5,wordBreak:"break-word"}}>{msg.body}</div>}
                      <div style={{fontSize:7,color:isOut?"rgba(212,175,55,0.5)":"#444",textAlign:"right",marginTop:2}}>
                        {formatTime(msg.timestamp||msg.created_at)}
                        {isOut && msg.status==="sending" && " ⏳"}
                        {isOut && msg.status==="sent" && " ✓"}
                        {isOut && msg.status==="delivered" && " ✓✓"}
                        {isOut && msg.status==="read" && " ✓✓"}
                        {isOut && msg.status==="failed" && " ✕"}
                      </div>
                    </div>
                  </div>
                );
              })}
              <div ref={msgsEndRef}/>
            </div>
            {/* Input bar */}
            <div style={{padding:"8px 16px",borderTop:"1px solid #1e1e2e",display:"flex",gap:8,flexShrink:0,alignItems:"flex-end"}}>
              <label style={{...sBtnGhost,padding:"6px 8px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center"}}>
                📎<input type="file" accept="image/*" style={{display:"none"}} onChange={async(e)=>{
                  const file=e.target.files?.[0]; if(!file||!selSession||!selChat) return;
                  const fd=new FormData(); fd.append("file",file);
                  const sid=selSession.id||selSession; const jid=selChat.jid||selChat.id;
                  try {
                    const r=await fetch(`${WA_BRIDGE_URL}/api/sessions/${sid}/chats/${encodeURIComponent(jid)}/send-media`,{method:"POST",body:fd});
                    if(r.ok) showToast("Image sent"); else showToast("Failed to send image","error");
                  } catch(err) { showToast("Failed to send image","error"); }
                }}/>
              </label>
              <textarea value={msgBody} onChange={e=>setMsgBody(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage();}}}
                placeholder="Type a message..." rows={1}
                style={{...sInput,flex:1,resize:"none",minHeight:32,maxHeight:100,lineHeight:1.4}}
              />
              <button onClick={sendMessage} disabled={sending||!msgBody.trim()} style={{...sBtn,opacity:(!msgBody.trim()||sending)?.4:1}}>SEND</button>
            </div>
          </>
        )}
      </div>

      {/* ─── RIGHT PANEL: Contact Info ─── */}
      {showInfo && selChat && (
        <div style={sRight}>
          <div style={{padding:16,textAlign:"center",borderBottom:"1px solid #1e1e2e"}}>
            {selChat.profile_pic ? (
              <img src={selChat.profile_pic} alt="" style={{width:72,height:72,borderRadius:"50%",objectFit:"cover",margin:"0 auto 10px"}} />
            ) : (
              <div style={{width:72,height:72,borderRadius:"50%",background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,color:"#d4af37",fontWeight:600,margin:"0 auto 10px"}}>{chatInitials(selChat.name)}</div>
            )}
            <div style={{fontSize:12,fontWeight:600,color:"#e0dcd0"}}>{selChat.name||"Unknown"}</div>
            <div style={{fontSize:9,color:"#555",marginTop:2}}>{selChat.phone||(selChat.jid||selChat.id).split("@")[0]}</div>
          </div>
          {/* CRM link info */}
          <div style={{padding:16}}>
            {currentCrm ? (
              <div style={{background:"rgba(212,175,55,0.05)",border:"1px solid rgba(212,175,55,0.12)",borderRadius:6,padding:12}}>
                <div style={{fontSize:8,color:"#d4af37",letterSpacing:".08em",marginBottom:6}}>CRM CONTACT</div>
                <div style={{fontSize:11,fontWeight:600,color:"#e0dcd0"}}>{currentCrm.full_name}</div>
                {currentCrm.email && <div style={{fontSize:9,color:"#888",marginTop:2}}>{currentCrm.email}</div>}
                {currentCrm.phone && <div style={{fontSize:9,color:"#888",marginTop:2}}>{currentCrm.phone}</div>}
                <div style={{fontSize:8,color:"#555",marginTop:6}}>Deals: {currentCrm.deals_count||0}</div>
              </div>
            ) : (
              <div style={{textAlign:"center"}}>
                <div style={{fontSize:9,color:"#555",marginBottom:8}}>Not linked to CRM</div>
                <button onClick={()=>{setShowLinkModal(true);setLinkSearch("");}} style={sBtn}>Link to Contact</button>
              </div>
            )}
          </div>
          {/* Media gallery placeholder */}
          <div style={{padding:"0 16px"}}>
            <div style={{fontSize:8,color:"#555",letterSpacing:".08em",marginBottom:8}}>SHARED MEDIA</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:4}}>
              {messages.filter(m=>m.media_url&&/\.(jpg|jpeg|png|gif|webp)/i.test(m.media_url)).slice(-9).map((m,i)=>(
                <img key={i} src={m.media_url} alt="" onClick={()=>setExpandImg(m.media_url)}
                  style={{width:"100%",aspectRatio:"1",objectFit:"cover",borderRadius:4,cursor:"pointer",border:"1px solid #1e1e2e"}} />
              ))}
            </div>
            {messages.filter(m=>m.media_url&&/\.(jpg|jpeg|png|gif|webp)/i.test(m.media_url)).length===0 && (
              <div style={{fontSize:8,color:"#333",textAlign:"center",padding:12}}>No media shared</div>
            )}
          </div>
        </div>
      )}

      {/* ─── MODALS ─── */}
      {/* Add Session Modal */}
      {showAddSession && (
        <div style={sModal} onClick={()=>setShowAddSession(false)}>
          <div style={sModalBox} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:12,fontWeight:600,color:"#e0dcd0",marginBottom:14}}>Add WhatsApp Number</div>
            <input value={newLabel} onChange={e=>setNewLabel(e.target.value)} placeholder="Label (e.g. Sales, Support)" style={{...sInput,marginBottom:12}} />
            <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
              <button onClick={()=>setShowAddSession(false)} style={sBtnGhost}>Cancel</button>
              <button onClick={addSession} disabled={addingSession||!newLabel.trim()} style={{...sBtn,opacity:(!newLabel.trim()||addingSession)?.5:1}}>{addingSession?"Creating...":"Create & Connect"}</button>
            </div>
          </div>
        </div>
      )}

      {/* QR Code Modal */}
      {showQrModal && (
        <div style={sModal} onClick={()=>{setShowQrModal(false);setQrData(null);}}>
          <div style={sModalBox} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:12,fontWeight:600,color:"#e0dcd0",marginBottom:6}}>Scan QR Code</div>
            <div style={{fontSize:8,color:"#888",marginBottom:14}}>Open WhatsApp on your phone → Settings → Linked Devices → Scan</div>
            <div style={{textAlign:"center",padding:16,background:"#fff",borderRadius:8,marginBottom:14}}>
              {qrData ? (
                <img src={qrData.startsWith("data:") ? qrData : `data:image/png;base64,${qrData}`} alt="QR" style={{width:220,height:220}} />
              ) : (
                <div style={{width:220,height:220,display:"flex",alignItems:"center",justifyContent:"center",color:"#888",fontSize:10}}>Waiting for QR code...</div>
              )}
            </div>
            <div style={{textAlign:"center"}}>
              <button onClick={()=>{setShowQrModal(false);setQrData(null);}} style={sBtnGhost}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* Link to CRM Contact Modal */}
      {showLinkModal && (
        <div style={sModal} onClick={()=>setShowLinkModal(false)}>
          <div style={sModalBox} onClick={e=>e.stopPropagation()}>
            <div style={{fontSize:12,fontWeight:600,color:"#e0dcd0",marginBottom:14}}>Link to CRM Contact</div>
            <input value={linkSearch} onChange={e=>setLinkSearch(e.target.value)} placeholder="Search by name, phone, or email..." style={{...sInput,marginBottom:10}} autoFocus />
            <div style={{maxHeight:250,overflow:"auto"}}>
              {filterContactResults.length===0 && linkSearch.trim() && <div style={{fontSize:9,color:"#555",textAlign:"center",padding:12}}>No contacts found</div>}
              {filterContactResults.map(c=>(
                <div key={c.id} onClick={()=>linkContact(c.id)}
                  style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",cursor:"pointer",borderRadius:4,transition:"background .15s",
                    background:"transparent"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.03)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:"#1a1a2e",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#d4af37",fontWeight:600}}>{chatInitials(c.full_name)}</div>
                  <div>
                    <div style={{fontSize:10,fontWeight:600,color:"#e0dcd0"}}>{c.full_name}</div>
                    <div style={{fontSize:8,color:"#555"}}>{c.email||""} {c.phone?"· "+c.phone:""}</div>
                  </div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
              <button onClick={()=>setShowLinkModal(false)} style={sBtnGhost}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Image Expand Modal */}
      {expandImg && (
        <div style={sModal} onClick={()=>setExpandImg(null)}>
          <img src={expandImg} alt="" style={{maxWidth:"90vw",maxHeight:"90vh",borderRadius:8}} />
        </div>
      )}
    </div>
  );
}

// ─── UNIFIED INBOX VIEW (all channels: Telegram, WhatsApp, Messenger, Instagram) ─
function UnifiedInboxView({ user, contacts, showToast }) {
  const [channelFilter, setChannelFilter] = useState("all");
  const [conversations, setConversations] = useState([]);
  const [selConvo, setSelConvo] = useState(null);
  const [chatMessages, setChatMessages] = useState([]);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [convoSearch, setConvoSearch] = useState("");
  const endRef = useRef(null);

  const CHANNELS = [
    {id:"all",label:"ALL",icon:"📨",color:"#d4af37"},
    {id:"telegram",label:"TELEGRAM",icon:"✈",color:"#0088cc"},
    {id:"whatsapp",label:"WHATSAPP",icon:"◉",color:"#25d366"},
    {id:"messenger",label:"MESSENGER",icon:"◎",color:"#0084ff"},
    {id:"instagram",label:"INSTAGRAM",icon:"◐",color:"#e4405f"},
  ];
  const channelIcon = ch => CHANNELS.find(c=>c.id===ch)?.icon||"📨";
  const channelColor = ch => CHANNELS.find(c=>c.id===ch)?.color||"#555";

  const loadMessages = useCallback(async ()=>{
    let q = `?user_id=eq.${user.id}&order=created_at.desc&limit=500`;
    if(channelFilter!=="all") q += `&channel=eq.${channelFilter}`;
    const msgs = await sb("messages","GET",null,q);
    if(!msgs) { setLoading(false); return; }
    // Group by contact_id into conversations
    const map = {};
    msgs.forEach(m=>{
      const cid = m.contact_id||"unknown";
      if(!map[cid]) map[cid]={contact_id:cid, channel:m.channel, lastMsg:m, messages:[], unread:0};
      map[cid].messages.push(m);
      if(m.direction==="inbound"&&!m.is_read) map[cid].unread++;
      if(new Date(m.created_at)>new Date(map[cid].lastMsg.created_at)) { map[cid].lastMsg=m; map[cid].channel=m.channel; }
    });
    const convos = Object.values(map).sort((a,b)=>new Date(b.lastMsg.created_at)-new Date(a.lastMsg.created_at));
    setConversations(convos);
    // Refresh selected conversation
    if(selConvo) {
      const updated = convos.find(c=>c.contact_id===selConvo.contact_id);
      if(updated) { setSelConvo(updated); setChatMessages(updated.messages.slice().reverse()); }
    }
    setLoading(false);
  },[user.id, channelFilter, selConvo?.contact_id]);

  useEffect(()=>{ loadMessages(); const iv=setInterval(loadMessages,10000); return()=>clearInterval(iv); },[loadMessages]);
  useEffect(()=>{ endRef.current?.scrollIntoView({behavior:"smooth"}); },[chatMessages]);

  const contactName = cid => {
    const c = contacts.find(x=>x.id===cid);
    return c?.full_name||c?.email||cid?.slice(0,8)||"Unknown";
  };

  const selectConvo = c => {
    setSelConvo(c);
    setChatMessages(c.messages.slice().reverse());
    // Mark inbound as read
    c.messages.filter(m=>m.direction==="inbound"&&!m.is_read).forEach(m=>sb("messages","PATCH",{is_read:true},`?id=eq.${m.id}`));
  };

  const sendReply = async ()=>{
    if(!replyBody.trim()||!selConvo) return;
    setSending(true);
    const ch = selConvo.channel;
    const contact = contacts.find(c=>c.id===selConvo.contact_id);
    // Store outbound message
    await sb("messages","POST",{user_id:user.id, channel:ch, contact_id:selConvo.contact_id, direction:"outbound", content:replyBody.trim(), created_at:new Date().toISOString()});
    // Send via channel API (proxied through n8n ideally, direct as fallback)
    try {
      if(ch==="whatsapp") {
        await n8nPost("whatsapp-send",{to:contact?.phone||selConvo.contact_id, message:replyBody.trim()});
      } else if(ch==="telegram") {
        await n8nPost("telegram-send",{chat_id:selConvo.contact_id, message:replyBody.trim()});
      } else if(ch==="messenger"||ch==="instagram") {
        await n8nPost("meta-send",{channel:ch, recipient_id:selConvo.contact_id, message:replyBody.trim()});
      }
    } catch(e) { console.error("Channel send error:",e); }
    setReplyBody("");
    setSending(false);
    showToast(`Sent via ${ch}`);
    loadMessages();
  };

  const filteredConvos = conversations.filter(c=>{
    const name = contactName(c.contact_id).toLowerCase();
    const preview = (c.lastMsg?.content||"").toLowerCase();
    return !convoSearch || name.includes(convoSearch.toLowerCase()) || preview.includes(convoSearch.toLowerCase());
  });

  return (
    <div style={{display:"flex",flex:1,overflow:"hidden"}}>
      {/* Left: Conversation list */}
      <div style={{width:300,borderRight:"1px solid #0e0e18",display:"flex",flexDirection:"column",flexShrink:0,background:"#0b0b13"}}>
        <div style={{padding:"10px 12px",borderBottom:"1px solid #0e0e18"}}>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:".15em",color:"#d4af37",marginBottom:6}}>UNIFIED INBOX</div>
          <input value={convoSearch} onChange={e=>setConvoSearch(e.target.value)} placeholder="Search conversations..." style={{width:"100%",background:"#0e0e1a",border:"1px solid #1a1a28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 10px",borderRadius:3,marginBottom:6}}/>
          <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>
            {CHANNELS.map(ch=>(
              <button key={ch.id} onClick={()=>{setChannelFilter(ch.id);setSelConvo(null);setChatMessages([]);}} style={{background:channelFilter===ch.id?`${ch.color}18`:"none",border:`1px solid ${channelFilter===ch.id?`${ch.color}44`:"transparent"}`,color:channelFilter===ch.id?ch.color:"#444",fontFamily:"inherit",fontSize:8,padding:"2px 7px",borderRadius:2,cursor:"pointer",letterSpacing:".04em"}}>{ch.icon} {ch.label}</button>
            ))}
          </div>
        </div>
        <div style={{flex:1,overflowY:"auto"}}>
          {loading&&<div style={{padding:20,textAlign:"center"}}><div className="pulse" style={{fontSize:10,color:"#d4af37"}}>Loading conversations...</div></div>}
          {!loading&&filteredConvos.length===0&&<div style={{padding:30,textAlign:"center",color:"#1e1e2e",fontSize:10}}>No conversations found</div>}
          {filteredConvos.map(c=>(
            <div key={c.contact_id} onClick={()=>selectConvo(c)} className={`rh${selConvo?.contact_id===c.contact_id?" sel":""}`} style={{padding:"10px 12px",borderBottom:"1px solid #0a0a14",cursor:"pointer",borderLeft:"2px solid transparent"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <Av name={contactName(c.contact_id)} color={channelColor(c.channel)} size={30}/>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                    <span style={{fontSize:10,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:140}}>{contactName(c.contact_id)}</span>
                    <span style={{fontSize:7,color:"#2a2a3a",flexShrink:0}}>{ago(c.lastMsg.created_at)}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:4}}>
                    <span style={{fontSize:9,flexShrink:0}}>{channelIcon(c.channel)}</span>
                    <span style={{fontSize:9,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.lastMsg.direction==="outbound"?"You: ":""}{c.lastMsg.content?.slice(0,50)}</span>
                  </div>
                </div>
                {c.unread>0&&<span style={{width:18,height:18,borderRadius:"50%",background:"#ef4444",fontSize:8,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",flexShrink:0}}>{c.unread}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right: Chat detail */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {!selConvo ? (
          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
            <div style={{fontSize:40,opacity:.06}}>📨</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".2em",fontSize:13,color:"#1a1a2a"}}>SELECT A CONVERSATION</div>
            <div style={{fontSize:9,color:"#222"}}>Choose a conversation from the left to view messages</div>
          </div>
        ) : (<>
          {/* Chat header */}
          <div style={{padding:"10px 16px",borderBottom:"1px solid #0e0e18",background:"#0b0b14",flexShrink:0,display:"flex",alignItems:"center",gap:10}}>
            <Av name={contactName(selConvo.contact_id)} color={channelColor(selConvo.channel)} size={32}/>
            <div style={{flex:1}}>
              <div style={{fontSize:12,color:"#e0dcd0"}}>{contactName(selConvo.contact_id)}</div>
              <div style={{display:"flex",gap:6,alignItems:"center",marginTop:2}}>
                <Bd label={selConvo.channel} color={channelColor(selConvo.channel)}/>
                <span style={{fontSize:8,color:"#333"}}>{selConvo.messages.length} messages</span>
              </div>
            </div>
          </div>
          {/* Messages */}
          <div style={{flex:1,overflowY:"auto",padding:"12px 16px",display:"flex",flexDirection:"column",gap:6}}>
            {chatMessages.map(m=>(
              <div key={m.id} style={{display:"flex",justifyContent:m.direction==="outbound"?"flex-end":"flex-start"}}>
                <div style={{maxWidth:"70%",padding:"8px 12px",borderRadius:m.direction==="outbound"?"12px 12px 2px 12px":"12px 12px 12px 2px",background:m.direction==="outbound"?"rgba(212,175,55,.12)":"#0d0d18",border:`1px solid ${m.direction==="outbound"?"rgba(212,175,55,.25)":"#1e1e28"}`}}>
                  <div style={{fontSize:10,color:"#d4d0c8",lineHeight:1.6,wordBreak:"break-word"}}>{m.content}</div>
                  <div style={{fontSize:7,color:"#333",marginTop:4,textAlign:m.direction==="outbound"?"right":"left"}}>
                    {channelIcon(m.channel||selConvo.channel)} {new Date(m.created_at).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"})}
                  </div>
                </div>
              </div>
            ))}
            <div ref={endRef}/>
          </div>
          {/* Reply box */}
          <div style={{padding:"10px 16px",borderTop:"1px solid #0e0e18",display:"flex",gap:8,flexShrink:0,alignItems:"center"}}>
            <span style={{fontSize:10,color:channelColor(selConvo.channel),flexShrink:0}}>{channelIcon(selConvo.channel)}</span>
            <input value={replyBody} onChange={e=>setReplyBody(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendReply();}}} placeholder={`Reply via ${selConvo.channel}...`} style={{flex:1,background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"8px 12px",outline:"none"}}/>
            <button onClick={sendReply} disabled={sending||!replyBody.trim()} style={{background:"linear-gradient(135deg,#d4af37,#8b6914)",border:"none",color:"#000",borderRadius:4,padding:"0 16px",height:32,cursor:sending?"wait":"pointer",fontFamily:"inherit",fontSize:10,fontWeight:600,letterSpacing:".08em"}}>SEND</button>
          </div>
        </>)}
      </div>
    </div>
  );
}

// ─── WHATSAPP MANAGER VIEW ──────────────────────────────────────────────────
function WhatsAppManagerView({ user, contacts, showToast }) {
  const [stats, setStats] = useState({sent:0,delivered:0,read:0,failed:0});
  const [phoneStatus, setPhoneStatus] = useState(null);
  const [templates, setTemplates] = useState([]);
  const [recentConvos, setRecentConvos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("dashboard");
  // Template creation
  const [newTpl, setNewTpl] = useState({name:"",category:"MARKETING",language:"en",body:"",buttons:[]});
  const [tplSaving, setTplSaving] = useState(false);
  // Quick send
  const [qsContact, setQsContact] = useState("");
  const [qsMessage, setQsMessage] = useState("");
  const [qsSending, setQsSending] = useState(false);

  const loadData = useCallback(async ()=>{
    setLoading(true);
    // Stats: count today's WhatsApp messages
    const today = new Date().toISOString().slice(0,10);
    const todayMsgs = await sb("messages","GET",null,`?user_id=eq.${user.id}&channel=eq.whatsapp&created_at=gte.${today}T00:00:00&order=created_at.desc`);
    if(todayMsgs) {
      const sent = todayMsgs.filter(m=>m.direction==="outbound").length;
      const delivered = todayMsgs.filter(m=>m.direction==="outbound"&&m.status==="delivered").length;
      const read = todayMsgs.filter(m=>m.direction==="outbound"&&m.status==="read").length;
      const failed = todayMsgs.filter(m=>m.direction==="outbound"&&m.status==="failed").length;
      setStats({sent,delivered,read,failed});
    }
    // Phone status
    const cfg = await sb("vault_whatsapp_config","GET",null,`?user_id=eq.${user.id}&limit=1`);
    if(cfg?.[0]) setPhoneStatus(cfg[0]);
    // Templates
    const tpls = await sb("vault_wa_templates","GET",null,`?user_id=eq.${user.id}&order=created_at.desc`);
    if(tpls) setTemplates(tpls);
    // Recent WhatsApp conversations
    const recent = await sb("messages","GET",null,`?user_id=eq.${user.id}&channel=eq.whatsapp&order=created_at.desc&limit=50`);
    if(recent) setRecentConvos(recent);
    setLoading(false);
  },[user.id]);

  useEffect(()=>{ loadData(); },[loadData]);

  const saveTemplate = async ()=>{
    if(!newTpl.name.trim()||!newTpl.body.trim()) return;
    setTplSaving(true);
    await sb("vault_wa_templates","POST",{user_id:user.id, name:newTpl.name.trim(), category:newTpl.category, language:newTpl.language, body:newTpl.body.trim(), buttons:newTpl.buttons, status:"pending"});
    setNewTpl({name:"",category:"MARKETING",language:"en",body:"",buttons:[]});
    setTplSaving(false);
    showToast("Template saved");
    loadData();
  };

  const quickSend = async ()=>{
    if(!qsContact||!qsMessage.trim()) return;
    setQsSending(true);
    const contact = contacts.find(c=>c.id===qsContact);
    await sb("messages","POST",{user_id:user.id, channel:"whatsapp", contact_id:qsContact, direction:"outbound", content:qsMessage.trim(), created_at:new Date().toISOString()});
    await n8nPost("whatsapp-send",{to:contact?.phone||qsContact, message:qsMessage.trim()});
    setQsMessage("");
    setQsSending(false);
    showToast("WhatsApp message sent");
    loadData();
  };

  const contactName = cid => {
    const c = contacts.find(x=>x.id===cid);
    return c?.full_name||c?.email||cid?.slice(0,8)||"Unknown";
  };

  const STAT_CARDS = [
    {label:"SENT TODAY",value:stats.sent,icon:"📤",color:"#d4af37"},
    {label:"DELIVERED",value:stats.delivered,icon:"✓",color:"#10b981"},
    {label:"READ",value:stats.read,icon:"👁",color:"#3b82f6"},
    {label:"FAILED",value:stats.failed,icon:"✕",color:"#ef4444"},
  ];

  const TABS = [{id:"dashboard",l:"Dashboard"},{id:"templates",l:"Templates"},{id:"quicksend",l:"Quick Send"},{id:"log",l:"Conv. Log"}];

  return (
    <div style={{flex:1,overflow:"auto",padding:16}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:".15em",color:"#25d366"}}>WHATSAPP MANAGER</div>
          <div style={{fontSize:8,color:"#333",letterSpacing:".08em"}}>WHATSAPP BUSINESS MANAGEMENT</div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{background:tab===t.id?"rgba(37,211,102,.08)":"none",border:`1px solid ${tab===t.id?"rgba(37,211,102,.25)":"transparent"}`,color:tab===t.id?"#25d366":"#444",fontFamily:"inherit",fontSize:9,padding:"4px 12px",borderRadius:3,cursor:"pointer",letterSpacing:".06em"}}>{t.l}</button>
          ))}
        </div>
      </div>

      {loading&&<div className="pulse" style={{textAlign:"center",padding:30,color:"#25d366",fontSize:10}}>Loading WhatsApp data...</div>}

      {!loading&&tab==="dashboard"&&(
        <div className="fi">
          {/* Stat cards */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:12,marginBottom:16}}>
            {STAT_CARDS.map(s=>(
              <div key={s.label} style={{background:"#0d0d18",border:`1px solid ${s.color}22`,borderRadius:6,padding:"16px 14px",textAlign:"center"}}>
                <div style={{fontSize:20,marginBottom:6}}>{s.icon}</div>
                <div style={{fontSize:24,color:s.color,fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".1em"}}>{s.value}</div>
                <div style={{fontSize:8,color:"#444",letterSpacing:".1em",marginTop:4}}>{s.label}</div>
              </div>
            ))}
          </div>
          {/* Phone number status */}
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px",marginBottom:16}}>
            <div style={{fontSize:9,color:"#25d366",letterSpacing:".12em",marginBottom:8}}>◉ PHONE NUMBER STATUS</div>
            {phoneStatus ? (
              <div style={{display:"flex",gap:20,alignItems:"center"}}>
                <div><div style={{fontSize:8,color:"#444"}}>NUMBER</div><div style={{fontSize:13,color:"#e0dcd0"}}>{phoneStatus.phone_number||"Not configured"}</div></div>
                <div><div style={{fontSize:8,color:"#444"}}>STATUS</div><Bd label={phoneStatus.status||"unknown"} color={phoneStatus.status==="active"?"#10b981":"#f59e0b"}/></div>
                <div><div style={{fontSize:8,color:"#444"}}>DISPLAY NAME</div><div style={{fontSize:10,color:"#888"}}>{phoneStatus.display_name||"—"}</div></div>
                <div><div style={{fontSize:8,color:"#444"}}>QUALITY</div><Bd label={phoneStatus.quality_rating||"—"} color={phoneStatus.quality_rating==="GREEN"?"#10b981":"#f59e0b"}/></div>
              </div>
            ) : (
              <div style={{fontSize:10,color:"#333"}}>No WhatsApp Business number configured. Add configuration in vault_whatsapp_config table.</div>
            )}
          </div>
        </div>
      )}

      {!loading&&tab==="templates"&&(
        <div className="fi" style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
          {/* Template list */}
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid #0e0e18"}}>
              <div style={{fontSize:9,color:"#25d366",letterSpacing:".12em"}}>MESSAGE TEMPLATES</div>
            </div>
            <div style={{overflowY:"auto",maxHeight:450}}>
              {templates.length===0&&<div style={{padding:30,textAlign:"center",color:"#1e1e2e",fontSize:10}}>No templates yet</div>}
              {templates.map(t=>(
                <div key={t.id} style={{padding:"10px 14px",borderBottom:"1px solid #0a0a14"}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4}}>
                    <span style={{fontSize:10,color:"#e0dcd0"}}>{t.name}</span>
                    <div style={{display:"flex",gap:4}}>
                      <Bd label={t.category} color="#25d366"/>
                      <Bd label={t.status||"pending"} color={t.status==="APPROVED"?"#10b981":"#f59e0b"}/>
                    </div>
                  </div>
                  <div style={{fontSize:9,color:"#555",lineHeight:1.5}}>{t.body?.slice(0,120)}{t.body?.length>120?"...":""}</div>
                  <div style={{fontSize:7,color:"#2a2a3a",marginTop:4}}>{t.language} | Created {ago(t.created_at)}</div>
                </div>
              ))}
            </div>
          </div>
          {/* Create template */}
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:16}}>
            <div style={{fontSize:9,color:"#25d366",letterSpacing:".12em",marginBottom:12}}>CREATE NEW TEMPLATE</div>
            <Fld label="TEMPLATE NAME"><Inp value={newTpl.name} onChange={v=>setNewTpl(p=>({...p,name:v}))} placeholder="e.g. welcome_message"/></Fld>
            <Fld label="CATEGORY">
              <Sel value={newTpl.category} onChange={v=>setNewTpl(p=>({...p,category:v}))} options={[{value:"MARKETING",label:"Marketing"},{value:"UTILITY",label:"Utility"},{value:"AUTHENTICATION",label:"Authentication"}]}/>
            </Fld>
            <Fld label="LANGUAGE">
              <Sel value={newTpl.language} onChange={v=>setNewTpl(p=>({...p,language:v}))} options={[{value:"en",label:"English"},{value:"es",label:"Spanish"},{value:"pt_BR",label:"Portuguese (BR)"},{value:"fr",label:"French"}]}/>
            </Fld>
            <Fld label="BODY TEXT">
              <textarea value={newTpl.body} onChange={e=>setNewTpl(p=>({...p,body:e.target.value}))} rows={5} placeholder="Hello {{1}}, thank you for your interest..." style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3,resize:"vertical",lineHeight:1.6}}/>
            </Fld>
            <div style={{fontSize:8,color:"#333",marginBottom:10}}>Use {"{{1}}"}, {"{{2}}"} etc. for variables</div>
            <Btn onClick={saveTemplate} variant="green" disabled={tplSaving||!newTpl.name.trim()||!newTpl.body.trim()} style={{width:"100%",padding:"9px"}}>
              {tplSaving?"SAVING...":"SAVE TEMPLATE"}
            </Btn>
          </div>
        </div>
      )}

      {!loading&&tab==="quicksend"&&(
        <div className="fi" style={{maxWidth:500}}>
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:16}}>
            <div style={{fontSize:9,color:"#25d366",letterSpacing:".12em",marginBottom:12}}>QUICK SEND VIA WHATSAPP</div>
            <Fld label="SELECT CONTACT">
              <Sel value={qsContact} onChange={setQsContact} options={[{value:"",label:"— Choose contact —"},...contacts.filter(c=>c.phone).map(c=>({value:c.id,label:`${c.full_name} (${c.phone})`}))]}/>
            </Fld>
            <Fld label="MESSAGE">
              <textarea value={qsMessage} onChange={e=>setQsMessage(e.target.value)} rows={4} placeholder="Type your WhatsApp message..." style={{width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:11,padding:"8px 12px",borderRadius:3,resize:"vertical",lineHeight:1.6}}/>
            </Fld>
            <Btn onClick={quickSend} variant="green" disabled={qsSending||!qsContact||!qsMessage.trim()} style={{width:"100%",padding:"10px"}}>
              {qsSending?<span className="pulse">Sending...</span>:"◉ SEND WHATSAPP MESSAGE"}
            </Btn>
          </div>
        </div>
      )}

      {!loading&&tab==="log"&&(
        <div className="fi">
          <div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden"}}>
            <div style={{padding:"10px 14px",borderBottom:"1px solid #0e0e18",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:9,color:"#25d366",letterSpacing:".12em"}}>RECENT WHATSAPP CONVERSATIONS</div>
              <span style={{fontSize:8,color:"#333"}}>{recentConvos.length} messages</span>
            </div>
            <div style={{overflowY:"auto",maxHeight:500}}>
              {recentConvos.length===0&&<div style={{padding:30,textAlign:"center",color:"#1e1e2e",fontSize:10}}>No WhatsApp messages yet</div>}
              {recentConvos.map(m=>(
                <div key={m.id} style={{padding:"8px 14px",borderBottom:"1px solid #0a0a14",display:"flex",gap:10,alignItems:"center"}}>
                  <span style={{fontSize:11,flexShrink:0}}>{m.direction==="inbound"?"📥":"📤"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:2}}>
                      <span style={{fontSize:10,color:"#e0dcd0"}}>{contactName(m.contact_id)}</span>
                      <span style={{fontSize:7,color:"#2a2a3a"}}>{ago(m.created_at)}</span>
                    </div>
                    <div style={{fontSize:9,color:"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.content}</div>
                  </div>
                  <Bd label={m.direction} color={m.direction==="inbound"?"#3b82f6":"#25d366"}/>
                  {m.status&&<Bd label={m.status} color={m.status==="read"?"#10b981":m.status==="delivered"?"#3b82f6":m.status==="failed"?"#ef4444":"#555"}/>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TELEGRAM HELPER ───────────────────────────────────────────────────────
const KEN_ID = "b7a67688-73f1-4f4b-9745-f357e81affa3";
async function sendTelegram(message) {
  const cfg = await sb("vault_telegram_config","GET",null,`?user_id=eq.${KEN_ID}&is_active=eq.true&limit=1`);
  if (!cfg?.[0]?.bot_token || !cfg[0]?.chat_id) return;
  try {
    await fetch(`https://api.telegram.org/bot${cfg[0].bot_token}/sendMessage`, {
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ chat_id:cfg[0].chat_id, text:message, parse_mode:"HTML" })
    });
  } catch(e) { console.error("Telegram send error:",e); }
}

// ─── AUDIT LOG HELPER ────────────────────────────────────────────────────────
async function auditLog(userId, action, entityType, entityId, details={}) {
  return sb("vault_audit_log","POST",{user_id:userId, action, entity_type:entityType, entity_id:entityId, details});
}

// ─── AUTOMATION ENGINE ───────────────────────────────────────────────────────
async function runAutomations(triggerType, triggerData, userId) {
  const autos = await sb("vault_automations","GET",null,`?trigger_type=eq.${triggerType}&is_active=eq.true`);
  if (!autos?.length) return;
  for (const auto of autos) {
    const cfg = auto.trigger_config||{};
    // Check trigger config matches
    if (cfg.stage && cfg.stage !== triggerData.stage) continue;
    if (cfg.status && cfg.status !== triggerData.status) continue;
    // Execute actions
    for (const act of (auto.actions||[])) {
      if (act.type==="send_telegram") {
        const msg = (act.message||act.body||"").replace(/\{(\w+)\}/g,(_,k)=>triggerData[k]||k);
        await sendTelegram(msg);
      }
      if (act.type==="send_sms" && triggerData.contact_phone) {
        const smsBody = (act.body||act.message||"").replace(/\{(\w+)\}/g,(_,k)=>triggerData[k]||k);
        await n8nPost("vault-sms", { to:triggerData.contact_phone, body:smsBody, automation:auto.name });
      }
      if (act.type==="send_email" && triggerData.contact_email) {
        const emailBody = (act.body||act.message||"").replace(/\{(\w+)\}/g,(_,k)=>triggerData[k]||k);
        await n8nPost("vault-email", { to:triggerData.contact_email, subject:act.subject||`Update from Ziarem`, body:emailBody, automation:auto.name });
      }
      if (act.type==="create_task" && triggerData.contact_id) {
        await sb("crm_tasks","POST",{title:act.title||"Follow up",type:"task",status:"pending",contact_id:triggerData.contact_id,assigned_to:userId});
      }
      if (act.type==="change_status" && triggerData.contact_id) {
        await sb("contacts","PATCH",{lead_status:act.status||"contacted"},`?id=eq.${triggerData.contact_id}`);
      }
      if (act.type==="assign_to" && triggerData.contact_id) {
        await sb("contacts","PATCH",{assigned_to:act.user_id},`?id=eq.${triggerData.contact_id}`);
      }
      if (act.type==="notify") {
        await sb("vault_call_notifications","POST",{call_id:null,recipient_id:KEN_ID,type:"automation",message:act.message||`Automation "${auto.name}" fired`,is_read:false});
      }
    }
  }
}

// ─── APPOINTMENTS VIEW ──────────────────────────────────────────────────────
function AppointmentsView({ user, contacts, businesses, showToast }) {
  const [appts, setAppts] = useState([]);
  const [team, setTeam] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("upcoming");
  const [selAppt, setSelAppt] = useState(null);

  useEffect(()=>{
    sb("vault_appointments","GET",null,"?order=start_at.desc&limit=200").then(a=>{ if(a) setAppts(a); });
    fetchAllTeam().then(t=>{ if(t) setTeam(t); });
  },[]);

  const now = new Date();
  const filtered = useMemo(()=>{
    if(filter==="upcoming") return appts.filter(a=>new Date(a.start_at)>=now&&a.status!=="cancelled");
    if(filter==="today") return appts.filter(a=>new Date(a.start_at).toDateString()===now.toDateString());
    if(filter==="past") return appts.filter(a=>new Date(a.start_at)<now);
    if(filter==="cancelled") return appts.filter(a=>a.status==="cancelled");
    return appts;
  },[appts,filter]);

  const contactName = id => contacts.find(c=>c.id===id)?.full_name||"Unknown";
  const memberName = id => team.find(t=>t.user_id===id)?.display_name||"Unassigned";

  const save = async (data) => {
    const r = await sb("vault_appointments","POST",{...data,created_by:user.id});
    if(r?.[0]) { setAppts(p=>[r[0],...p]); showToast("Appointment booked"); auditLog(user.id,"create","appointment",r[0].id,{title:data.title}); sendTelegram(`📅 <b>New Appointment</b>\n${data.title}\n${new Date(data.start_at).toLocaleString()}\nContact: ${contactName(data.contact_id)}`); }
    setShowNew(false);
  };

  const cancel = async (id) => {
    await sb("vault_appointments","PATCH",{status:"cancelled"},`?id=eq.${id}`);
    setAppts(p=>p.map(a=>a.id===id?{...a,status:"cancelled"}:a));
    showToast("Appointment cancelled");
  };

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>
      {showNew&&(
        <Modal onClose={()=>setShowNew(false)} title="📅 NEW APPOINTMENT" width="550px">
          <AppointmentForm contacts={contacts} businesses={businesses} team={team} onSave={save} onClose={()=>setShowNew(false)} />
        </Modal>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>APPOINTMENTS</div>
          <div style={{fontSize:9,color:"#444"}}>{appts.filter(a=>new Date(a.start_at).toDateString()===now.toDateString()).length} TODAY · {appts.filter(a=>new Date(a.start_at)>=now&&a.status==="scheduled").length} UPCOMING</div>
        </div>
        <Btn onClick={()=>setShowNew(true)} variant="gold">+ NEW APPOINTMENT</Btn>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {["all","upcoming","today","past","cancelled"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?"rgba(212,175,55,.1)":"none",border:`1px solid ${filter===f?"rgba(212,175,55,.4)":"#1a1a28"}`,color:filter===f?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"4px 12px",borderRadius:3,cursor:"pointer",textTransform:"uppercase"}}>{f}</button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {filtered.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e",fontSize:10}}>No appointments</div>}
        {filtered.map(a=>{
          const isPast = new Date(a.start_at)<now;
          const isToday = new Date(a.start_at).toDateString()===now.toDateString();
          return (
            <div key={a.id} style={{background:"#0d0d18",border:`1px solid ${isToday?"rgba(212,175,55,.2)":"#1e1e28"}`,borderRadius:6,padding:"12px 16px",display:"flex",gap:14,alignItems:"center",opacity:a.status==="cancelled"?.4:1}}>
              <div style={{width:48,textAlign:"center",flexShrink:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:isToday?"#d4af37":"#555"}}>{new Date(a.start_at).getDate()}</div>
                <div style={{fontSize:7,color:"#444",textTransform:"uppercase"}}>{new Date(a.start_at).toLocaleDateString("en",{month:"short"})}</div>
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,color:"#e0dcd0",marginBottom:2}}>{a.title||"Appointment"}</div>
                <div style={{fontSize:9,color:"#555"}}>{new Date(a.start_at).toLocaleTimeString("en",{hour:"numeric",minute:"2-digit"})} · {contactName(a.contact_id)} · {memberName(a.assigned_to)}</div>
                {a.location&&<div style={{fontSize:8,color:"#444",marginTop:2}}>📍 {a.location}</div>}
              </div>
              <Bd label={a.status} color={a.status==="scheduled"?"#10b981":a.status==="completed"?"#3b82f6":"#ef4444"} />
              {a.status==="scheduled"&&<button onClick={()=>cancel(a.id)} style={{background:"none",border:"1px solid rgba(239,68,68,.2)",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:7,padding:"2px 6px",borderRadius:2}}>CANCEL</button>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AppointmentForm({ contacts, businesses, team, onSave, onClose }) {
  const [f, setF] = useState({title:"",contact_id:"",business_id:"",assigned_to:"",start_at:"",end_at:"",location:"",meeting_url:"",notes:""});
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  return (<>
    <Fld label="TITLE"><Inp value={f.title} onChange={v=>s("title",v)} placeholder="Meeting with client" /></Fld>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="CONTACT"><Sel value={f.contact_id} onChange={v=>s("contact_id",v)} options={[{value:"",label:"Select..."},...contacts.slice(0,100).map(c=>({value:c.id,label:c.full_name}))]} /></Fld>
      <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"Select..."},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
      <Fld label="ASSIGNED TO"><Sel value={f.assigned_to} onChange={v=>s("assigned_to",v)} options={[{value:"",label:"Select..."},...team.map(t=>({value:t.user_id,label:t.display_name||t.email}))]} /></Fld>
      <Fld label="START"><Inp type="datetime-local" value={f.start_at} onChange={v=>s("start_at",v)} /></Fld>
    </div>
    <Fld label="LOCATION"><Inp value={f.location} onChange={v=>s("location",v)} placeholder="Office or address" /></Fld>
    <Fld label="MEETING URL"><Inp value={f.meeting_url} onChange={v=>s("meeting_url",v)} placeholder="https://zoom.us/..." /></Fld>
    <Fld label="NOTES"><Inp value={f.notes} onChange={v=>s("notes",v)} placeholder="Preparation notes..." /></Fld>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave({...f,start_at:f.start_at?new Date(f.start_at).toISOString():new Date().toISOString()})} variant="gold" disabled={!f.title}>BOOK</Btn>
    </div>
  </>);
}

// ─── INVOICES VIEW ──────────────────────────────────────────────────────────
function InvoicesView({ user, contacts, businesses, showToast }) {
  const [invoices, setInv] = useState([]);
  const [showNew, setShowNew] = useState(false);
  const [filter, setFilter] = useState("all");

  useEffect(()=>{
    sb("vault_invoices","GET",null,"?order=created_at.desc&limit=200").then(i=>{ if(i) setInv(i); });
  },[]);

  const filtered = invoices.filter(i=>filter==="all"||i.status===filter);
  const totalRev = invoices.filter(i=>i.status==="paid").reduce((s,i)=>s+Number(i.total||0),0);
  const totalPending = invoices.filter(i=>i.status==="sent").reduce((s,i)=>s+Number(i.total||0),0);
  const contactName = id => contacts.find(c=>c.id===id)?.full_name||"Unknown";

  const save = async (data) => {
    const num = `INV-${Date.now().toString(36).toUpperCase()}`;
    const r = await sb("vault_invoices","POST",{...data,invoice_number:num,created_by:user.id});
    if(r?.[0]) { setInv(p=>[r[0],...p]); showToast(`Invoice ${num} created`); auditLog(user.id,"create","invoice",r[0].id,{total:data.total}); sendTelegram(`💰 <b>New Invoice</b>\n#${num} — $${Number(data.total||0).toLocaleString()}\nStatus: ${data.status||"draft"}`); }
    setShowNew(false);
  };

  const sendInv = async (inv) => {
    await sb("vault_invoices","PATCH",{status:"sent"},`?id=eq.${inv.id}`);
    setInv(p=>p.map(i=>i.id===inv.id?{...i,status:"sent"}:i));
    showToast(`Invoice sent to ${contactName(inv.contact_id)}`);
    sendTelegram(`💰 <b>Invoice Sent</b>\n#${inv.invoice_number} — $${Number(inv.total||0).toLocaleString()}\nTo: ${contactName(inv.contact_id)}`);
  };

  const markPaid = async (inv) => {
    await sb("vault_invoices","PATCH",{status:"paid",paid_at:new Date().toISOString()},`?id=eq.${inv.id}`);
    setInv(p=>p.map(i=>i.id===inv.id?{...i,status:"paid",paid_at:new Date().toISOString()}:i));
    showToast("Invoice marked as paid");
    sendTelegram(`✅ <b>Payment Received</b>\n#${inv.invoice_number} — $${Number(inv.total||0).toLocaleString()}`);
  };

  const statusColors = {draft:"#f59e0b",sent:"#3b82f6",paid:"#10b981",overdue:"#ef4444",cancelled:"#555"};

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>
      {showNew&&(
        <Modal onClose={()=>setShowNew(false)} title="💰 NEW INVOICE" width="620px">
          <InvoiceForm contacts={contacts} businesses={businesses} onSave={save} onClose={()=>setShowNew(false)} />
        </Modal>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>INVOICES</div>
          <div style={{fontSize:9,color:"#444"}}>${totalRev.toLocaleString()} COLLECTED · ${totalPending.toLocaleString()} PENDING</div>
        </div>
        <Btn onClick={()=>setShowNew(true)} variant="gold">+ NEW INVOICE</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
        {[{l:"TOTAL REVENUE",v:`$${totalRev.toLocaleString()}`,c:"#10b981"},{l:"PENDING",v:`$${totalPending.toLocaleString()}`,c:"#3b82f6"},{l:"INVOICES SENT",v:invoices.filter(i=>i.status!=="draft").length,c:"#d4af37"},{l:"OVERDUE",v:invoices.filter(i=>i.status==="overdue"||( i.status==="sent"&&i.due_at&&new Date(i.due_at)<new Date())).length,c:"#ef4444"}].map(s=>(
          <div key={s.l} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"10px 12px"}}>
            <div style={{fontSize:7,color:"#444",letterSpacing:".1em",marginBottom:3}}>{s.l}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {["all","draft","sent","paid","overdue"].map(f=>(
          <button key={f} onClick={()=>setFilter(f)} style={{background:filter===f?"rgba(212,175,55,.1)":"none",border:`1px solid ${filter===f?"rgba(212,175,55,.4)":"#1a1a28"}`,color:filter===f?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"4px 12px",borderRadius:3,cursor:"pointer",textTransform:"uppercase"}}>{f}</button>
        ))}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {filtered.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e",fontSize:10}}>No invoices</div>}
        {filtered.map(inv=>(
          <div key={inv.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"12px 16px",display:"flex",gap:14,alignItems:"center"}}>
            <div style={{flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:2}}>
                <span style={{fontSize:11,color:"#d4af37",fontFamily:"monospace"}}>{inv.invoice_number}</span>
                <Bd label={inv.status} color={statusColors[inv.status]||"#555"} />
                <span style={{fontSize:9,color:"#555"}}>{contactName(inv.contact_id)}</span>
              </div>
              <div style={{fontSize:9,color:"#444"}}>{(inv.items||[]).length} items · Due: {inv.due_at?fmt(inv.due_at):"—"}</div>
            </div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:"#e0dcd0"}}>${Number(inv.total||0).toLocaleString()}</div>
            <div style={{display:"flex",gap:4}}>
              {inv.status==="draft"&&<Btn onClick={()=>sendInv(inv)} variant="gold" style={{fontSize:7,padding:"3px 8px"}}>SEND</Btn>}
              {inv.status==="sent"&&<Btn onClick={()=>markPaid(inv)} variant="green" style={{fontSize:7,padding:"3px 8px"}}>MARK PAID</Btn>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InvoiceForm({ contacts, businesses, onSave, onClose }) {
  const [f, setF] = useState({contact_id:"",business_id:"",due_at:"",notes:""});
  const [items, setItems] = useState([{desc:"",qty:1,rate:0}]);
  const subtotal = items.reduce((s,i)=>s+i.qty*i.rate,0);
  const tax = subtotal*0.0;
  const total = subtotal+tax;
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="CLIENT"><Sel value={f.contact_id} onChange={v=>s("contact_id",v)} options={[{value:"",label:"Select..."},...contacts.slice(0,100).map(c=>({value:c.id,label:c.full_name}))]} /></Fld>
      <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"Select..."},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
    </div>
    <Fld label="DUE DATE"><Inp type="date" value={f.due_at} onChange={v=>s("due_at",v)} /></Fld>
    <div style={{fontSize:9,color:"#d4af37",letterSpacing:".1em",marginBottom:6}}>LINE ITEMS</div>
    {items.map((item,i)=>(
      <div key={i} style={{display:"grid",gridTemplateColumns:"3fr 1fr 1fr auto",gap:8,marginBottom:6,alignItems:"end"}}>
        <Fld label={i===0?"DESCRIPTION":""}><Inp value={item.desc} onChange={v=>setItems(p=>p.map((x,j)=>j===i?{...x,desc:v}:x))} placeholder="Service description" /></Fld>
        <Fld label={i===0?"QTY":""}><Inp type="number" value={item.qty} onChange={v=>setItems(p=>p.map((x,j)=>j===i?{...x,qty:Number(v)||0}:x))} /></Fld>
        <Fld label={i===0?"RATE":""}><Inp type="number" value={item.rate} onChange={v=>setItems(p=>p.map((x,j)=>j===i?{...x,rate:Number(v)||0}:x))} /></Fld>
        <button onClick={()=>setItems(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:12,marginBottom:8}}>✕</button>
      </div>
    ))}
    <button onClick={()=>setItems(p=>[...p,{desc:"",qty:1,rate:0}])} style={{background:"none",border:"1px dashed #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 12px",borderRadius:3,marginBottom:12}}>+ ADD ITEM</button>
    <div style={{display:"flex",justifyContent:"flex-end",gap:20,marginBottom:12,fontSize:11}}>
      <span style={{color:"#555"}}>Subtotal: <span style={{color:"#e0dcd0"}}>${subtotal.toLocaleString()}</span></span>
      <span style={{color:"#d4af37",fontWeight:600}}>Total: ${total.toLocaleString()}</span>
    </div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave({...f,items,subtotal,tax,total,due_at:f.due_at?new Date(f.due_at).toISOString():null})} variant="gold" disabled={!f.contact_id||items.length===0}>CREATE INVOICE</Btn>
    </div>
  </>);
}

// ─── AUTOMATIONS VIEW ───────────────────────────────────────────────────────
function AutomationsView({ user, showToast }) {
  const [autos, setAutos] = useState([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(()=>{
    sb("vault_automations","GET",null,"?order=created_at.desc").then(a=>{ if(a) setAutos(a); });
  },[]);

  const toggle = async (auto) => {
    await sb("vault_automations","PATCH",{is_active:!auto.is_active},`?id=eq.${auto.id}`);
    setAutos(p=>p.map(a=>a.id===auto.id?{...a,is_active:!a.is_active}:a));
  };

  const del = async id => {
    await sb("vault_automations","DELETE",null,`?id=eq.${id}`);
    setAutos(p=>p.filter(a=>a.id!==id));
    showToast("Automation deleted");
  };

  const save = async (data) => {
    const r = await sb("vault_automations","POST",{...data,created_by:user.id});
    if(r?.[0]) setAutos(p=>[r[0],...p]);
    showToast("Automation created");
    setShowNew(false);
  };

  const triggerLabels = {deal_stage_change:"Deal Stage Changed",lead_status_change:"Lead Status Changed",new_contact:"New Contact Added",callback_due:"Callback Due",deal_closed:"Deal Closed",new_call:"New Call Logged",appointment_booked:"Appointment Booked"};
  const actionLabels = {send_sms:"Send SMS",send_email:"Send Email",create_task:"Create Task",notify:"Notify Ken (in-app)",send_telegram:"Send Telegram",change_status:"Change Status"};

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>
      {showNew&&(
        <Modal onClose={()=>setShowNew(false)} title="⚡ NEW AUTOMATION" width="620px">
          <AutomationForm triggerLabels={triggerLabels} actionLabels={actionLabels} onSave={save} onClose={()=>setShowNew(false)} />
        </Modal>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>AUTOMATIONS</div>
          <div style={{fontSize:9,color:"#444"}}>{autos.filter(a=>a.is_active).length} ACTIVE · {autos.length} TOTAL</div>
        </div>
        <Btn onClick={()=>setShowNew(true)} variant="gold">+ NEW AUTOMATION</Btn>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {autos.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e",fontSize:10}}>No automations yet — create one to automate your workflows</div>}
        {autos.map(auto=>(
          <div key={auto.id} style={{background:"#0d0d18",border:`1px solid ${auto.is_active?"rgba(16,185,129,.15)":"#1e1e28"}`,borderRadius:6,padding:"14px 16px",opacity:auto.is_active?1:.5}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <span style={{fontSize:12,color:auto.is_active?"#10b981":"#555"}}>⚡</span>
              <span style={{fontSize:12,color:"#e0dcd0"}}>{auto.name}</span>
              <Bd label={auto.is_active?"ACTIVE":"OFF"} color={auto.is_active?"#10b981":"#555"} />
              <div style={{flex:1}} />
              <button onClick={()=>toggle(auto)} style={{background:auto.is_active?"rgba(16,185,129,.1)":"rgba(245,158,11,.1)",border:`1px solid ${auto.is_active?"rgba(16,185,129,.3)":"rgba(245,158,11,.3)"}`,color:auto.is_active?"#10b981":"#f59e0b",cursor:"pointer",fontFamily:"inherit",fontSize:7,padding:"2px 8px",borderRadius:2}}>{auto.is_active?"ON":"OFF"}</button>
              <button onClick={()=>del(auto.id)} style={{background:"none",border:"1px solid rgba(239,68,68,.2)",color:"#ef4444",cursor:"pointer",fontFamily:"inherit",fontSize:7,padding:"2px 6px",borderRadius:2}}>DEL</button>
            </div>
            <div style={{fontSize:9,color:"#888",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{color:"#f59e0b"}}>WHEN</span> {triggerLabels[auto.trigger_type]||auto.trigger_type}
              {auto.trigger_config?.stage&&<Bd label={auto.trigger_config.stage} color="#8b5cf6" />}
              <span style={{color:"#3b82f6"}}>→ THEN</span>
              {(auto.actions||[]).map((a,i)=><Bd key={i} label={actionLabels[a.type]||a.type} color="#10b981" />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AutomationForm({ triggerLabels, actionLabels, onSave, onClose }) {
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState("deal_stage_change");
  const [trigCfg, setTrigCfg] = useState({});
  const [actions, setActions] = useState([{type:"send_telegram",message:""}]);

  return (<>
    <Fld label="AUTOMATION NAME"><Inp value={name} onChange={v=>setName(v)} placeholder="e.g. Notify on underwriting" /></Fld>
    <Fld label="TRIGGER (WHEN)">
      <Sel value={trigger} onChange={v=>setTrigger(v)} options={Object.entries(triggerLabels).map(([k,v])=>({value:k,label:v}))} />
    </Fld>
    {(trigger==="deal_stage_change")&&<Fld label="STAGE"><Sel value={trigCfg.stage||""} onChange={v=>setTrigCfg({stage:v})} options={[{value:"",label:"Any"},...Object.entries(STAGE_CFG).map(([k,v])=>({value:k,label:v.l}))]} /></Fld>}
    {(trigger==="lead_status_change")&&<Fld label="STATUS"><Sel value={trigCfg.status||""} onChange={v=>setTrigCfg({status:v})} options={[{value:"",label:"Any"},...Object.entries(LEAD_STATUS_CFG).map(([k,v])=>({value:k,label:v.l}))]} /></Fld>}
    <div style={{fontSize:9,color:"#3b82f6",letterSpacing:".08em",marginBottom:6,marginTop:8}}>ACTIONS (THEN)</div>
    {actions.map((act,i)=>(
      <div key={i} style={{background:"#0a0a14",border:"1px solid #1e1e28",borderRadius:4,padding:10,marginBottom:6}}>
        <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:6}}>
          <Sel value={act.type} onChange={v=>setActions(p=>p.map((a,j)=>j===i?{...a,type:v}:a))} options={Object.entries(actionLabels).map(([k,v])=>({value:k,label:v}))} style={{flex:1}} />
          <button onClick={()=>setActions(p=>p.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:"#ef4444",cursor:"pointer",fontSize:10}}>✕</button>
        </div>
        {(act.type==="send_telegram"||act.type==="send_sms"||act.type==="notify")&&(
          <Inp value={act.message||""} onChange={v=>setActions(p=>p.map((a,j)=>j===i?{...a,message:v}:a))} placeholder="Message text... use {contact_name}, {deal_title}, {stage}" />
        )}
        {act.type==="create_task"&&<Inp value={act.title||""} onChange={v=>setActions(p=>p.map((a,j)=>j===i?{...a,title:v}:a))} placeholder="Task title..." />}
      </div>
    ))}
    <button onClick={()=>setActions(p=>[...p,{type:"send_telegram",message:""}])} style={{background:"none",border:"1px dashed #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",fontSize:8,padding:"4px 12px",borderRadius:3,marginBottom:12}}>+ ADD ACTION</button>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave({name,trigger_type:trigger,trigger_config:trigCfg,actions})} variant="gold" disabled={!name}>CREATE</Btn>
    </div>
  </>);
}

// ─── COMPLIANCE VIEW ────────────────────────────────────────────────────────
function ComplianceView({ user, businesses, showToast }) {
  const [items, setItems] = useState([]);
  const [showNew, setShowNew] = useState(false);

  useEffect(()=>{
    sb("vault_compliance","GET",null,"?order=expiry_date").then(c=>{ if(c) setItems(c); });
  },[]);

  const save = async (data) => {
    const r = await sb("vault_compliance","POST",{...data,created_by:user.id});
    if(r?.[0]) setItems(p=>[...p,r[0]].sort((a,b)=>new Date(a.expiry_date)-new Date(b.expiry_date)));
    showToast("Compliance item added");
    setShowNew(false);
  };

  const now = new Date();
  const expiring = items.filter(i=>i.expiry_date&&i.status==="active").map(i=>{
    const days = Math.floor((new Date(i.expiry_date)-now)/86400000);
    return {...i, daysLeft:days, urgency:days<0?"expired":days<7?"critical":days<30?"warning":"ok"};
  });

  const bizName = id => businesses.find(b=>b.id===id)?.name||"General";

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>
      {showNew&&(
        <Modal onClose={()=>setShowNew(false)} title="📋 ADD COMPLIANCE ITEM" width="550px">
          <ComplianceForm businesses={businesses} onSave={save} onClose={()=>setShowNew(false)} />
        </Modal>
      )}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>COMPLIANCE</div>
          <div style={{fontSize:9,color:"#444"}}>{expiring.filter(i=>i.urgency==="expired"||i.urgency==="critical").length} URGENT · {items.length} TRACKED</div>
        </div>
        <Btn onClick={()=>setShowNew(true)} variant="gold">+ ADD ITEM</Btn>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:16}}>
        {[{l:"ACTIVE",v:items.filter(i=>i.status==="active").length,c:"#10b981"},{l:"EXPIRING (<30d)",v:expiring.filter(i=>i.urgency==="warning").length,c:"#f59e0b"},{l:"CRITICAL (<7d)",v:expiring.filter(i=>i.urgency==="critical").length,c:"#ef4444"},{l:"EXPIRED",v:expiring.filter(i=>i.urgency==="expired").length,c:"#ef4444"}].map(s=>(
          <div key={s.l} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"10px 12px"}}>
            <div style={{fontSize:7,color:"#444",letterSpacing:".1em",marginBottom:3}}>{s.l}</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:s.c}}>{s.v}</div>
          </div>
        ))}
      </div>
      {expiring.map(item=>{
        const urgColors = {expired:"#ef4444",critical:"#ef4444",warning:"#f59e0b",ok:"#10b981"};
        return (
          <div key={item.id} style={{background:"#0d0d18",border:`1px solid ${urgColors[item.urgency]}22`,borderRadius:6,padding:"12px 16px",marginBottom:6,display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:40,textAlign:"center",flexShrink:0}}>
              <div style={{fontSize:8,color:urgColors[item.urgency],fontWeight:600}}>{item.daysLeft<0?`${Math.abs(item.daysLeft)}d OVER`:item.daysLeft===0?"TODAY":`${item.daysLeft}d`}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:11,color:"#e0dcd0",marginBottom:2}}>{item.title}</div>
              <div style={{fontSize:8,color:"#555"}}>{item.type} · {bizName(item.business_id)} · {item.license_number||""} · Expires: {item.expiry_date}</div>
            </div>
            <Bd label={item.urgency} color={urgColors[item.urgency]} />
          </div>
        );
      })}
    </div>
  );
}

function ComplianceForm({ businesses, onSave, onClose }) {
  const [f, setF] = useState({type:"license",title:"",business_id:"",entity_name:"",license_number:"",expiry_date:"",reminder_days:30,notes:""});
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  return (<>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="TYPE"><Sel value={f.type} onChange={v=>s("type",v)} options={[{value:"license",label:"License"},{value:"disclosure",label:"Disclosure"},{value:"filing",label:"Filing"},{value:"renewal",label:"Renewal"},{value:"insurance",label:"Insurance"}]} /></Fld>
      <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"General"},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
    </div>
    <Fld label="TITLE"><Inp value={f.title} onChange={v=>s("title",v)} placeholder="NMLS License Renewal" /></Fld>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="LICENSE/REF #"><Inp value={f.license_number} onChange={v=>s("license_number",v)} placeholder="12345" /></Fld>
      <Fld label="EXPIRY DATE"><Inp type="date" value={f.expiry_date} onChange={v=>s("expiry_date",v)} /></Fld>
    </div>
    <Fld label="NOTES"><Inp value={f.notes} onChange={v=>s("notes",v)} placeholder="Renewal requirements..." /></Fld>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave(f)} variant="gold" disabled={!f.title}>ADD</Btn>
    </div>
  </>);
}

// ─── VENDORS & PROJECTS VIEW ────────────────────────────────────────────────
function VendorsView({ user, businesses, showToast }) {
  const [vendors, setVendors] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tab, setTab] = useState("vendors");
  const [showNewVendor, setShowNewVendor] = useState(false);
  const [showNewProject, setShowNewProject] = useState(false);

  useEffect(()=>{
    sb("vault_vendors","GET",null,"?order=name").then(v=>{ if(v) setVendors(v); });
    sb("vault_projects","GET",null,"?order=created_at.desc").then(p=>{ if(p) setProjects(p); });
  },[]);

  const saveVendor = async (data) => {
    const r = await sb("vault_vendors","POST",data);
    if(r?.[0]) setVendors(p=>[...p,r[0]]);
    showToast("Vendor added");
    setShowNewVendor(false);
  };

  const saveProject = async (data) => {
    const r = await sb("vault_projects","POST",data);
    if(r?.[0]) setProjects(p=>[r[0],...p]);
    showToast("Project created");
    setShowNewProject(false);
  };

  const bizName = id => businesses.find(b=>b.id===id)?.name||"—";
  const projStatus = {planning:"#6366f1",in_progress:"#f59e0b",completed:"#10b981",on_hold:"#555"};

  return (
    <div style={{flex:1,overflow:"auto",padding:"18px 20px"}}>
      {showNewVendor&&<Modal onClose={()=>setShowNewVendor(false)} title="🔨 ADD VENDOR" width="500px">
        <VendorForm businesses={businesses} onSave={saveVendor} onClose={()=>setShowNewVendor(false)} />
      </Modal>}
      {showNewProject&&<Modal onClose={()=>setShowNewProject(false)} title="🏗 NEW PROJECT" width="550px">
        <ProjectForm businesses={businesses} vendors={vendors} onSave={saveProject} onClose={()=>setShowNewProject(false)} />
      </Modal>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:".2em",color:"#d4af37"}}>VENDORS & PROJECTS</div>
          <div style={{fontSize:9,color:"#444"}}>{vendors.length} VENDORS · {projects.length} PROJECTS</div>
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn onClick={()=>setShowNewVendor(true)} variant="gold">+ VENDOR</Btn>
          <Btn onClick={()=>setShowNewProject(true)} variant="blue">+ PROJECT</Btn>
        </div>
      </div>
      <div style={{display:"flex",gap:6,marginBottom:14}}>
        {["vendors","projects"].map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{background:tab===t?"rgba(212,175,55,.1)":"none",border:`1px solid ${tab===t?"rgba(212,175,55,.4)":"#1a1a28"}`,color:tab===t?"#d4af37":"#555",fontFamily:"inherit",fontSize:10,padding:"5px 16px",borderRadius:3,cursor:"pointer",textTransform:"uppercase"}}>{t}</button>
        ))}
      </div>
      {tab==="vendors"&&(
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {vendors.map(v=>(
            <div key={v.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"12px 14px"}}>
              <div style={{fontSize:12,color:"#e0dcd0",marginBottom:2}}>{v.name}</div>
              <div style={{fontSize:8,color:"#555",marginBottom:4}}>{v.specialty} · {v.type} · {bizName(v.business_id)}</div>
              <div style={{fontSize:8,color:"#444"}}>{v.contact_name} · {v.phone||""} · {v.email||""}</div>
              {v.rating>0&&<div style={{marginTop:4}}>{"★".repeat(v.rating)}{"☆".repeat(5-v.rating)}</div>}
            </div>
          ))}
          {vendors.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:40,color:"#1e1e2e",fontSize:10}}>No vendors yet</div>}
        </div>
      )}
      {tab==="projects"&&(
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {projects.map(p=>{
            const pctDone = p.milestones?.length?Math.round(p.milestones.filter(m=>m.done).length/p.milestones.length*100):0;
            return (
              <div key={p.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"14px 16px"}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontSize:12,color:"#e0dcd0"}}>{p.name}</span>
                  <Bd label={p.status} color={projStatus[p.status]||"#555"} />
                  <span style={{fontSize:8,color:"#444"}}>{bizName(p.business_id)}</span>
                </div>
                <div style={{display:"flex",gap:20,marginBottom:6,fontSize:9}}>
                  <span style={{color:"#555"}}>Budget: <span style={{color:"#d4af37"}}>${Number(p.budget||0).toLocaleString()}</span></span>
                  <span style={{color:"#555"}}>Spent: <span style={{color:Number(p.spent)>Number(p.budget)?"#ef4444":"#10b981"}}>${Number(p.spent||0).toLocaleString()}</span></span>
                  <span style={{color:"#555"}}>{p.start_date||"?"} → {p.end_date||"?"}</span>
                </div>
                {p.milestones?.length>0&&(
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{flex:1,height:3,background:"#111120",borderRadius:2}}><div style={{width:`${pctDone}%`,height:"100%",background:"#10b981",borderRadius:2}} /></div>
                    <span style={{fontSize:8,color:"#10b981"}}>{pctDone}%</span>
                  </div>
                )}
              </div>
            );
          })}
          {projects.length===0&&<div style={{textAlign:"center",padding:40,color:"#1e1e2e",fontSize:10}}>No projects yet</div>}
        </div>
      )}
    </div>
  );
}

function VendorForm({ businesses, onSave, onClose }) {
  const [f, setF] = useState({name:"",type:"subcontractor",business_id:"",contact_name:"",phone:"",email:"",specialty:"",rating:0,notes:""});
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  return (<>
    <Fld label="VENDOR NAME"><Inp value={f.name} onChange={v=>s("name",v)} placeholder="ABC Construction" /></Fld>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="TYPE"><Sel value={f.type} onChange={v=>s("type",v)} options={[{value:"subcontractor",label:"Subcontractor"},{value:"supplier",label:"Supplier"},{value:"vendor",label:"Vendor"},{value:"consultant",label:"Consultant"}]} /></Fld>
      <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"General"},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
      <Fld label="CONTACT"><Inp value={f.contact_name} onChange={v=>s("contact_name",v)} placeholder="John Doe" /></Fld>
      <Fld label="PHONE"><Inp value={f.phone} onChange={v=>s("phone",v)} placeholder="(555) 123-4567" /></Fld>
    </div>
    <Fld label="EMAIL"><Inp value={f.email} onChange={v=>s("email",v)} placeholder="vendor@example.com" /></Fld>
    <Fld label="SPECIALTY"><Inp value={f.specialty} onChange={v=>s("specialty",v)} placeholder="Plumbing, Electrical, etc." /></Fld>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave(f)} variant="gold" disabled={!f.name}>ADD</Btn>
    </div>
  </>);
}

function ProjectForm({ businesses, vendors, onSave, onClose }) {
  const [f, setF] = useState({name:"",business_id:"",status:"planning",budget:0,start_date:"",end_date:"",notes:""});
  const s = (k,v) => setF(p=>({...p,[k]:v}));
  return (<>
    <Fld label="PROJECT NAME"><Inp value={f.name} onChange={v=>s("name",v)} placeholder="123 Main St Renovation" /></Fld>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
      <Fld label="BUSINESS"><Sel value={f.business_id} onChange={v=>s("business_id",v)} options={[{value:"",label:"Select..."},...businesses.map(b=>({value:b.id,label:b.name}))]} /></Fld>
      <Fld label="BUDGET"><Inp type="number" value={f.budget} onChange={v=>s("budget",Number(v))} /></Fld>
      <Fld label="START DATE"><Inp type="date" value={f.start_date} onChange={v=>s("start_date",v)} /></Fld>
      <Fld label="END DATE"><Inp type="date" value={f.end_date} onChange={v=>s("end_date",v)} /></Fld>
    </div>
    <Fld label="NOTES"><Inp value={f.notes} onChange={v=>s("notes",v)} placeholder="Project scope, permits needed..." /></Fld>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
      <Btn onClick={onClose}>CANCEL</Btn>
      <Btn onClick={()=>onSave(f)} variant="gold" disabled={!f.name}>CREATE</Btn>
    </div>
  </>);
}

// ─── MAIN APP ───────────────────────────────────────────────────────────────
function EmailVault({ user, teamProfile, onSignOut }) {
  const isAdmin = teamProfile?.role==="super_admin"||teamProfile?.role==="admin";
  const [view, setView] = useState(isAdmin ? "dashboard" : "callcenter");
  const [sub, setSub] = useState("pipeline");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  // Presence heartbeat — update last_seen_at every 60s
  useEffect(()=>{
    if(!teamProfile?.id) return;
    const ping = ()=> sb("vault_team","PATCH",{last_seen_at:new Date().toISOString()},`?id=eq.${teamProfile.id}`);
    ping();
    const iv = setInterval(ping, 60000);
    return ()=> clearInterval(iv);
  },[teamProfile?.id]);

  // Core data
  const [businesses, setBiz] = useState([]);
  const [contacts, setCon] = useState([]);
  const [deals, setDeals] = useState([]);
  const [pipelines, setPipes] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [activities, setActs] = useState([]);
  const [documents, setDocs] = useState([]);
  const [folders, setFolders] = useState([]);
  const [intelligence, setIntel] = useState([]);
  const [products, setProds] = useState([]);
  const [campaigns, setCampaigns] = useState([]);

  // Email
  const [emails, setEmails] = useState([]);
  const [selEmail, setSelEmail] = useState(null);
  const [emailAiMode, setEmailAiMode] = useState(null);
  const [emailAiResult, setEmailAiResult] = useState("");
  const [emailAiLoading, setEmailAiLoading] = useState(false);
  const [emailSearch, setEmailSearch] = useState("");
  const [emailFolder, setEmailFolder] = useState("all");
  const [extracting, setExtracting] = useState(false);
  const aiCache = useRef({});

  // Call Center
  const [calls, setCalls] = useState([]);
  const [callParticipants, setCallParts] = useState([]);
  const [callNotifs, setCallNotifs] = useState([]);
  const [selCall, setSelCall] = useState(null);
  const [showNewCall, setShowNewCall] = useState(false);
  const [callFilter, setCallFilter] = useState("all");
  const [callSearch, setCallSearch] = useState("");
  const [showNotifPanel, setShowNotifPanel] = useState(false);

  // Messages
  const [unreadMsgs, setUnreadMsgs] = useState(0);
  useEffect(()=>{
    const loadUnread = ()=> sb("vault_messages","GET",null,`?to_id=eq.${user.id}&is_read=eq.false&select=id`).then(m=>{ if(m) setUnreadMsgs(m.length); });
    loadUnread();
    const iv = setInterval(loadUnread, 10000);
    return ()=> clearInterval(iv);
  },[user.id]);

  // New feature state
  const [appointments, setAppts] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [complianceItems, setCompliance] = useState([]);
  const [referrals, setReferrals] = useState([]);
  const [reviews, setReviews] = useState([]);

  // Spend
  const [spend, setSpend] = useState(getSpend());
  useEffect(()=>onSpendChange(setSpend),[]);

  // Search
  const [showSearch, setShowSearch] = useState(false);

  // UI Modals
  const [showContact, setShowContact] = useState(false);
  const [editContact, setEditContact] = useState(null);
  const [showDeal, setShowDeal] = useState(false);
  const [editDeal, setEditDeal] = useState(null);
  const [showTask, setShowTask] = useState(false);
  const [editTask, setEditTask] = useState(null);
  const [showActivity, setShowActivity] = useState(false);
  const [actContext, setActContext] = useState({});
  const [showDocUpload, setShowDocUpload] = useState(false);
  const [showDocTemplates, setShowDocTemplates] = useState(false);
  const [showCompose, setShowCompose] = useState(false);
  const [showAI, setShowAI] = useState(false);
  const [selContact, setSelContact] = useState(null);
  const [contactSearch, setContactSearch] = useState("");
  const [docSearch, setDocSearch] = useState("");
  const [docFilterBiz, setDocFilterBiz] = useState("");
  const [docFilterCat, setDocFilterCat] = useState("");
  const [dragDeal, setDragDeal] = useState(null);
  const [showPDFImport, setShowPDFImport] = useState(false);
  const [showNurtureSeq, setShowNurtureSeq] = useState(false);
  const [crossSellContact, setCrossSellContact] = useState(null);
  const [crossSellResults, setCrossSellResults] = useState({});
  const [crossSellLoading, setCrossSellLoading] = useState(false);
  const [bulkScanResults, setBulkScanResults] = useState([]);
  const [bulkScanLoading, setBulkScanLoading] = useState(false);
  const [bulkScanProgress, setBulkScanProgress] = useState("");

  const showToast = msg => { setToast(msg); setTimeout(()=>setToast(""),3500); };

  const seedEmails = useCallback(async () => {
    const existing = await sb("vault_emails","GET",null,`?owner_id=eq.${user.id}&order=received_at.desc`);
    if (existing?.length) { setEmails(existing); return; }
    // Fallback: try unscoped (legacy emails without owner_id)
    const legacy = await sb("vault_emails","GET",null,"?owner_id=is.null&order=received_at.desc");
    if (legacy?.length) { setEmails(legacy); return; }
    try {
      const seeded = SEED_EMAILS.map(e=>({...e,owner_id:user.id}));
      const r = await fetch(`${SB_URL}/rest/v1/vault_emails`, {
        method:"POST", headers:{...SBH,Prefer:"resolution=merge-duplicates,return=representation"}, body:JSON.stringify(seeded)
      });
      if (r.ok) { const s=await r.json(); if(s?.length) setEmails(s); }
    } catch {}
  }, [user.id]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [biz,con,d,pip,tsk,act,doc,fld,intel,prod,camp] = (await Promise.allSettled([
      sb("businesses","GET",null,"?order=name"),
      sb("contacts","GET",null,"?order=full_name"),
      sb("crm_deals","GET",null,"?order=created_at.desc"),
      sb("crm_pipelines","GET",null,"?order=name"),
      sb("crm_tasks","GET",null,"?order=due_at,created_at.desc&limit=60"),
      sb("crm_activities","GET",null,"?order=created_at.desc&limit=80"),
      sb("documents","GET",null,"?order=created_at.desc&limit=100"),
      sb("doc_folders","GET",null,"?order=name"),
      sb("email_intelligence","GET",null,"?order=created_at.desc&limit=40"),
      sb("business_products","GET",null,"?order=category,name"),
      sb("marketing_campaigns","GET",null,"?order=created_at.desc"),
    ])).map(r=>r.status==='fulfilled'?r.value:null);
    if(biz) setBiz(biz); if(con) setCon(con); if(d) setDeals(d); if(pip) setPipes(pip);
    if(tsk) setTasks(tsk); if(act) setActs(act); if(doc) setDocs(doc); if(fld) setFolders(fld);
    if(intel) setIntel(intel); if(prod) setProds(prod); if(camp) setCampaigns(camp);
    // Load call center data
    sb("vault_calls","GET",null,"?order=started_at.desc&limit=200").then(c=>{ if(c) setCalls(c); });
    sb("vault_call_participants","GET",null,"?order=call_id").then(p=>{ if(p) setCallParts(p); });
    sb("vault_call_notifications","GET",null,`?recipient_id=eq.${user.id}&order=created_at.desc&limit=50`).then(n=>{ if(n) setCallNotifs(n); });
    // New features data
    sb("vault_appointments","GET",null,"?order=start_at.desc&limit=100").then(a=>{ if(a) setAppts(a); });
    sb("vault_invoices","GET",null,"?order=created_at.desc&limit=100").then(i=>{ if(i) setInvoices(i); });
    sb("vault_compliance","GET",null,"?order=expiry_date&limit=100").then(c=>{ if(c) setCompliance(c); });
    sb("vault_referrals","GET",null,"?order=created_at.desc&limit=100").then(r=>{ if(r) setReferrals(r); });
    sb("vault_reviews","GET",null,"?order=created_at.desc&limit=100").then(r=>{ if(r) setReviews(r); });
    setLoading(false);
  }, []);

  useEffect(() => { loadAll(); seedEmails(); }, [loadAll, seedEmails]);

  // Keyboard shortcut: Cmd/Ctrl+K for search
  useEffect(()=>{
    const h = e=>{ if((e.metaKey||e.ctrlKey)&&e.key==="k"){ e.preventDefault(); setShowSearch(s=>!s); } if(e.key==="Escape") setShowSearch(false); };
    window.addEventListener("keydown",h);
    return ()=>window.removeEventListener("keydown",h);
  },[]);

  const markRead = useCallback(async id => {
    setEmails(p=>p.map(e=>e.id===id?{...e,is_read:true}:e));
    await sb("vault_emails","PATCH",{is_read:true},`?id=eq.${id}`).catch(()=>{});
  }, []);

  const toggleFlag = useCallback(async (id, current) => {
    setEmails(p=>p.map(e=>e.id===id?{...e,is_flagged:!current}:e));
    await sb("vault_emails","PATCH",{is_flagged:!current},`?id=eq.${id}`).catch(()=>{});
  }, []);

  const refresh = () => { loadAll(); };

  // ── Single-contact cross-sell analysis ─────────────────────────
  const runCrossSell = async (contact) => {
    if (crossSellResults[contact.id]) {
      setCrossSellContact(contact); return;          // cached
    }
    setCrossSellContact(contact); setCrossSellLoading(true);
    const opps = await getCrossSellOpportunities(contact, businesses, deals);
    setCrossSellResults(p=>({...p,[contact.id]:opps}));
    setCrossSellLoading(false);
  };

  // ── Bulk cross-sell scan across all scored contacts ─────────────
  const runBulkCrossScan = async () => {
    if (!businesses.length) { showToast("⚠ No businesses configured"); return; }
    setBulkScanLoading(true); setBulkScanResults([]);
    const scored = contacts.map(c=>({...c,score:scoreContact(c,deals,activities)})).sort((a,b)=>b.score-a.score).slice(0,30);
    const out = [];
    for (let i=0;i<scored.length;i++) {
      const c = scored[i];
      setBulkScanProgress(`Scanning ${i+1}/${scored.length}: ${c.full_name}…`);
      const cached = crossSellResults[c.id];
      const opps = cached || await getCrossSellOpportunities(c, businesses, deals);
      if (!cached) setCrossSellResults(p=>({...p,[c.id]:opps}));
      if (opps.length) out.push({contact:c, opps});
    }
    setBulkScanResults(out); setBulkScanLoading(false); setBulkScanProgress("");
    showToast(`🔁 Found ${out.reduce((s,r)=>s+r.opps.length,0)} cross-sell opportunities`);
  };
  const bizFor = id => businesses.find(b=>b.id===id);
  const conFor = id => contacts.find(c=>c.id===id);

  const pendingTasks = tasks.filter(t=>t.status==="pending"||t.status==="in_progress");
  const overdueTasks = pendingTasks.filter(t=>t.due_at&&new Date(t.due_at)<Date.now());
  const pipelineStages = ["lead","prequalify","application","processing","underwriting","clear_to_close","closed"];
  const openDeals = deals.filter(d=>d.status==="open");
  const totalPipelineValue = openDeals.reduce((s,d)=>s+Number(d.value||0),0);

  const dropOnStage = async stage => {
    if (!dragDeal) return;
    const prevStage = dragDeal.stage;
    await sb("crm_deals","PATCH",{stage,updated_at:new Date().toISOString()},`?id=eq.${dragDeal.id}`);
    setDeals(p=>p.map(d=>d.id===dragDeal.id?{...d,stage}:d));
    sendTelegram(`💼 <b>Deal Stage Changed</b>\n"${dragDeal.title||"Untitled"}" moved from <b>${STAGE_CFG[prevStage]?.l||prevStage}</b> → <b>${STAGE_CFG[stage]?.l||stage}</b>\nValue: $${Number(dragDeal.value||0).toLocaleString()}`);
    auditLog(user.id,"stage_change","deal",dragDeal.id,{from:prevStage,to:stage});
    runAutomations("deal_stage_change",{stage,prev_stage:prevStage,deal_id:dragDeal.id,contact_id:dragDeal.contact_id,title:dragDeal.title,value:dragDeal.value},user.id);
    setDragDeal(null); showToast(`✓ Moved to ${STAGE_CFG[stage]?.l||stage}`);
  };

  const runEmailAI = async mode => {
    if(!selEmail) return;
    const cacheKey = `${selEmail.id}_${mode}`;
    if (aiCache.current[cacheKey]) { setEmailAiMode(mode); setEmailAiResult(aiCache.current[cacheKey]); return; }
    setEmailAiMode(mode); setEmailAiLoading(true); setEmailAiResult("");
    const from=selEmail.from||selEmail.email_from||""; const subject=selEmail.subject||""; const body=selEmail.body||"";
    const sys = { summary:"Concise 3-5 sentence summary. Include intent, key data, action items.", analyze:"Analyze:\n1. **Tone**\n2. **Priority 1-5**\n3. **Action Required**\n4. **Key Entities**\n5. **Risk Flags**", reply:"Draft professional reply. Address all points. Return body only." }[mode];
    const r = await claude(sys, `From:${from}\nSubject:${subject}\n\n${body}`);
    aiCache.current[cacheKey]=r; setEmailAiResult(r); setEmailAiLoading(false);
  };

  const extractAndSave = async () => {
    if(!selEmail||!businesses.length) return;
    const alreadySaved = intelligence.some(i=>i.email_subject===(selEmail.subject||"")&&i.raw_body===(selEmail.body||""));
    if (alreadySaved) { showToast("⚠ Already extracted"); return; }
    setExtracting(true);
    const from=selEmail.from||""; const subject=selEmail.subject||""; const body=selEmail.body||"";
    const bizList=businesses.map(b=>`${b.name} (keywords:${b.email_keywords?.join(",")??""})`).join("\n");
    const sys=`Business intelligence extractor. Respond STRICT JSON only:\n{"business_name":"exact match or null","category":"Rate Change|New Product|Policy Update|Compliance|General Info|Billing|Other","importance":1-5,"summary":"2-3 sentences","action_items":["..."],"key_data":{"rates":[{"product":"","rate":""}],"dates":[],"amounts":[],"requirements":[]}}`;
    const raw=await claude(sys,`BUSINESSES:\n${bizList}\n\nEMAIL:\nFrom:${from}\nSubject:${subject}\n\n${body}`,700);
    try {
      const parsed=JSON.parse(raw.replace(/```json|```/g,"").trim());
      const biz=businesses.find(b=>b.name===parsed.business_name);
      const res=await sb("email_intelligence","POST",{ business_id:biz?.id||null, email_from:from, email_subject:subject, email_date:selEmail.received_at||selEmail.date, summary:parsed.summary, key_data:parsed.key_data||{}, action_items:parsed.action_items||[], category:parsed.category, importance:parsed.importance, raw_body:body });
      if(res){ setIntel(p=>[res[0],...p]); showToast(`✓ Intel saved → ${biz?.name||"Unclassified"}`); }
    } catch { showToast("⚠ Parse error"); }
    setExtracting(false);
  };

  const completeTask = async id => {
    await sb("crm_tasks","PATCH",{status:"done",completed_at:new Date().toISOString()},`?id=eq.${id}`);
    setTasks(p=>p.map(t=>t.id===id?{...t,status:"done"}:t)); showToast("✓ Task completed");
  };

  const deleteDoc = async id => { await sb("documents","DELETE",null,`?id=eq.${id}`); setDocs(p=>p.filter(d=>d.id!==id)); showToast("✓ Removed"); };
  const deleteContact = async id => { await sb("contacts","DELETE",null,`?id=eq.${id}`); setCon(p=>p.filter(c=>c.id!==id)); if(selContact?.id===id) setSelContact(null); showToast("✓ Deleted"); };
  const setDealStatus = async (id,status) => {
    const patch={status,updated_at:new Date().toISOString()}; if(status==="won"||status==="lost") patch.closed_at=new Date().toISOString();
    await sb("crm_deals","PATCH",patch,`?id=eq.${id}`);
    setDeals(prev=>prev.map(d=>d.id===id?{...d,...patch}:d)); showToast(`✓ Deal marked ${status}`);
  };

  const filteredContacts = useMemo(() => contacts.filter(c=>
    (c.full_name||"").toLowerCase().includes(contactSearch.toLowerCase())||
    (c.email||"").toLowerCase().includes(contactSearch.toLowerCase())||
    (c.company||"").toLowerCase().includes(contactSearch.toLowerCase())
  ), [contacts, contactSearch]);

  const filteredDocs = documents.filter(d=>{
    const matchSearch=!docSearch||d.name.toLowerCase().includes(docSearch.toLowerCase())||(d.description||"").toLowerCase().includes(docSearch.toLowerCase());
    const matchBiz=!docFilterBiz||d.business_id===docFilterBiz;
    const matchCat=!docFilterCat||d.category===docFilterCat;
    return matchSearch&&matchBiz&&matchCat;
  });

  const contactActivities = useMemo(() => selContact?activities.filter(a=>a.contact_id===selContact.id):[], [selContact, activities]);
  const contactDeals = useMemo(() => selContact?deals.filter(d=>d.contact_id===selContact.id):[], [selContact, deals]);
  const contactTasks = useMemo(() => selContact?tasks.filter(t=>t.contact_id===selContact.id):[], [selContact, tasks]);

  const filteredEmails = useMemo(()=>{
    return emails.filter(e=>{
      const matchFolder = emailFolder==="all"?true:emailFolder==="flagged"?e.is_flagged:emailFolder==="unread"?!e.is_read:e.folder===emailFolder;
      const matchSearch = !emailSearch||(e.subject||"").toLowerCase().includes(emailSearch.toLowerCase())||(e.from_name||"").toLowerCase().includes(emailSearch.toLowerCase());
      return matchFolder && matchSearch;
    });
  }, [emails, emailFolder, emailSearch]);

  const unreadNotifs = callNotifs.filter(n=>!n.is_read).length;
  const todayStr = new Date().toLocaleDateString('en-CA');
  const todayAppts = appointments.filter(a=>a.status==="scheduled"&&(a.start_at||"").slice(0,10)===todayStr).length;
  const overdueInvs = invoices.filter(i=>i.status==="sent"&&i.due_at&&new Date(i.due_at)<new Date()).length;
  const expiringItems = complianceItems.filter(c=>{if(c.status!=="active"||!c.expiry_date)return false;const d=(new Date(c.expiry_date)-new Date())/(86400000);return d<=30;}).length;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarSection, setSidebarSection] = useState(null);
  const navGroups = [
    { id:"core", label:"CORE", items:[
      {id:"dashboard", icon:"📊", label:"Dashboard", badge:0, admin:true},
      {id:"inbox",     icon:"✉️", label:"Inbox",     badge:emails.filter(e=>!e.is_read).length, admin:true},
      {id:"callcenter",icon:"📞", label:"Calls",     badge:unreadNotifs, admin:false},
      {id:"messages",  icon:"💬", label:"Messages",  badge:unreadMsgs, admin:false},
    ]},
    { id:"sales", label:"SALES & CRM", items:[
      {id:"pricing",   icon:"🏦", label:"Mortgage POS", badge:0, admin:true},
      {id:"leads",     icon:"🎯", label:"Leads",     badge:0, admin:true},
      {id:"crm",       icon:"👥", label:"Contacts",  badge:overdueTasks.length, admin:true},
      {id:"appointments",icon:"📅", label:"Booking", badge:todayAppts, admin:true},
    ]},
    { id:"marketing", label:"MARKETING", items:[
      {id:"marketing", icon:"📣", label:"Campaigns",  badge:0, admin:true},
      {id:"social",    icon:"📱", label:"Social",     badge:0, admin:true},
      {id:"market",    icon:"📡", label:"Market Intel",badge:0, admin:true},
    ]},
    { id:"ops", label:"OPERATIONS", items:[
      {id:"docs",      icon:"📁", label:"Documents",  badge:0, admin:true},
      {id:"invoices",  icon:"💰", label:"Invoicing",  badge:overdueInvs, admin:true},
      {id:"esign",     icon:"✍️", label:"E-Sign",     badge:0, admin:true},
      {id:"compliance",icon:"📋", label:"Compliance", badge:expiringItems, admin:true},
    ]},
    { id:"ai", label:"ANALYTICS & AI", items:[
      {id:"analytics", icon:"📈", label:"Analytics",    badge:0, admin:true},
      {id:"intel",     icon:"🧠", label:"Intelligence", badge:0, admin:true},
      {id:"automations",icon:"⚡", label:"Automations",  badge:0, admin:true},
    ]},
    { id:"admin", label:"ADMIN", items:[
      {id:"biz",       icon:"🏢", label:"Business",   badge:0, admin:true},
      {id:"vendors",   icon:"🔨", label:"Vendors",    badge:0, admin:true},
      {id:"toolbox",   icon:"🧰", label:"Tools",      badge:0, admin:true},
      {id:"settings",  icon:"⚙️", label:"Settings",   badge:0, admin:true},
    ]},
    { id:"apps", label:"APPS", items:[
      {id:"_wolfsurety", icon:"🐺", label:"Wolf Insurance", badge:0, admin:true, external:"https://app.wolfsurety.com"},
      {id:"_dosmortgage", icon:"🏠", label:"DOS Mortgage", badge:0, admin:true, external:"https://dosmortgage.pages.dev"},
    ]},
  ];
  const navAll = navGroups.flatMap(g=>g.items);
  const filteredGroups = isAdmin ? navGroups : navGroups.map(g=>({...g,items:g.items.filter(n=>!n.admin)})).filter(g=>g.items.length>0);
  const navMain = isAdmin ? navAll : navAll.filter(n=>!n.admin);

  const CRM_SUBS = [{id:"pipeline",l:"Kanban"},{id:"contacts",l:"Contacts"},{id:"deals",l:"Deals"},{id:"tasks",l:"Tasks"},{id:"timeline",l:"Timeline"},{id:"referrals",l:"Referrals"},{id:"reviews",l:"Reviews"}];
  const MSG_SUBS = [{id:"internal",l:"Internal"},{id:"unified",l:"Unified Inbox"},{id:"wamanager",l:"WA Manager"},{id:"wapersonal",l:"WA Personal"},{id:"sms",l:"📱 SMS"}];
  const handleNav = (v,s) => { setView(v); if(s) setSub(s); else if(v==="crm") setSub("pipeline"); else if(v==="messages") setSub("internal"); };

  return (
    <div style={{ fontFamily:"'DM Mono','Courier New',monospace",background:"#090910",color:"#e0dcd0",height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=Bebas+Neue&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px;height:3px}::-webkit-scrollbar-track{background:#09090f}::-webkit-scrollbar-thumb{background:#1e1e2e;border-radius:2px}
        .rh:hover{background:rgba(255,255,255,0.03)!important}
        .rh.sel{background:rgba(212,175,55,0.08)!important;border-left:2px solid #d4af37!important}
        .card:hover{border-color:#2a2a4a!important}
        .kanban-col{min-height:120px;transition:background .15s}
        .kanban-col.drag-over{background:rgba(212,175,55,0.05)!important;border-color:#d4af3744!important}
        textarea,input,select{outline:none}
        .pulse{animation:pu 1.5s infinite}@keyframes pu{0%,100%{opacity:1}50%{opacity:.3}}
        .fi{animation:fi .2s ease}@keyframes fi{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
        .sh{background:linear-gradient(90deg,#10101c 25%,#1a1a2c 50%,#10101c 75%);background-size:200% 100%;animation:sh 1.4s infinite}@keyframes sh{0%{background-position:200% 0}100%{background-position:-200% 0}}
        button{transition:opacity .15s}button:disabled{cursor:not-allowed!important;opacity:.5!important}
        .tag{display:inline-block;padding:1px 6px;border-radius:2px;font-size:9px;letter-spacing:.05em;text-transform:uppercase;margin-right:3px;margin-bottom:2px}
        .erow:hover{background:rgba(212,175,55,0.04)!important}.erow.sel{background:rgba(212,175,55,0.08)!important;border-left:2px solid #d4af37!important}
        @keyframes dot{0%,80%,100%{transform:scale(0.6);opacity:.3}40%{transform:scale(1);opacity:1}}
      `}</style>

      {/* Modals */}
      {showContact&&<ContactModal contact={editContact} businesses={businesses} onClose={()=>{setShowContact(false);setEditContact(null);}} onSave={()=>{setShowContact(false);setEditContact(null);refresh();showToast("✓ Contact saved");}} />}
      {showDeal&&<DealModal deal={editDeal} contacts={contacts} businesses={businesses} pipelines={pipelines} onClose={()=>{setShowDeal(false);setEditDeal(null);}} onSave={()=>{setShowDeal(false);setEditDeal(null);refresh();showToast("✓ Deal saved");}} />}
      {showTask&&<TaskModal task={editTask} contacts={contacts} deals={deals} onClose={()=>{setShowTask(false);setEditTask(null);}} onSave={()=>{setShowTask(false);setEditTask(null);refresh();showToast("✓ Task saved");}} />}
      {showActivity&&<ActivityModal context={actContext} contacts={contacts} deals={deals} onClose={()=>{setShowActivity(false);setActContext({});}} onSave={()=>{setShowActivity(false);setActContext({});refresh();showToast("✓ Activity logged");}} />}
      {showDocUpload&&<DocUploadModal businesses={businesses} folders={folders} onClose={()=>setShowDocUpload(false)} onSave={()=>{setShowDocUpload(false);refresh();showToast("✓ Document uploaded");}} />}
      {showCompose&&<ComposeModal contacts={contacts} onClose={r=>{setShowCompose(false);if(r?.sent){refresh();showToast(`✓ Sent to ${r.to}`);}}} />}
      {showSearch&&<GlobalSearch contacts={contacts} deals={deals} documents={documents} intelligence={intelligence} emails={emails} onClose={()=>setShowSearch(false)} onNav={handleNav} />}
      {showPDFImport&&<PDFLeadImporter businesses={businesses} onClose={()=>setShowPDFImport(false)} onImport={n=>{refresh();showToast(`✅ ${n} leads imported as nurture contacts`);}} />}
      {showNurtureSeq&&<NurtureSequenceModal contacts={contacts} businesses={businesses} showToast={showToast} onClose={()=>setShowNurtureSeq(false)} onSave={(nc,nt)=>{refresh();showToast(`🌱 Sequence launched — ${nt} tasks created for ${nc} contacts`);}} />}

      {/* AI Assistant */}
      {showAI&&<AIAssistant contacts={contacts} deals={deals} tasks={tasks} activities={activities} businesses={businesses} intelligence={intelligence} campaigns={campaigns} onClose={()=>setShowAI(false)} />}
      <button onClick={()=>setShowAI(p=>!p)} style={{ position:"fixed",bottom:20,right:20,width:46,height:46,borderRadius:"50%",background:"rgba(139,92,246,.15)",border:"1px solid rgba(139,92,246,.5)",color:"#a78bfa",cursor:"pointer",fontSize:20,zIndex:200,boxShadow:"0 0 30px rgba(139,92,246,.3)" }} title="Vault AI Advisor">⬡</button>

      {/* Hey Ken AI Command Center */}
      <KenAIPanel user={user} />

      {/* TOP BAR — slim */}
      <div style={{ display:"flex",alignItems:"center",padding:"0 12px",height:40,borderBottom:"1px solid #111120",background:"#07070e",flexShrink:0,gap:8 }}>
        <button onClick={()=>setSidebarOpen(p=>!p)} style={{background:"none",border:"none",color:"#555",cursor:"pointer",fontSize:16,padding:"2px 4px",fontFamily:"inherit"}} title="Toggle sidebar">{sidebarOpen?"◁":"▷"}</button>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}><img src="/favicon.svg" alt="" style={{width:20,height:20}} /><span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".25em",color:"#d4af37"}}>VAULT</span></div>
        <RateTicker />
        <div style={{flex:1}} />
        {/* CRM sub-nav inline */}
        {view==="crm"&&CRM_SUBS.map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{background:sub===s.id?"rgba(212,175,55,.08)":"none",border:`1px solid ${sub===s.id?"rgba(212,175,55,.25)":"transparent"}`,color:sub===s.id?"#d4af37":"#444",fontFamily:"inherit",fontSize:9,padding:"3px 10px",borderRadius:2,cursor:"pointer",letterSpacing:".06em"}}>{s.l}</button>
        ))}
        {/* Messages sub-nav inline */}
        {view==="messages"&&MSG_SUBS.map(s=>(
          <button key={s.id} onClick={()=>setSub(s.id)} style={{background:sub===s.id?"rgba(212,175,55,.08)":"none",border:`1px solid ${sub===s.id?"rgba(212,175,55,.25)":"transparent"}`,color:sub===s.id?"#d4af37":"#444",fontFamily:"inherit",fontSize:9,padding:"3px 10px",borderRadius:2,cursor:"pointer",letterSpacing:".06em"}}>{s.l}</button>
        ))}
        <div style={{flex:1}} />
        <button onClick={()=>setShowSearch(true)} style={{ background:"rgba(255,255,255,.03)",border:"1px solid #1a1a28",color:"#444",cursor:"pointer",borderRadius:4,padding:"4px 12px",fontSize:9,fontFamily:"inherit",display:"flex",alignItems:"center",gap:6 }}>⌕ SEARCH <span style={{color:"#2a2a3a",fontSize:8}}>⌘K</span></button>
        {toast&&<div className="fi" style={{color:"#10b981",fontSize:9,background:"rgba(16,185,129,.08)",padding:"3px 10px",borderRadius:3,border:"1px solid rgba(16,185,129,.2)",whiteSpace:"nowrap"}}>{toast}</div>}
        {spend.calls>0&&<div title={`${spend.calls} AI calls`} style={{fontSize:8,color:Number(spend.estUSD)>.10?"#f59e0b":"#333",background:"rgba(0,0,0,.4)",padding:"3px 8px",borderRadius:3,border:"1px solid #1a1a28",cursor:"default",letterSpacing:".04em",whiteSpace:"nowrap"}}>~${spend.estUSD}</div>}
        {overdueTasks.length>0&&<div style={{color:"#ef4444",fontSize:9,background:"rgba(239,68,68,.08)",padding:"3px 8px",borderRadius:3,border:"1px solid rgba(239,68,68,.2)",whiteSpace:"nowrap"}}>⚠ {overdueTasks.length}</div>}
        <div style={{position:"relative"}}>
          <button onClick={()=>setShowNotifPanel(p=>!p)} style={{background:unreadNotifs?"rgba(239,68,68,.1)":"rgba(255,255,255,.03)",border:`1px solid ${unreadNotifs?"rgba(239,68,68,.3)":"#1a1a28"}`,color:unreadNotifs?"#ef4444":"#555",cursor:"pointer",borderRadius:3,padding:"4px 8px",fontSize:12,fontFamily:"inherit",position:"relative"}}>
            🔔{unreadNotifs>0&&<span style={{position:"absolute",top:-4,right:-4,width:14,height:14,background:"#ef4444",borderRadius:"50%",fontSize:7,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff"}}>{unreadNotifs}</span>}
          </button>
          {showNotifPanel&&(
            <div style={{position:"absolute",top:"100%",right:0,marginTop:4,width:340,maxHeight:400,overflow:"auto",background:"#0b0b16",border:"1px solid #1e1e28",borderRadius:6,boxShadow:"0 8px 30px rgba(0,0,0,.6)",zIndex:200,padding:8}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 6px",marginBottom:4}}>
                <span style={{fontSize:9,color:"#d4af37",letterSpacing:".1em"}}>NOTIFICATIONS</span>
                {unreadNotifs>0&&<button onClick={async()=>{
                  for(const n of callNotifs.filter(x=>!x.is_read)) await sb("vault_call_notifications","PATCH",{is_read:true},`?id=eq.${n.id}`);
                  setCallNotifs(p=>p.map(n=>({...n,is_read:true})));
                }} style={{fontSize:7,background:"none",border:"1px solid #1e1e28",color:"#555",cursor:"pointer",fontFamily:"inherit",padding:"2px 6px",borderRadius:2}}>MARK ALL READ</button>}
              </div>
              {callNotifs.length===0&&<div style={{textAlign:"center",padding:20,color:"#2a2a3a",fontSize:9}}>No notifications</div>}
              {callNotifs.slice(0,20).map(n=>(
                <div key={n.id} onClick={()=>{
                  if(n.call_id){const c=calls.find(x=>x.id===n.call_id);if(c){setSelCall(c);setView("callcenter");}}
                  if(!n.is_read){sb("vault_call_notifications","PATCH",{is_read:true},`?id=eq.${n.id}`);setCallNotifs(p=>p.map(x=>x.id===n.id?{...x,is_read:true}:x));}
                  setShowNotifPanel(false);
                }} style={{padding:"6px 8px",borderRadius:3,cursor:"pointer",background:n.is_read?"none":"rgba(212,175,55,.04)",borderBottom:"1px solid #0e0e18",display:"flex",gap:8,alignItems:"flex-start"}}>
                  <span style={{fontSize:12,flexShrink:0,marginTop:1}}>{n.type==="referral"?"🔁":n.type==="callback_due"?"⏰":n.type==="recording_ready"?"🎙":"📞"}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:9,color:n.is_read?"#555":"#e0dcd0",lineHeight:1.4}}>{n.message}</div>
                    <div style={{fontSize:7,color:"#333",marginTop:2}}>{new Date(n.created_at).toLocaleString()}</div>
                  </div>
                  {!n.is_read&&<span style={{width:6,height:6,borderRadius:"50%",background:"#d4af37",flexShrink:0,marginTop:4}} />}
                </div>
              ))}
            </div>
          )}
        </div>
        <button onClick={()=>setShowCompose(true)} style={{background:"rgba(212,175,55,.1)",border:"1px solid rgba(212,175,55,.3)",color:"#d4af37",cursor:"pointer",borderRadius:3,padding:"4px 10px",fontSize:10,fontFamily:"inherit"}}>✉</button>
        {user&&<span style={{fontSize:8,color:"#333",whiteSpace:"nowrap"}}>{teamProfile?.display_name||user.email}</span>}
        <button onClick={onSignOut} style={{background:"rgba(239,68,68,.08)",border:"1px solid rgba(239,68,68,.2)",color:"#ef4444",cursor:"pointer",borderRadius:3,padding:"4px 8px",fontSize:8,fontFamily:"inherit",letterSpacing:".06em",whiteSpace:"nowrap"}}>LOGOUT</button>
      </div>

      {loading&&(
        <div style={{position:"absolute",top:40,left:0,right:0,height:2,background:"linear-gradient(90deg,transparent,#d4af37,transparent)",animation:"sh 1.4s infinite",backgroundSize:"200% 100%",zIndex:100}} />
      )}

      {/* SIDEBAR + MAIN CONTENT */}
      <div style={{flex:1,overflow:"hidden",display:"flex"}}>

        {/* SIDEBAR — Clean, bright, always expanded */}
        <div style={{width:sidebarOpen?220:0,minWidth:sidebarOpen?220:0,background:"#0c0c14",borderRight:sidebarOpen?"1px solid #1a1a2a":"none",overflow:"hidden",transition:"width .2s ease, min-width .2s ease",display:"flex",flexDirection:"column",flexShrink:0}}>
          <div style={{flex:1,overflowY:"auto",overflowX:"hidden",padding:sidebarOpen?"6px 0":"0"}}>
            {filteredGroups.map(g=>(
              <div key={g.id} style={{marginBottom:2}}>
                {g.label&&<div style={{padding:"10px 16px 4px",fontSize:9,color:"#d4af37",letterSpacing:".15em",fontWeight:600,opacity:0.7}}>{g.label}</div>}
                {g.items.map(n=>(
                  <button key={n.id} onClick={()=>{if(n.external){window.open(n.external,"_blank");}else{handleNav(n.id);}}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"9px 16px",background:view===n.id?"rgba(212,175,55,.12)":"none",borderLeft:view===n.id?"3px solid #d4af37":"3px solid transparent",borderTop:"none",borderRight:"none",borderBottom:"none",color:view===n.id?"#f0e6c0":"#999",cursor:"pointer",fontFamily:"inherit",fontSize:11,textAlign:"left",transition:"all .15s",letterSpacing:".03em"}}>
                    <span style={{fontSize:15,width:20,textAlign:"center",flexShrink:0}}>{n.icon}</span>
                    <span style={{flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontWeight:view===n.id?600:400}}>{n.label}</span>
                    {n.badge>0&&<span style={{minWidth:18,height:18,background:"#ef4444",borderRadius:9,fontSize:9,display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",padding:"0 5px",flexShrink:0,fontWeight:700}}>{n.badge}</span>}
                    {n.external&&<span style={{fontSize:9,color:"#555"}}>↗</span>}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {/* Sidebar footer */}
          {sidebarOpen&&<div style={{borderTop:"1px solid #1a1a2a",padding:"10px 16px",display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#d4af37,#b8962e)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,color:"#000",fontWeight:700,flexShrink:0}}>K</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:10,color:"#ccc",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",fontWeight:500}}>{teamProfile?.display_name||"Ken Wolf"}</div>
              <div style={{fontSize:8,color:"#d4af37",letterSpacing:".1em"}}>ADMIN</div>
            </div>
          </div>}
        </div>

        {/* MAIN CONTENT */}
        <div style={{flex:1,overflow:"hidden",display:"flex"}}>

        {/* ── DASHBOARD ── */}
        {view==="dashboard"&&<Dashboard contacts={contacts} deals={deals} tasks={tasks} activities={activities} businesses={businesses} intelligence={intelligence} documents={documents} campaigns={campaigns} onNav={handleNav} onNewDeal={()=>{setEditDeal(null);setShowDeal(true);}} onNewTask={()=>{setEditTask(null);setShowTask(true);}} />}

        {/* ── MARKETING ── */}
        {view==="marketing"&&<MarketingView contacts={contacts} campaigns={campaigns} setCampaigns={setCampaigns} showToast={showToast} />}

        {/* ── LEADS ── */}
        {view==="leads"&&<LeadsView
          contacts={contacts} deals={deals} activities={activities} businesses={businesses}
          showToast={showToast}
          onNewContact={()=>{setEditContact(null);setShowContact(true);}}
          onNav={handleNav}
          onOpenPDFImport={()=>setShowPDFImport(true)}
          onOpenNurtureSeq={()=>setShowNurtureSeq(true)}
          runCrossSell={runCrossSell}
          crossSellContact={crossSellContact}
          setCrossSellContact={setCrossSellContact}
          crossSellResults={crossSellResults}
          crossSellLoading={crossSellLoading}
          bulkScanResults={bulkScanResults}
          bulkScanLoading={bulkScanLoading}
          bulkScanProgress={bulkScanProgress}
          runBulkCrossScan={runBulkCrossScan}
        />}

        {/* ── ANALYTICS ── */}
        {view==="analytics"&&<AnalyticsView contacts={contacts} deals={deals} activities={activities} campaigns={campaigns} intelligence={intelligence} showToast={showToast} />}

        {/* ── MARKET INTEL ── */}
        {view==="market"&&<MarketIntelView showToast={showToast} />}

        {/* ── INBOX ── */}
        {view==="inbox"&&(<>
          <div style={{width:290,borderRight:"1px solid #161626",display:"flex",flexDirection:"column",background:"#0b0b13",flexShrink:0}}>
            <div style={{padding:"8px 10px",borderBottom:"1px solid #121220",display:"flex",gap:5}}>
              <input value={emailSearch} onChange={e=>setEmailSearch(e.target.value)} placeholder="⌕ search..." style={{flex:1,background:"#0e0e1a",border:"1px solid #1a1a28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 10px",borderRadius:3}}/>
              <button onClick={()=>setShowCompose(true)} style={{background:"rgba(212,175,55,.1)",border:"1px solid rgba(212,175,55,.2)",color:"#d4af37",cursor:"pointer",borderRadius:3,padding:"0 9px",fontSize:11}}>✉</button>
            </div>
            {/* Folder tabs */}
            <div style={{display:"flex",padding:"4px 8px",gap:4,borderBottom:"1px solid #0e0e18",flexShrink:0}}>
              {[{id:"all",l:"All"},{id:"unread",l:`Unread (${emails.filter(e=>!e.is_read).length})`},{id:"flagged",l:`⚑ Flagged (${emails.filter(e=>e.is_flagged).length})`}].map(f=>(
                <button key={f.id} onClick={()=>setEmailFolder(f.id)} style={{background:emailFolder===f.id?"rgba(212,175,55,.08)":"none",border:`1px solid ${emailFolder===f.id?"rgba(212,175,55,.2)":"transparent"}`,color:emailFolder===f.id?"#d4af37":"#444",fontFamily:"inherit",fontSize:8,padding:"2px 7px",borderRadius:2,cursor:"pointer"}}>{f.l}</button>
              ))}
            </div>
            <div style={{overflowY:"auto",flex:1}}>
              {filteredEmails.map(em=>{
                const isRead=em.is_read??em.read??false;
                const fromName=em.from_name||em.fromName||em.from||"";
                const date=em.received_at||em.date||"";
                return (
                  <div key={em.id} onClick={()=>{setSelEmail(em);setEmailAiMode(null);setEmailAiResult("");if(!isRead)markRead(em.id);}} className={`erow${selEmail?.id===em.id?" sel":""}`} style={{padding:"9px 11px",borderBottom:"1px solid #0e0e18",cursor:"pointer",borderLeft:"2px solid transparent",position:"relative"}}>
                    {!isRead&&<div style={{position:"absolute",left:3,top:"50%",transform:"translateY(-50%)",width:4,height:4,background:"#d4af37",borderRadius:"50%"}}/>}
                    {em.is_flagged&&<div style={{position:"absolute",right:8,top:10,fontSize:8,color:"#ef4444"}}>⚑</div>}
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:2}}>
                      <span style={{fontSize:10,color:isRead?"#555":"#e0dcd0",fontWeight:isRead?"300":"500",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{fromName}</span>
                      <span style={{fontSize:7,color:"#2a2a3a"}}>{ago(date)}</span>
                    </div>
                    <div style={{fontSize:9,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:3}}>{em.subject}</div>
                    <div>{(em.tags||[]).map(t=><span key={t} className="tag" style={{background:"rgba(212,175,55,0.06)",color:"#666",border:"1px solid rgba(212,175,55,0.12)"}}>{t}</span>)}</div>
                  </div>
                );
              })}
              {filteredEmails.length===0&&<div style={{padding:24,textAlign:"center",color:"#1e1e2e",fontSize:10}}>No emails</div>}
            </div>
          </div>
          {/* Email detail */}
          <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
            {!selEmail?(
              <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
                <div style={{fontSize:40,opacity:.06}}>✉</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".2em",fontSize:13,color:"#1a1a2a"}}>SELECT A MESSAGE</div>
              </div>
            ):(
              <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
                <div style={{padding:"12px 18px",borderBottom:"1px solid #161626",background:"#0b0b13",flexShrink:0}}>
                  <div style={{fontSize:13,color:"#e0dcd0",marginBottom:4}}>{selEmail.subject}</div>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
                    <span style={{fontSize:10,color:"#d4af37"}}>{selEmail.from_name||selEmail.fromName||selEmail.from}<span style={{fontSize:9,color:"#333",marginLeft:8}}>&lt;{selEmail.from||selEmail.email_from}&gt;</span></span>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <span style={{fontSize:8,color:"#2a2a3a"}}>{new Date(selEmail.received_at||selEmail.date||"").toLocaleString()}</span>
                      <button onClick={()=>toggleFlag(selEmail.id,selEmail.is_flagged)} style={{background:"none",border:"none",color:selEmail.is_flagged?"#ef4444":"#333",cursor:"pointer",fontSize:13}} title="Flag">{selEmail.is_flagged?"⚑":"⚐"}</button>
                    </div>
                  </div>
                </div>
                <div style={{padding:"6px 18px",borderBottom:"1px solid #161626",background:"#08080f",display:"flex",gap:5,flexWrap:"wrap",alignItems:"center",flexShrink:0}}>
                  <span style={{fontSize:8,color:"#222",marginRight:2}}>AI:</span>
                  {[{id:"summary",l:"⚡ Summary"},{id:"analyze",l:"🔬 Analyze"},{id:"reply",l:"✍ Reply"}].map(b=>{
                    const cached=aiCache.current[`${selEmail.id}_${b.id}`];
                    return <button key={b.id} onClick={()=>runEmailAI(b.id)} style={{background:cached?"rgba(212,175,55,.05)":"none",border:`1px solid ${emailAiMode===b.id?"#d4af3755":cached?"#d4af3730":"#1a1a28"}`,color:emailAiMode===b.id?"#d4af37":cached?"#d4af3799":"#555",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 9px",borderRadius:3}}>{b.l}{cached?" ✓":""}</button>;
                  })}
                  {intelligence.some(i=>i.email_subject===selEmail.subject&&i.raw_body===selEmail.body)
                    ?<span style={{fontSize:8,color:"#8b5cf6",padding:"4px 10px",border:"1px solid rgba(139,92,246,.2)",borderRadius:3}}>🧠 SAVED</span>
                    :<button onClick={extractAndSave} disabled={extracting} style={{background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 9px",borderRadius:3}}>{extracting?<span className="pulse">extracting...</span>:"🧠 EXTRACT"}</button>}
                  <button onClick={()=>setShowCompose(true)} style={{background:"rgba(212,175,55,.07)",border:"1px solid rgba(212,175,55,.18)",color:"#d4af37",cursor:"pointer",fontFamily:"inherit",fontSize:9,padding:"4px 9px",borderRadius:3}}>✉ REPLY</button>
                  {emailAiLoading&&<span className="pulse" style={{fontSize:8,color:"#d4af37"}}>thinking...</span>}
                </div>
                <div style={{flex:1,overflowY:"auto",padding:"14px 18px",display:"flex",flexDirection:"column",gap:10}}>
                  <div style={{background:"#0d0d18",border:"1px solid #161626",borderRadius:4,padding:"13px 14px"}}>
                    <pre style={{fontSize:11,color:"#c0bdb0",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{selEmail.body}</pre>
                  </div>
                  {(selEmail.attachments||[]).length>0&&(
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {selEmail.attachments.map((a,i)=>(
                        <div key={i} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"6px 10px",display:"flex",gap:6,alignItems:"center"}}>
                          <span style={{fontSize:11}}>📎</span>
                          <div><div style={{fontSize:9,color:"#888"}}>{a.name}</div><div style={{fontSize:8,color:"#444"}}>{a.size}</div></div>
                        </div>
                      ))}
                    </div>
                  )}
                  {emailAiResult&&(
                    <div style={{background:"rgba(212,175,55,.04)",border:"1px solid rgba(212,175,55,.15)",borderRadius:4,padding:"12px 14px"}} className="fi">
                      <div style={{fontSize:8,color:"#d4af37",letterSpacing:".1em",marginBottom:8}}>{emailAiMode?.toUpperCase()}</div>
                      <pre style={{fontSize:11,color:"#c4c0d8",lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"inherit"}}>{emailAiResult}</pre>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>)}

        {/* ── CRM ── */}
        {view==="crm"&&(
          <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>

            {/* Pipeline/Kanban */}
            {sub==="pipeline"&&(
              <div style={{flex:1,overflow:"auto",padding:14,display:"flex",gap:10}}>
                {pipelineStages.map(stage=>{
                  const cfg=STAGE_CFG[stage]||{c:"#555",l:stage};
                  const stageDeals=openDeals.filter(d=>d.stage===stage);
                  const stageValue=stageDeals.reduce((s,d)=>s+Number(d.value||0),0);
                  return (
                    <div key={stage} className="kanban-col" onDragOver={e=>{e.preventDefault();e.currentTarget.classList.add("drag-over");}} onDragLeave={e=>e.currentTarget.classList.remove("drag-over")} onDrop={e=>{e.currentTarget.classList.remove("drag-over");dropOnStage(stage);}} style={{minWidth:175,width:175,background:"#0b0b14",border:`1px solid ${cfg.c}22`,borderRadius:6,display:"flex",flexDirection:"column",maxHeight:"100%",flexShrink:0}}>
                      <div style={{padding:"10px 11px",borderBottom:`1px solid ${cfg.c}18`,flexShrink:0}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:12,letterSpacing:".15em",color:cfg.c}}>{cfg.l}</span>
                          <span style={{fontSize:9,color:cfg.c,background:`${cfg.c}15`,padding:"1px 6px",borderRadius:2}}>{stageDeals.length}</span>
                        </div>
                        {stageValue>0&&<div style={{fontSize:8,color:"#333",marginTop:2}}>{usd(stageValue)}</div>}
                      </div>
                      <div style={{overflowY:"auto",flex:1,padding:"6px 7px",display:"flex",flexDirection:"column",gap:5}}>
                        {stageDeals.map(d=>(
                          <div key={d.id} draggable onDragStart={()=>setDragDeal(d)} style={{background:"#0f0f1c",border:`1px solid ${cfg.c}18`,borderRadius:4,padding:"8px 10px",cursor:"grab"}} className="card">
                            <div style={{fontSize:10,color:"#d4d0c8",marginBottom:4,lineHeight:1.4}}>{d.title}</div>
                            {d.value&&<div style={{fontSize:11,color:cfg.c,fontWeight:"500",marginBottom:3}}>{usd(d.value)}</div>}
                            {(()=>{const stageProb={new_lead:5,contacted:10,qualified:20,proposal:40,negotiation:60,underwriting:70,processing:80,approved:90,closing:95,closed_won:100};const prob=stageProb[stage]||15;const probColor=prob>=70?"#10b981":prob>=40?"#f59e0b":"#ef4444";return(<div style={{display:"flex",alignItems:"center",gap:4,marginBottom:3}}><div style={{flex:1,height:3,background:"#1a1a28",borderRadius:2,overflow:"hidden"}}><div style={{width:`${prob}%`,height:"100%",background:probColor,borderRadius:2}}/></div><span style={{fontSize:7,color:probColor,minWidth:24}}>{prob}%</span></div>);})()}
                            {d.property_address&&d.property_lat&&d.property_lon&&(
                              <div style={{marginBottom:4}}>
                                <WalkScoreWidget address={d.property_address} lat={parseFloat(d.property_lat)} lon={parseFloat(d.property_lon)} compact={true}/>
                              </div>
                            )}
                            <div style={{display:"flex",gap:4,justifyContent:"space-between",alignItems:"center"}}>
                              {d.expected_close&&<span style={{fontSize:7,color:"#333"}}>{fmt(d.expected_close)}</span>}
                              <div style={{display:"flex",gap:3,marginLeft:"auto"}}>
                                <button onClick={()=>setDealStatus(d.id,"won")} title="Mark Won" style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",color:"#10b981",cursor:"pointer",borderRadius:2,padding:"1px 5px",fontSize:9,fontFamily:"inherit"}}>✓</button>
                                <button onClick={()=>{setEditDeal(d);setShowDeal(true);}} style={{background:"none",border:"1px solid #1a1a28",color:"#444",cursor:"pointer",borderRadius:2,padding:"1px 5px",fontSize:9,fontFamily:"inherit"}}>✏</button>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button onClick={()=>{setEditDeal({stage});setShowDeal(true);}} style={{margin:"6px 8px",background:"none",border:`1px dashed ${cfg.c}22`,color:cfg.c,cursor:"pointer",borderRadius:3,padding:"4px",fontSize:9,fontFamily:"inherit",opacity:0.5}}>+ ADD</button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Contacts */}
            {sub==="contacts"&&(
              <div style={{flex:1,overflow:"hidden",display:"flex"}}>
                <div style={{width:280,borderRight:"1px solid #161626",display:"flex",flexDirection:"column",background:"#0b0b13"}}>
                  <div style={{padding:"8px 10px",borderBottom:"1px solid #121220",display:"flex",gap:5}}>
                    <input value={contactSearch} onChange={e=>setContactSearch(e.target.value)} placeholder="⌕ search..." style={{flex:1,background:"#0e0e1a",border:"1px solid #1a1a28",color:"#e0dcd0",fontFamily:"inherit",fontSize:10,padding:"5px 10px",borderRadius:3}}/>
                    <button onClick={()=>{setEditContact(null);setShowContact(true);}} style={{background:"rgba(212,175,55,.1)",border:"1px solid rgba(212,175,55,.2)",color:"#d4af37",cursor:"pointer",borderRadius:3,padding:"0 9px",fontSize:12}}>+</button>
                  </div>
                  <div style={{overflowY:"auto",flex:1}}>
                    {filteredContacts.map(c=>{
                      const statusCfg=LEAD_STATUS_CFG[c.lead_status]||{c:"#555",l:"New"};
                      const score=scoreContact(c,deals,activities);
                      return (
                        <div key={c.id} onClick={()=>setSelContact(c)} className={`rh${selContact?.id===c.id?" sel":""}`} style={{padding:"9px 11px",borderBottom:"1px solid #0e0e18",cursor:"pointer",borderLeft:"2px solid transparent",display:"flex",gap:9,alignItems:"center"}}>
                          <Av name={c.full_name} color={statusCfg.c} size={28}/>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:10,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.full_name}</div>
                            <div style={{fontSize:8,color:"#555",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{c.company||c.email||"—"}</div>
                          </div>
                          <ScorePill score={score}/>
                        </div>
                      );
                    })}
                    {filteredContacts.length===0&&<div style={{padding:20,textAlign:"center",color:"#1e1e2e",fontSize:10}}>No contacts</div>}
                  </div>
                </div>
                <div style={{flex:1,overflow:"auto",padding:18}}>
                  {!selContact?(
                    <div style={{height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:8}}>
                      <div style={{fontSize:36,opacity:.05}}>👤</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",letterSpacing:".2em",fontSize:12,color:"#1a1a2a"}}>SELECT A CONTACT</div>
                    </div>
                  ):(()=>{
                    const score=scoreContact(selContact,deals,activities);
                    const statusCfg=LEAD_STATUS_CFG[selContact.lead_status]||{c:"#555",l:"New"};
                    return (
                      <div className="fi">
                        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:18}}>
                          <Av name={selContact.full_name} color={statusCfg.c} size={48}/>
                          <div style={{flex:1}}>
                            <div style={{fontSize:16,color:"#e0dcd0"}}>{selContact.full_name}</div>
                            <div style={{fontSize:10,color:"#888",marginTop:2}}>{selContact.title}{selContact.company?` @ ${selContact.company}`:""}</div>
                            <div style={{display:"flex",gap:6,marginTop:5,flexWrap:"wrap"}}>
                              <Bd label={statusCfg.l} color={statusCfg.c}/>
                              <ScorePill score={score}/>
                              {bizFor(selContact.business_id)&&<Bd label={bizFor(selContact.business_id).name} color="#d4af37"/>}
                            </div>
                          </div>
                          <div style={{display:"flex",gap:5}}>
                            <Btn onClick={()=>{setEditContact(selContact);setShowContact(true);}} style={{fontSize:8}}>✏ EDIT</Btn>
                            <Btn onClick={()=>{setActContext({contact_id:selContact.id});setShowActivity(true);}} variant="blue" style={{fontSize:8}}>+ LOG</Btn>
                            <Btn onClick={()=>setShowCompose(true)} variant="green" style={{fontSize:8}}>✉ EMAIL</Btn>
                            <Btn onClick={async()=>{
                              const token = selContact.portal_token || crypto.randomUUID().slice(0,12);
                              if(!selContact.portal_token) await sb("contacts","PATCH",{portal_token:token},`?id=eq.${selContact.id}`);
                              const url = `${window.location.origin}/portal/${token}`;
                              navigator.clipboard.writeText(url);
                              showToast("Portal link copied!");
                            }} style={{fontSize:8,background:"rgba(99,102,241,.08)",border:"1px solid rgba(99,102,241,.25)",color:"#6366f1"}}>🔗 PORTAL</Btn>
                            <Btn onClick={()=>deleteContact(selContact.id)} variant="red" style={{fontSize:8}}>DEL</Btn>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:14}}>
                          {[{l:"EMAIL",v:selContact.email},{l:"PHONE",v:selContact.phone},{l:"LEAD STATUS",v:statusCfg.l},{l:"LEAD SCORE",v:`${score}/100`},{l:"AGE",v:selContact.age?`${selContact.age} years${selContact.age>=65?" (Medicare ✓)":""}`:selContact.date_of_birth||"—"},{l:"DOB",v:selContact.date_of_birth||"—"}].map(f=>(
                            <div key={f.l} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"8px 12px"}}>
                              <div style={{fontSize:8,color:"#444",letterSpacing:".08em",marginBottom:3}}>{f.l}</div>
                              <div style={{fontSize:11,color:"#c0bdb0"}}>{f.v||"—"}</div>
                            </div>
                          ))}
                        </div>
                        {selContact.notes&&<div style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"10px 12px",marginBottom:12}}><div style={{fontSize:8,color:"#444",marginBottom:4}}>NOTES</div><div style={{fontSize:10,color:"#888",lineHeight:1.7}}>{selContact.notes}</div></div>}
                        {contactDeals.length>0&&<div style={{marginBottom:12}}><div style={{fontSize:8,color:"#444",letterSpacing:".1em",marginBottom:6}}>DEALS ({contactDeals.length})</div>{contactDeals.map(d=>{const cfg=STAGE_CFG[d.stage]||{c:"#555",l:d.stage};return <div key={d.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:4,padding:"8px 12px",marginBottom:5,display:"flex",justifyContent:"space-between"}}><div><div style={{fontSize:10,color:"#c0bdb0"}}>{d.title}</div><Bd label={cfg.l} color={cfg.c}/></div><div style={{fontSize:12,color:cfg.c,fontWeight:"500"}}>{usd(d.value)}</div></div>;})} </div>}
                        {contactActivities.length>0&&<div><div style={{fontSize:8,color:"#444",letterSpacing:".1em",marginBottom:6}}>ACTIVITY ({contactActivities.length})</div>{contactActivities.slice(0,8).map(a=>{const icons={call:"📞",email:"✉",meeting:"📅",note:"📝",task:"☑",sms:"💬"};return <div key={a.id} style={{display:"flex",gap:8,padding:"5px 0",borderBottom:"1px solid #0e0e18"}}><span style={{fontSize:10}}>{icons[a.type]||"•"}</span><div style={{flex:1}}><div style={{fontSize:10,color:"#888"}}>{a.subject||a.type}</div><div style={{fontSize:8,color:"#333"}}>{ago(a.created_at)}</div></div></div>;})} </div>}
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Deals list */}
            {sub==="deals"&&(
              <div style={{flex:1,overflow:"auto",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".2em",color:"#d4af37"}}>ALL DEALS</span>
                  <Btn onClick={()=>{setEditDeal(null);setShowDeal(true);}} variant="gold" style={{fontSize:9}}>+ NEW DEAL</Btn>
                </div>
                <div style={{display:"flex",flexDirection:"column",gap:6}}>
                  {deals.map(d=>{
                    const cfg=STAGE_CFG[d.stage]||{c:"#555",l:d.stage};
                    const con=conFor(d.contact_id);
                    return (
                      <div key={d.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:5,padding:"11px 14px",display:"flex",alignItems:"center",gap:12}} className="card">
                        <div style={{width:5,height:5,borderRadius:"50%",background:cfg.c,flexShrink:0}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,color:"#e0dcd0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{d.title}</div>
                          <div style={{fontSize:8,color:"#555",marginTop:1}}>{con?.full_name||"—"}</div>
                        </div>
                        <Bd label={cfg.l} color={cfg.c}/>
                        <span style={{fontSize:12,color:cfg.c,fontWeight:"500",minWidth:70,textAlign:"right"}}>{usd(d.value)}</span>
                        <Bd label={d.status} color={d.status==="won"?"#10b981":d.status==="lost"?"#ef4444":"#555"}/>
                        {d.expected_close&&<span style={{fontSize:8,color:"#333",minWidth:60}}>{fmt(d.expected_close)}</span>}
                        <div style={{display:"flex",gap:4}}>
                          {d.status==="open"&&<><button onClick={()=>setDealStatus(d.id,"won")} style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",color:"#10b981",cursor:"pointer",borderRadius:2,padding:"2px 8px",fontSize:9,fontFamily:"inherit"}}>WON</button><button onClick={()=>setDealStatus(d.id,"lost")} style={{background:"none",border:"1px solid rgba(239,68,68,.3)",color:"#ef4444",cursor:"pointer",borderRadius:2,padding:"2px 8px",fontSize:9,fontFamily:"inherit"}}>LOST</button></>}
                          <button onClick={()=>{setEditDeal(d);setShowDeal(true);}} style={{background:"none",border:"1px solid #1a1a28",color:"#444",cursor:"pointer",borderRadius:2,padding:"2px 8px",fontSize:9,fontFamily:"inherit"}}>✏</button>
                        </div>
                      </div>
                    );
                  })}
                  {deals.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:30,marginBottom:8}}>💼</div><div style={{fontSize:11}}>No deals yet</div></div>}
                </div>
              </div>
            )}

            {/* Tasks */}
            {sub==="tasks"&&(
              <div style={{flex:1,overflow:"auto",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".2em",color:"#d4af37"}}>TASKS</span>
                  <Btn onClick={()=>{setEditTask(null);setShowTask(true);}} variant="gold" style={{fontSize:9}}>+ NEW TASK</Btn>
                </div>
                {["urgent","high","medium","low"].map(prio=>{
                  const pts=tasks.filter(t=>t.priority===prio&&t.status!=="done");
                  if(!pts.length) return null;
                  const pc=PRIORITY_CFG[prio];
                  return (
                    <div key={prio} style={{marginBottom:14}}>
                      <div style={{fontSize:8,color:pc.c,letterSpacing:".12em",marginBottom:6}}>{pc.l.toUpperCase()} PRIORITY ({pts.length})</div>
                      <div style={{display:"flex",flexDirection:"column",gap:5}}>
                        {pts.map(t=>{
                          const due=fmtDue(t.due_at);
                          return (
                            <div key={t.id} style={{background:"#0d0d18",border:`1px solid ${pc.c}18`,borderRadius:4,padding:"9px 12px",display:"flex",gap:10,alignItems:"center"}}>
                              <span style={{fontSize:12,flexShrink:0}}>{TASK_ICONS[t.type]||"☑"}</span>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:10,color:"#c0bdb0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.title}</div>
                                {conFor(t.contact_id)&&<div style={{fontSize:8,color:"#555"}}>{conFor(t.contact_id).full_name}</div>}
                              </div>
                              {due&&<span style={{fontSize:8,color:due.color,flexShrink:0}}>{due.label}</span>}
                              <button onClick={()=>completeTask(t.id)} style={{background:"rgba(16,185,129,.1)",border:"1px solid rgba(16,185,129,.3)",color:"#10b981",cursor:"pointer",borderRadius:2,padding:"2px 8px",fontSize:9,fontFamily:"inherit"}}>DONE</button>
                              <button onClick={()=>{setEditTask(t);setShowTask(true);}} style={{background:"none",border:"1px solid #1a1a28",color:"#444",cursor:"pointer",borderRadius:2,padding:"2px 8px",fontSize:9,fontFamily:"inherit"}}>✏</button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
                {pendingTasks.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:24,marginBottom:8}}>🎉</div><div style={{fontSize:11}}>No pending tasks</div></div>}
              </div>
            )}

            {/* Timeline */}
            {sub==="timeline"&&(
              <div style={{flex:1,overflow:"auto",padding:16}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:".2em",color:"#d4af37"}}>ACTIVITY TIMELINE</span>
                  <Btn onClick={()=>{setActContext({});setShowActivity(true);}} variant="gold" style={{fontSize:9}}>+ LOG</Btn>
                </div>
                {activities.map((a,i)=>{
                  const icons={call:"📞",email:"✉",meeting:"📅",note:"📝",task:"☑",sms:"💬",follow_up:"↩"};
                  const con=conFor(a.contact_id);
                  return (
                    <div key={a.id} style={{display:"flex",gap:12,marginBottom:14}}>
                      <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0}}>
                        <div style={{width:28,height:28,borderRadius:"50%",background:"#0d0d18",border:"1px solid #1e1e28",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12}}>{icons[a.type]||"•"}</div>
                        {i<activities.length-1&&<div style={{width:1,flex:1,background:"#0e0e18",marginTop:4}}/>}
                      </div>
                      <div style={{flex:1,paddingBottom:12}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}>
                          <span style={{fontSize:10,color:"#e0dcd0"}}>{a.subject||a.type}</span>
                          <span style={{fontSize:8,color:"#2a2a3a"}}>{ago(a.created_at)}</span>
                        </div>
                        {con&&<div style={{fontSize:8,color:"#888",marginBottom:3}}>👤 {con.full_name}{con.company?` @ ${con.company}`:""}</div>}
                        {a.body&&<div style={{fontSize:10,color:"#555",lineHeight:1.6,background:"#0d0d18",border:"1px solid #131320",borderRadius:3,padding:"6px 10px",marginTop:4}}>{a.body}</div>}
                      </div>
                    </div>
                  );
                })}
                {activities.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:24,marginBottom:8}}>📝</div><div style={{fontSize:11}}>No activities yet</div></div>}
              </div>
            )}

            {/* Referrals */}
            {sub==="referrals"&&<ReferralTracker user={user} contacts={contacts} deals={deals} businesses={businesses} showToast={showToast} />}

            {/* Reviews */}
            {sub==="reviews"&&<ReviewCollector user={user} contacts={contacts} deals={deals} businesses={businesses} showToast={showToast} />}
          </div>
        )}

        {/* ── DOCS ── */}
        {view==="docs"&&(
          <div style={{flex:1,overflow:"hidden",display:"flex"}}>
            <div style={{width:200,borderRight:"1px solid #161626",display:"flex",flexDirection:"column",background:"#0a0a12",padding:"10px 0"}}>
              <div style={{padding:"0 12px",marginBottom:10}}>
                <div style={{fontSize:9,color:"#333",letterSpacing:".1em",marginBottom:6}}>BUSINESS</div>
                <button onClick={()=>setDocFilterBiz("")} style={{background:!docFilterBiz?"rgba(212,175,55,.07)":"none",border:"none",color:!docFilterBiz?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"3px 8px",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left"}}>All</button>
                {businesses.map(b=><button key={b.id} onClick={()=>setDocFilterBiz(b.id)} style={{background:docFilterBiz===b.id?"rgba(212,175,55,.07)":"none",border:"none",color:docFilterBiz===b.id?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"3px 8px",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left",display:"flex",gap:5,alignItems:"center"}}><span>{b.icon}</span>{b.name}</button>)}
              </div>
              <div style={{padding:"0 12px",borderTop:"1px solid #0e0e18",paddingTop:10}}>
                <div style={{fontSize:9,color:"#333",letterSpacing:".1em",marginBottom:6}}>CATEGORY</div>
                <button onClick={()=>setDocFilterCat("")} style={{background:!docFilterCat?"rgba(212,175,55,.07)":"none",border:"none",color:!docFilterCat?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"3px 8px",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left"}}>All</button>
                {Object.keys(CAT_COLORS).map(c=><button key={c} onClick={()=>setDocFilterCat(c)} style={{background:docFilterCat===c?"rgba(212,175,55,.07)":"none",border:"none",color:docFilterCat===c?"#d4af37":"#555",fontFamily:"inherit",fontSize:9,padding:"3px 8px",borderRadius:2,cursor:"pointer",width:"100%",textAlign:"left",textTransform:"capitalize"}}>{c.replace("_"," ")}</button>)}
              </div>
            </div>
            <div style={{flex:1,overflow:"auto",padding:16}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:10}}>
                <input value={docSearch} onChange={e=>setDocSearch(e.target.value)} placeholder="⌕ search documents..." style={{flex:1,maxWidth:280,background:"#0e0e1a",border:"1px solid #1a1a28",color:"#e0dcd0",fontFamily:"inherit",fontSize:11,padding:"6px 12px",borderRadius:3}}/>
                <div style={{display:"flex",gap:6}}>
                  <Btn onClick={()=>setShowDocTemplates(!showDocTemplates)} style={{fontSize:9,background:"rgba(139,92,246,.08)",border:"1px solid rgba(139,92,246,.25)",color:"#8b5cf6"}}>{showDocTemplates?"HIDE TEMPLATES":"📋 TEMPLATES"}</Btn>
                  <Btn onClick={()=>setShowDocUpload(true)} variant="gold" style={{fontSize:9}}>⬆ UPLOAD</Btn>
                </div>
              </div>
              {showDocTemplates&&<DocTemplatePanel contacts={contacts} businesses={businesses} user={user} showToast={showToast} />}
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
                {filteredDocs.map(doc=>{
                  const catColor=CAT_COLORS[doc.category]||"#555";
                  const biz=bizFor(doc.business_id);
                  return (
                    <div key={doc.id} style={{background:"#0d0d18",border:`1px solid ${catColor}20`,borderRadius:5,padding:"12px 14px"}} className="card">
                      <div style={{fontSize:18,marginBottom:8}}>📄</div>
                      <div style={{fontSize:10,color:"#e0dcd0",marginBottom:4,lineHeight:1.4}}>{doc.name}</div>
                      <div style={{display:"flex",gap:4,marginBottom:6,flexWrap:"wrap"}}>
                        <Bd label={doc.category?.replace("_"," ")||"general"} color={catColor}/>
                        {biz&&<Bd label={biz.name} color={biz.color||"#555"}/>}
                      </div>
                      {doc.description&&<div style={{fontSize:9,color:"#555",lineHeight:1.6,marginBottom:6}}>{doc.description}</div>}
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:"auto"}}>
                        <span style={{fontSize:8,color:"#333"}}>{doc.size||"—"} · {ago(doc.created_at)}</span>
                        <div style={{display:"flex",gap:4}}>
                          {doc.url&&<a href={doc.url} target="_blank" rel="noreferrer" style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.2)",color:"#d4af37",borderRadius:2,padding:"2px 7px",fontSize:9,textDecoration:"none"}}>↗</a>}
                          <button onClick={()=>deleteDoc(doc.id)} style={{background:"none",border:"1px solid rgba(239,68,68,.25)",color:"#ef4444",cursor:"pointer",borderRadius:2,padding:"2px 7px",fontSize:9,fontFamily:"inherit"}}>✕</button>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {filteredDocs.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:30,marginBottom:8}}>📁</div><div style={{fontSize:11}}>No documents</div></div>}
              </div>
            </div>
          </div>
        )}

        {/* ── INTEL ── */}
        {view==="intel"&&(
          <div style={{flex:1,overflow:"auto",padding:18}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37",marginBottom:14}}>EMAIL INTELLIGENCE</div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {intelligence.map(intel=>{
                const biz=bizFor(intel.business_id); const kd=intel.key_data||{};
                const catColors={"Rate Change":"#ef4444","New Product":"#10b981","Policy Update":"#f59e0b","Compliance":"#8b5cf6","General Info":"#3b82f6","Billing":"#f59e0b","Other":"#555"};
                return (
                  <div key={intel.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,padding:"13px 15px"}} className="fi">
                    <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,flexWrap:"wrap"}}>
                      {biz&&<Bd label={`${biz.icon||""} ${biz.name}`} color={biz.color||"#555"}/>}
                      <Bd label={intel.category||"Other"} color={catColors[intel.category]||"#555"}/>
                      <span style={{fontSize:8,color:intel.importance>=4?"#ef4444":intel.importance===3?"#f59e0b":"#3b82f6"}}>P{intel.importance}/5</span>
                      <span style={{fontSize:8,color:"#2a2a3a",marginLeft:"auto"}}>{ago(intel.created_at)}</span>
                    </div>
                    <div style={{fontSize:11,color:"#e0dcd0",marginBottom:4}}>{intel.email_subject}</div>
                    <div style={{fontSize:10,color:"#777",lineHeight:1.65}}>{intel.summary}</div>
                    {kd.rates?.length>0&&<div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>{kd.rates.map((r,i)=><div key={i} style={{background:"rgba(212,175,55,.08)",border:"1px solid rgba(212,175,55,.2)",borderRadius:3,padding:"4px 10px"}}><div style={{fontSize:9,color:"#888"}}>{r.product}</div><div style={{fontSize:13,color:"#d4af37",fontWeight:"500"}}>{r.rate}</div></div>)}</div>}
                    {intel.action_items?.length>0&&<div style={{marginTop:7}}>{intel.action_items.map((a,i)=><div key={i} style={{fontSize:9,color:"#666",padding:"2px 0",paddingLeft:10,borderLeft:"2px solid #1e1e2e"}}>→ {a}</div>)}</div>}
                  </div>
                );
              })}
              {intelligence.length===0&&<div style={{textAlign:"center",padding:50,color:"#1e1e2e"}}><div style={{fontSize:32,marginBottom:10}}>🧠</div><div style={{fontSize:11}}>No intelligence — extract from emails in inbox</div></div>}
            </div>
          </div>
        )}

        {/* ── BUSINESS ── */}
        {view==="biz"&&(
          <div style={{flex:1,overflow:"auto",padding:18}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37"}}>BUSINESSES & PRODUCTS</div>
            </div>

            {/* P&L Dashboard */}
            {businesses.length>0&&(()=>{
              const bizPL = businesses.map(biz=>{
                const rev = deals.filter(d=>d.business_id===biz.id&&(d.status==="won"||d.stage==="closed_won")).reduce((s,d)=>s+Number(d.value||0),0);
                const exp = invoices.filter(i=>i.business_id===biz.id&&i.status==="paid").reduce((s,i)=>s+Number(i.total||0),0);
                return {biz,rev,exp,profit:rev-exp,margin:rev>0?Math.round((rev-exp)/rev*100):0};
              });
              const totalRev = bizPL.reduce((s,b)=>s+b.rev,0);
              const totalExp = bizPL.reduce((s,b)=>s+b.exp,0);
              const totalProfit = totalRev-totalExp;
              return (
                <div style={{background:"#0a0a14",border:"1px solid rgba(212,175,55,.12)",borderRadius:6,padding:16,marginBottom:20}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:".15em",color:"#d4af37",marginBottom:12}}>PROFIT & LOSS OVERVIEW</div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:14}}>
                    <div style={{background:"#0d0d18",borderRadius:4,padding:"12px 14px",textAlign:"center",border:"1px solid rgba(16,185,129,.15)"}}>
                      <div style={{fontSize:22,color:"#10b981",fontWeight:700}}>${totalRev.toLocaleString()}</div>
                      <div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>TOTAL REVENUE</div>
                    </div>
                    <div style={{background:"#0d0d18",borderRadius:4,padding:"12px 14px",textAlign:"center",border:"1px solid rgba(239,68,68,.15)"}}>
                      <div style={{fontSize:22,color:"#ef4444",fontWeight:700}}>${totalExp.toLocaleString()}</div>
                      <div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>TOTAL EXPENSES</div>
                    </div>
                    <div style={{background:"#0d0d18",borderRadius:4,padding:"12px 14px",textAlign:"center",border:`1px solid ${totalProfit>=0?"rgba(212,175,55,.15)":"rgba(239,68,68,.15)"}`}}>
                      <div style={{fontSize:22,color:totalProfit>=0?"#d4af37":"#ef4444",fontWeight:700}}>${totalProfit.toLocaleString()}</div>
                      <div style={{fontSize:8,color:"#444",letterSpacing:".08em"}}>NET PROFIT</div>
                    </div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",gap:6}}>
                    {bizPL.map(({biz,rev,exp,profit,margin})=>(
                      <div key={biz.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:"1px solid #0e0e18"}}>
                        <span style={{fontSize:16}}>{biz.icon||"🏢"}</span>
                        <span style={{fontSize:10,color:"#e0dcd0",flex:1,minWidth:100}}>{biz.name}</span>
                        <span style={{fontSize:9,color:"#10b981",minWidth:70,textAlign:"right"}}>${rev.toLocaleString()}</span>
                        <span style={{fontSize:9,color:"#ef4444",minWidth:70,textAlign:"right"}}>${exp.toLocaleString()}</span>
                        <span style={{fontSize:10,color:profit>=0?"#d4af37":"#ef4444",fontWeight:600,minWidth:70,textAlign:"right"}}>${profit.toLocaleString()}</span>
                        <div style={{minWidth:50,textAlign:"right"}}>
                          <span style={{fontSize:8,color:margin>=0?"#10b981":"#ef4444",background:margin>=0?"rgba(16,185,129,.08)":"rgba(239,68,68,.08)",padding:"2px 6px",borderRadius:2}}>{margin}%</span>
                        </div>
                      </div>
                    ))}
                    <div style={{display:"flex",gap:20,justifyContent:"flex-end",fontSize:7,color:"#333",letterSpacing:".06em",paddingTop:4}}>
                      <span>REVENUE</span><span>EXPENSES</span><span>PROFIT</span><span>MARGIN</span>
                    </div>
                  </div>
                </div>
              );
            })()}

            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:14}}>
              {businesses.map(biz=>{
                const bProds=products.filter(p=>p.business_id===biz.id);
                const bCons=contacts.filter(c=>c.business_id===biz.id);
                const bDeals=deals.filter(d=>d.business_id===biz.id&&d.status==="open");
                const bIntel=intelligence.filter(i=>i.business_id===biz.id);
                const bRevenue=deals.filter(d=>d.business_id===biz.id&&d.status==="won").reduce((s,d)=>s+Number(d.value||0),0);
                return (
                  <div key={biz.id} style={{background:"#0d0d18",border:"1px solid #1e1e28",borderRadius:6,overflow:"hidden"}}>
                    <div style={{padding:"14px 16px",borderBottom:"1px solid #131320",display:"flex",alignItems:"center",gap:12,background:`${biz.color||"#d4af37"}06`}}>
                      <div style={{width:40,height:40,background:`${biz.color||"#d4af37"}20`,border:`1px solid ${biz.color||"#d4af37"}40`,borderRadius:6,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20}}>{biz.icon||"🏢"}</div>
                      <div style={{flex:1}}><div style={{fontSize:14,color:"#e0dcd0"}}>{biz.name}</div><div style={{fontSize:9,color:"#555"}}>{biz.type}</div></div>
                      {bRevenue>0&&<div style={{textAlign:"right"}}><div style={{fontSize:8,color:"#444"}}>WON</div><div style={{fontSize:13,color:"#10b981",fontWeight:"500"}}>{usd(bRevenue)}</div></div>}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",borderBottom:"1px solid #131320"}}>
                      {[{l:"PRODS",v:bProds.length},{l:"CONTACTS",v:bCons.length},{l:"DEALS",v:bDeals.length},{l:"INTEL",v:bIntel.length}].map(s=>(
                        <div key={s.l} style={{padding:"9px 0",textAlign:"center",borderRight:"1px solid #131320"}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:biz.color||"#d4af37"}}>{s.v}</div>
                          <div style={{fontSize:7,color:"#333",letterSpacing:".06em"}}>{s.l}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{padding:"10px 14px"}}>
                      {bProds.map(p=>(
                        <div key={p.id} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid #0f0f18"}}>
                          <span style={{fontSize:10,color:"#666"}}>{p.name} <span style={{fontSize:8,color:"#333"}}>{p.category}</span></span>
                          <span style={{fontSize:11,color:biz.color||"#d4af37",fontWeight:"500"}}>{p.current_value||"—"}</span>
                        </div>
                      ))}
                      {bProds.length===0&&<div style={{fontSize:9,color:"#1e1e2e",padding:"4px 0"}}>No products configured</div>}
                    </div>
                  </div>
                );
              })}
              {businesses.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:60,color:"#1e1e2e"}}><div style={{fontSize:32,marginBottom:8}}>🏢</div><div style={{fontSize:11}}>No businesses configured — add them in Supabase</div></div>}
            </div>
          </div>
        )}

        {/* ── SETTINGS ── */}
        {view==="callcenter"&&<CallCenterView user={user} teamProfile={teamProfile} isAdmin={isAdmin} calls={calls} setCalls={setCalls} callParticipants={callParticipants} setCallParts={setCallParts} callNotifs={callNotifs} setCallNotifs={setCallNotifs} selCall={selCall} setSelCall={setSelCall} showNewCall={showNewCall} setShowNewCall={setShowNewCall} callFilter={callFilter} setCallFilter={setCallFilter} callSearch={callSearch} setCallSearch={setCallSearch} contacts={contacts} setCon={setCon} deals={deals} businesses={businesses} showToast={showToast} onNav={handleNav} />}

        {view==="messages"&&sub==="unified"&&<UnifiedInboxView user={user} contacts={contacts} showToast={showToast} />}
        {view==="messages"&&sub==="wamanager"&&<WhatsAppManagerView user={user} contacts={contacts} showToast={showToast} />}
        {view==="messages"&&sub==="wapersonal"&&<WAPersonalView user={user} contacts={contacts} showToast={showToast} />}
        {view==="messages"&&sub==="sms"&&<SMSView user={user} contacts={contacts} showToast={showToast} />}
        {view==="messages"&&(sub==="internal"||!["unified","wamanager","wapersonal","sms"].includes(sub))&&<MessagesView user={user} teamProfile={teamProfile} isAdmin={isAdmin} showToast={showToast} />}

        {view==="appointments"&&<AppointmentsView user={user} contacts={contacts} businesses={businesses} showToast={showToast} />}

        {view==="invoices"&&<InvoicesView user={user} contacts={contacts} businesses={businesses} showToast={showToast} />}

        {view==="automations"&&<AutomationsView user={user} showToast={showToast} />}

        {view==="compliance"&&<ComplianceView user={user} businesses={businesses} showToast={showToast} />}

        {view==="vendors"&&<VendorsView user={user} businesses={businesses} showToast={showToast} />}

        {view==="esign"&&<ESignatureView user={user} contacts={contacts} businesses={businesses} showToast={showToast} />}

        {view==="pricing"&&<MortgagePOSView user={user} contacts={contacts} showToast={showToast} />}

        {view==="social"&&<SocialAgentsView sb={sb} n8nPost={n8nPost} user={user} KEN_ID="b7a67688-73f1-4f4b-9745-f357e81affa3" />}

        {view==="toolbox"&&<ToolboxView showToast={showToast} contacts={contacts} />}

        {view==="settings"&&<SettingsView user={user} teamProfile={teamProfile} isAdmin={isAdmin} spend={spend} showToast={showToast} />}
        </div>{/* end main content */}
      </div>{/* end sidebar + main */}
    </div>
  );
}
