import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import CreditReportParser from "./CreditReportParser.jsx";

// ─── SUPABASE CONFIG ──────────────────────────────────────────────────────────
const SB_URL = "https://sfelhasepvaoianyuvxe.supabase.co";
const SB_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNmZWxoYXNlcHZhb2lhbnl1dnhlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2ODY0NDcsImV4cCI6MjA4NjI2MjQ0N30.kNzRAcdXaHoo0xQnJwNXyqcFsSiUZj9PP1fwziEQkdc";
const SBH = { "Content-Type":"application/json", apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, Prefer:"return=representation" };

async function sbFetch(table, query="") {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}${query}`, { headers:SBH });
    if (!r.ok) return [];
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } catch(e) { console.error("sbFetch",e); return []; }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const GOLD = "#d4af37";
const BG = "#0a0a12";
const CARD_BG = "#111118";
const CARD_BORDER = "#1a1a24";
const INPUT_BG = "#08080f";
const INPUT_BORDER = "#1e1e28";
const TXT = "#ccc";
const TXT_DIM = "#777";
const TXT_BRIGHT = "#eee";
const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#6366f1";

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY"
];

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",
  CT:"Connecticut",DE:"Delaware",DC:"District of Columbia",FL:"Florida",GA:"Georgia",
  HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",KS:"Kansas",KY:"Kentucky",
  LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",
  NJ:"New Jersey",NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",
  OH:"Ohio",OK:"Oklahoma",OR:"Oregon",PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",
  SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",VT:"Vermont",VA:"Virginia",
  WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

const PROPERTY_TYPES = ["Single Family","Condo","Townhouse","2-Unit","3-Unit","4-Unit","Co-op","Manufactured","Mixed Use","Commercial"];
const OCCUPANCY_TYPES = ["Primary","Second Home","Investment"];
const LOAN_PURPOSES = ["Purchase","Rate/Term Refi","Cash-Out Refi","HELOC","Reverse","Construction"];
const LOAN_TYPES = ["Conventional","FHA","VA","USDA","Non-QM","Jumbo","DSCR","Bank Statement","Hard Money","Bridge"];
const DOC_TYPES = ["Full Doc","Bank Statement 12mo","Bank Statement 24mo","Asset Depletion","DSCR","No Doc","Stated Income"];
const EMPLOYMENT_TYPES = ["W2","Self-Employed","1099","Retired","Other"];
const CITIZENSHIP_TYPES = ["US Citizen","Permanent Resident","Non-Permanent Resident","Foreign National","ITIN"];
const LOAN_TERMS = ["15","20","25","30"];

const CATEGORY_COLORS = {
  "Conventional":"#6366f1","FHA":"#f59e0b","VA":"#22c55e","USDA":"#10b981",
  "Non-QM":"#ec4899","Jumbo":"#8b5cf6","DSCR":"#f97316","Bank Statement":"#14b8a6",
  "Hard Money":"#ef4444","Bridge":"#e11d48","default":"#555"
};

// ─── QUICK SCENARIO PRESETS ───────────────────────────────────────────────────
const PRESETS = {
  "Conventional 30yr Primary": {
    fico:740, employment:"W2", monthlyIncome:8500, citizenship:"US Citizen",
    firstTime:false, propertyType:"Single Family", occupancy:"Primary", state:"CA",
    propertyValue:550000, loanPurpose:"Purchase", loanAmount:440000, loanTerm:"30",
    loanType:"Conventional", docType:"Full Doc", interestOnly:false, points:0
  },
  "FHA First-Time Buyer": {
    fico:640, employment:"W2", monthlyIncome:5000, citizenship:"US Citizen",
    firstTime:true, propertyType:"Single Family", occupancy:"Primary", state:"TX",
    propertyValue:300000, loanAmount:289500, loanTerm:"30",
    loanType:"FHA", docType:"Full Doc", interestOnly:false, points:0
  },
  "DSCR Investor": {
    fico:700, employment:"Self-Employed", monthlyIncome:15000, citizenship:"US Citizen",
    firstTime:false, propertyType:"Single Family", occupancy:"Investment", state:"FL",
    propertyValue:400000, loanAmount:300000, loanTerm:"30",
    loanType:"DSCR", docType:"DSCR", interestOnly:false, points:0,
    dscrRatio:1.25, propertiesOwned:5, rentalIncome:2800
  },
  "Non-QM Self-Employed": {
    fico:680, employment:"Self-Employed", monthlyIncome:12000, citizenship:"US Citizen",
    firstTime:false, propertyType:"Single Family", occupancy:"Primary", state:"NY",
    propertyValue:650000, loanAmount:520000, loanTerm:"30",
    loanType:"Non-QM", docType:"Bank Statement 12mo", interestOnly:false, points:0
  },
  "Jumbo Purchase": {
    fico:760, employment:"W2", monthlyIncome:25000, citizenship:"US Citizen",
    firstTime:false, propertyType:"Single Family", occupancy:"Primary", state:"CA",
    propertyValue:1500000, loanAmount:1200000, loanTerm:"30",
    loanType:"Jumbo", docType:"Full Doc", interestOnly:false, points:0
  }
};

// ─── DEFAULT SCENARIO ─────────────────────────────────────────────────────────
const defaultScenario = {
  fico:720, employment:"W2", monthlyIncome:7500, dti:"", citizenship:"US Citizen",
  firstTime:false, propertyType:"Single Family", occupancy:"Primary", state:"",
  propertyValue:"", loanPurpose:"Purchase", loanAmount:"", ltv:"", downPayment:"",
  loanTerm:"30", loanType:"Conventional", docType:"Full Doc", interestOnly:false,
  points:0, dscrRatio:"", propertiesOwned:"", rentalIncome:""
};

// ─── STYLES ───────────────────────────────────────────────────────────────────
const S = {
  root:{ display:"flex", height:"calc(100vh - 90px)", background:BG, color:TXT, fontFamily:"'Inter','Segoe UI',sans-serif", fontSize:10, letterSpacing:".05em", position:"relative", overflow:"hidden" },
  leftPanel:{ width:"40%", minWidth:340, maxWidth:520, borderRight:`1px solid ${CARD_BORDER}`, overflowY:"auto", padding:"12px 14px", flexShrink:0, maxHeight:"calc(100vh - 90px)" },
  rightPanel:{ flex:1, overflowY:"auto", padding:"12px 16px" },
  sectionTitle:{ fontSize:9, fontWeight:700, textTransform:"uppercase", letterSpacing:".1em", color:GOLD, marginBottom:8, marginTop:14, display:"flex", alignItems:"center", gap:6 },
  card:{ background:CARD_BG, border:`1px solid ${CARD_BORDER}`, borderRadius:6, padding:"10px 12px", marginBottom:8 },
  goldCard:{ background:CARD_BG, border:`1px solid ${GOLD}33`, borderRadius:6, padding:"10px 12px", marginBottom:8 },
  input:{ background:INPUT_BG, border:`1px solid ${INPUT_BORDER}`, color:TXT, padding:"6px 10px", fontSize:10, borderRadius:4, width:"100%", boxSizing:"border-box", outline:"none", letterSpacing:".04em" },
  select:{ background:INPUT_BG, border:`1px solid ${INPUT_BORDER}`, color:TXT, padding:"6px 10px", fontSize:10, borderRadius:4, width:"100%", boxSizing:"border-box", outline:"none", letterSpacing:".04em", appearance:"none" },
  label:{ fontSize:8, fontWeight:600, textTransform:"uppercase", letterSpacing:".08em", color:TXT_DIM, marginBottom:3, display:"block" },
  row:{ display:"flex", gap:8, marginBottom:6 },
  col:{ flex:1, minWidth:0 },
  btnGold:{ background:GOLD, color:"#0a0a0f", border:"none", borderRadius:4, padding:"8px 16px", fontSize:10, fontWeight:700, letterSpacing:".06em", cursor:"pointer", textTransform:"uppercase", display:"flex", alignItems:"center", justifyContent:"center", gap:6, width:"100%" },
  btnOutline:{ background:"transparent", color:GOLD, border:`1px solid ${GOLD}55`, borderRadius:4, padding:"5px 12px", fontSize:9, fontWeight:600, letterSpacing:".05em", cursor:"pointer" },
  btnSmall:{ background:"transparent", color:TXT_DIM, border:`1px solid ${CARD_BORDER}`, borderRadius:3, padding:"3px 8px", fontSize:8, cursor:"pointer", letterSpacing:".04em" },
  badge:{ display:"inline-block", padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:600, letterSpacing:".04em", marginRight:4, marginBottom:3 },
  greenBadge:{ background:`${GREEN}22`, color:GREEN, display:"inline-block", padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:600, marginRight:4, marginBottom:3 },
  redBadge:{ background:`${RED}22`, color:RED, display:"inline-block", padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:600, marginRight:4, marginBottom:3 },
  toggle:{ width:32, height:16, borderRadius:8, cursor:"pointer", position:"relative", transition:"background .2s" },
  toggleDot:{ width:12, height:12, borderRadius:6, background:"#fff", position:"absolute", top:2, transition:"left .2s" },
  scoreBar:{ height:6, borderRadius:3, background:`${CARD_BORDER}` },
  scoreFill:{ height:6, borderRadius:3, transition:"width .3s" },
  overlay:{ position:"fixed", top:0, left:0, right:0, bottom:0, background:"rgba(0,0,0,.6)", zIndex:1000, display:"flex", justifyContent:"flex-end" },
  drawer:{ width:480, maxWidth:"90vw", background:CARD_BG, borderLeft:`1px solid ${CARD_BORDER}`, height:"100%", overflowY:"auto", padding:"16px 18px", animation:"slideIn .2s ease-out" },
  chatPanel:{ width:380, maxWidth:"90vw", background:BG, borderLeft:`1px solid ${CARD_BORDER}`, height:"100%", display:"flex", flexDirection:"column" },
  chatMsg:{ padding:"8px 12px", borderRadius:6, fontSize:10, lineHeight:1.5, maxWidth:"85%", marginBottom:8 },
  table:{ width:"100%", borderCollapse:"collapse", fontSize:9 },
  th:{ textAlign:"left", padding:"6px 8px", borderBottom:`1px solid ${CARD_BORDER}`, fontSize:8, fontWeight:700, textTransform:"uppercase", letterSpacing:".08em", color:TXT_DIM },
  td:{ padding:"6px 8px", borderBottom:`1px solid ${CARD_BORDER}08`, verticalAlign:"middle" },
  presetBtn:{ background:`${GOLD}11`, border:`1px solid ${GOLD}33`, color:GOLD, borderRadius:4, padding:"4px 10px", fontSize:8, cursor:"pointer", letterSpacing:".04em", whiteSpace:"nowrap" }
};

// ─── HELPER COMPONENTS ────────────────────────────────────────────────────────
function Toggle({ value, onChange, label }) {
  return (
    <div style={{ display:"flex", alignItems:"center", gap:8 }}>
      <div
        onClick={()=>onChange(!value)}
        style={{ ...S.toggle, background:value?GOLD:"#333" }}
      >
        <div style={{ ...S.toggleDot, left:value?18:2 }} />
      </div>
      {label && <span style={{ fontSize:9, color:TXT_DIM }}>{label}</span>}
    </div>
  );
}

function Field({ label, children, style:extra }) {
  return (
    <div style={{ ...S.col, ...extra }}>
      <label style={S.label}>{label}</label>
      {children}
    </div>
  );
}

function ScoreBar({ score }) {
  const color = score>=80?GREEN:score>=60?GOLD:score>=40?"#f59e0b":RED;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <div style={{ ...S.scoreBar, flex:1 }}>
        <div style={{ ...S.scoreFill, width:`${score}%`, background:color }} />
      </div>
      <span style={{ fontSize:8, color, fontWeight:700, minWidth:28 }}>{score}%</span>
    </div>
  );
}

function CategoryBadge({ category }) {
  const c = CATEGORY_COLORS[category] || CATEGORY_COLORS.default;
  return <span style={{ ...S.badge, background:`${c}22`, color:c }}>{category}</span>;
}

function fmt$(v) {
  const n = Number(v);
  if (isNaN(n) || !n) return "$0";
  return "$" + n.toLocaleString("en-US", { maximumFractionDigits:0 });
}

function fmtRate(min, max) {
  if (!min && !max) return "N/A";
  if (min && max && min !== max) return `${Number(min).toFixed(3)}% - ${Number(max).toFixed(3)}%`;
  return `${Number(min || max).toFixed(3)}%`;
}

// ─── MATCHING LOGIC ───────────────────────────────────────────────────────────
function scoreProgram(program, scenario) {
  let score = 0;
  let maxScore = 0;
  const reasons = [];

  // FICO check
  if (program.min_fico) {
    maxScore += 30;
    if (scenario.fico >= program.min_fico) {
      score += 30;
      reasons.push("FICO qualifies");
    } else {
      reasons.push(`Min FICO ${program.min_fico} required`);
    }
  }

  // LTV check
  const ltv = calcLTV(scenario);
  if (program.max_ltv && ltv) {
    maxScore += 25;
    if (ltv <= program.max_ltv) {
      score += 25;
      reasons.push("LTV within limits");
    } else {
      reasons.push(`Max LTV ${program.max_ltv}%`);
    }
  }

  // Loan amount check
  const amt = Number(scenario.loanAmount) || 0;
  if (program.min_loan || program.max_loan) {
    maxScore += 20;
    const minOk = !program.min_loan || amt >= program.min_loan;
    const maxOk = !program.max_loan || amt <= program.max_loan;
    if (minOk && maxOk) {
      score += 20;
      reasons.push("Loan amount in range");
    } else {
      reasons.push(`Loan range: ${fmt$(program.min_loan)} - ${fmt$(program.max_loan)}`);
    }
  }

  // Property type check
  if (program.property_types && Array.isArray(program.property_types) && program.property_types.length > 0 && scenario.propertyType) {
    maxScore += 15;
    const ptLower = program.property_types.map(p => (p||"").toLowerCase());
    if (ptLower.includes(scenario.propertyType.toLowerCase())) {
      score += 15;
      reasons.push("Property type eligible");
    }
  }

  // Occupancy check
  if (program.occupancy_types && Array.isArray(program.occupancy_types) && program.occupancy_types.length > 0 && scenario.occupancy) {
    maxScore += 10;
    const ocLower = program.occupancy_types.map(o => (o||"").toLowerCase());
    if (ocLower.includes(scenario.occupancy.toLowerCase())) {
      score += 10;
    }
  }

  // Doc type check
  if (program.doc_types && Array.isArray(program.doc_types) && program.doc_types.length > 0 && scenario.docType) {
    maxScore += 10;
    const dtLower = program.doc_types.map(d => (d||"").toLowerCase());
    if (dtLower.includes(scenario.docType.toLowerCase())) {
      score += 10;
      reasons.push("Doc type matches");
    }
  }

  // Category / loan type mapping
  if (program.category && scenario.loanType) {
    maxScore += 15;
    const cat = (program.category||"").toLowerCase();
    const lt = (scenario.loanType||"").toLowerCase();
    if (cat.includes(lt) || lt.includes(cat) || cat === lt) {
      score += 15;
      reasons.push("Program category match");
    }
  }

  // State check
  if (program.eligible_states && Array.isArray(program.eligible_states) && program.eligible_states.length > 0 && scenario.state) {
    const stLower = program.eligible_states.map(s => (s||"").toUpperCase());
    if (!stLower.includes(scenario.state.toUpperCase()) && !stLower.includes("ALL")) {
      score = Math.max(0, score - 20);
      reasons.push("State may not be eligible");
    }
  }

  const pct = maxScore > 0 ? Math.round((score / maxScore) * 100) : 50;
  return { score: Math.min(pct, 100), reasons };
}

function calcLTV(scenario) {
  const val = Number(scenario.propertyValue) || 0;
  const amt = Number(scenario.loanAmount) || 0;
  if (!val || !amt) return 0;
  return Math.round((amt / val) * 10000) / 100;
}

function calcDownPayment(scenario) {
  const val = Number(scenario.propertyValue) || 0;
  const amt = Number(scenario.loanAmount) || 0;
  return Math.max(0, val - amt);
}

function filterPrograms(programs, scenario) {
  return programs.filter(p => {
    if (p.min_fico && scenario.fico && scenario.fico < p.min_fico) return false;
    const ltv = calcLTV(scenario);
    if (p.max_ltv && ltv && ltv > p.max_ltv) return false;
    const amt = Number(scenario.loanAmount) || 0;
    if (amt > 0) {
      if (p.min_loan && amt < p.min_loan) return false;
      if (p.max_loan && amt > p.max_loan) return false;
    }
    return true;
  });
}

function generateAIReason(program, scenario, rank) {
  const parts = [];
  if (program.rate_min) parts.push(`competitive rate starting at ${Number(program.rate_min).toFixed(3)}%`);
  if (program.max_ltv && program.max_ltv >= 90) parts.push(`allows up to ${program.max_ltv}% LTV`);
  if (program.min_fico && scenario.fico && scenario.fico >= program.min_fico + 40) parts.push("borrower FICO well above minimum");
  if (program.doc_types && Array.isArray(program.doc_types) && program.doc_types.length > 1) parts.push("flexible documentation options");
  const hlCount = program.highlights ? program.highlights.length : 0;
  if (hlCount > 2) parts.push(`${hlCount} program highlights`);
  if (!parts.length) parts.push("strong overall match for this scenario");
  const prefix = rank === 0 ? "Best match: " : rank === 1 ? "Strong alternative: " : "Also consider: ";
  return prefix + parts.slice(0,2).join(", ") + ".";
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function LoanPricingView({ user, contacts, showToast }) {
  // ─── STATE ────────────────────────────────────────────────────────────────
  const [scenario, setScenario] = useState({ ...defaultScenario });
  const [programs, setPrograms] = useState([]);
  const [lenders, setLenders] = useState([]);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [sortCol, setSortCol] = useState("score");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedProgram, setSelectedProgram] = useState(null);
  const [compareIds, setCompareIds] = useState([]);
  const [showCompare, setShowCompare] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [savedScenarios, setSavedScenarios] = useState([]);
  const [saveScenarioName, setSaveScenarioName] = useState("");
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [livePricing, setLivePricing] = useState(false);
  const [pricingMode, setPricingMode] = useState("internal"); // "internal" | "loansifter" | "loansifter_full"
  const LOANSIFTER_WIDGET_KEY = "1c5f3d6c-ee52-43dd-a3b0-2b804a907fb5";
  const LOANSIFTER_QUICK_QUOTE_URL = `https://loansifternow.optimalblue.com/consumer/quick-quotes/${LOANSIFTER_WIDGET_KEY}`;
  const LOANSIFTER_FULL_URL = "https://loansifternow.optimalblue.com";
  const chatEndRef = useRef(null);

  // ─── LOAD SAVED SCENARIOS FROM LOCAL STORAGE ──────────────────────────────
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("vault_saved_scenarios") || "[]");
      setSavedScenarios(saved);
    } catch { setSavedScenarios([]); }
  }, []);

  // ─── AUTO-CALC LTV & DOWN PAYMENT ─────────────────────────────────────────
  const updateScenario = useCallback((patch) => {
    setScenario(prev => {
      const next = { ...prev, ...patch };
      const val = Number(next.propertyValue) || 0;
      const amt = Number(next.loanAmount) || 0;
      if (val > 0 && amt > 0) {
        if (!patch.ltv) next.ltv = (Math.round((amt / val) * 10000) / 100).toString();
        if (!patch.downPayment) next.downPayment = (val - amt).toString();
      }
      if (patch.ltv && val > 0) {
        const newLtv = Number(patch.ltv) || 0;
        next.loanAmount = Math.round(val * newLtv / 100).toString();
        next.downPayment = Math.round(val * (1 - newLtv / 100)).toString();
      }
      if (patch.downPayment && val > 0) {
        const dp = Number(patch.downPayment) || 0;
        next.loanAmount = (val - dp).toString();
        next.ltv = (Math.round(((val - dp) / val) * 10000) / 100).toString();
      }
      return next;
    });
  }, []);

  // ─── SEARCH PROGRAMS ──────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setLoading(true);
    setSearched(true);
    try {
      const [progs, lnds] = await Promise.all([
        sbFetch("vault_programs", "?is_active=eq.true&select=*"),
        sbFetch("dm_lenders", "?is_active=eq.true&select=*")
      ]);
      setPrograms(progs || []);
      setLenders(lnds || []);
      const lenderMap = {};
      (lnds || []).forEach(l => { lenderMap[l.id] = l; });

      const filtered = filterPrograms(progs || [], scenario);
      const scored = filtered.map(p => {
        const { score, reasons } = scoreProgram(p, scenario);
        return { ...p, _score: score, _reasons: reasons, _lender: lenderMap[p.lender_id] || null };
      }).sort((a, b) => b._score - a._score);

      setResults(scored);
      if (scored.length > 0) {
        showToast && showToast(`Found ${scored.length} matching programs`, "success");
      } else {
        showToast && showToast("No programs matched this scenario. Try adjusting criteria.", "warning");
      }
    } catch(e) {
      console.error("Search error:", e);
      showToast && showToast("Error searching programs", "error");
    }
    setLoading(false);
  }, [scenario, showToast]);

  // ─── SORT RESULTS ─────────────────────────────────────────────────────────
  const sortedResults = useMemo(() => {
    const arr = [...results];
    arr.sort((a, b) => {
      let va, vb;
      switch(sortCol) {
        case "score": va = a._score; vb = b._score; break;
        case "rate": va = a.rate_min||999; vb = b.rate_min||999; break;
        case "lender": va = a._lender?.name||""; vb = b._lender?.name||""; break;
        case "name": va = a.name||""; vb = b.name||""; break;
        case "ltv": va = a.max_ltv||0; vb = b.max_ltv||0; break;
        case "fico": va = a.min_fico||0; vb = b.min_fico||0; break;
        default: va = a._score; vb = b._score;
      }
      if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortDir === "asc" ? va - vb : vb - va;
    });
    return arr;
  }, [results, sortCol, sortDir]);

  const top3 = useMemo(() => sortedResults.slice(0, 3), [sortedResults]);

  // ─── COMPARISON ───────────────────────────────────────────────────────────
  const comparePrograms = useMemo(() => {
    return results.filter(r => compareIds.includes(r.id));
  }, [results, compareIds]);

  const toggleCompare = useCallback((id) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 3) return prev;
      return [...prev, id];
    });
  }, []);

  // ─── SAVE / LOAD SCENARIOS ────────────────────────────────────────────────
  const saveCurrentScenario = useCallback(() => {
    if (!saveScenarioName.trim()) return;
    const entry = { name: saveScenarioName.trim(), scenario: { ...scenario }, savedAt: new Date().toISOString() };
    const updated = [...savedScenarios, entry];
    setSavedScenarios(updated);
    localStorage.setItem("vault_saved_scenarios", JSON.stringify(updated));
    setSaveScenarioName("");
    setShowSaveModal(false);
    showToast && showToast("Scenario saved", "success");
  }, [saveScenarioName, scenario, savedScenarios, showToast]);

  const loadScenario = useCallback((idx) => {
    const entry = savedScenarios[idx];
    if (entry) {
      setScenario({ ...defaultScenario, ...entry.scenario });
      showToast && showToast(`Loaded: ${entry.name}`, "success");
    }
  }, [savedScenarios, showToast]);

  const deleteScenario = useCallback((idx) => {
    const updated = savedScenarios.filter((_, i) => i !== idx);
    setSavedScenarios(updated);
    localStorage.setItem("vault_saved_scenarios", JSON.stringify(updated));
  }, [savedScenarios]);

  // ─── AI CHAT ──────────────────────────────────────────────────────────────
  const sendChat = useCallback(async () => {
    if (!chatInput.trim()) return;
    const userMsg = { role: "user", text: chatInput.trim() };
    setChatMessages(prev => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);
    try {
      const r = await fetch(`${SB_URL}/functions/v1/scenario-chat`, {
        method: "POST",
        headers: { "Content-Type":"application/json", Authorization:`Bearer ${SB_KEY}` },
        body: JSON.stringify({ message: userMsg.text, scenario, resultsCount: results.length })
      });
      if (r.ok) {
        const data = await r.json();
        setChatMessages(prev => [...prev, { role:"assistant", text: data.response || data.message || "I can help you analyze loan scenarios. Try asking about specific borrower profiles or program comparisons." }]);
      } else {
        setChatMessages(prev => [...prev, { role:"assistant", text:"AI Advisor is being configured. For now, try adjusting scenario inputs and clicking 'Find Best Programs' to explore available options." }]);
      }
    } catch {
      setChatMessages(prev => [...prev, { role:"assistant", text:"AI Advisor is currently offline. Use the scenario inputs to explore programs manually." }]);
    }
    setChatLoading(false);
  }, [chatInput, scenario, results]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior:"smooth" });
  }, [chatMessages]);

  // ─── APPLY PRESET ─────────────────────────────────────────────────────────
  const applyPreset = useCallback((name) => {
    const p = PRESETS[name];
    if (p) {
      setScenario({ ...defaultScenario, ...p });
      showToast && showToast(`Loaded preset: ${name}`, "success");
    }
  }, [showToast]);

  // ─── SORT HANDLER ─────────────────────────────────────────────────────────
  const handleSort = useCallback((col) => {
    setSortCol(prev => {
      if (prev === col) { setSortDir(d => d === "asc" ? "desc" : "asc"); return col; }
      setSortDir("desc");
      return col;
    });
  }, []);

  // ─── Investor/DSCR fields visibility ──────────────────────────────────────
  const showInvestor = scenario.occupancy === "Investment" || scenario.loanType === "DSCR";

  // ─── Summary stats ────────────────────────────────────────────────────────
  const uniqueLenders = useMemo(() => {
    const set = new Set(results.map(r => r.lender_id).filter(Boolean));
    return set.size;
  }, [results]);
  const bestRate = useMemo(() => {
    const rates = results.map(r => r.rate_min).filter(Boolean);
    return rates.length > 0 ? Math.min(...rates) : null;
  }, [results]);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div style={S.root}>
      {/* ─── LEFT PANEL: SCENARIO INPUT ─────────────────────────────────────── */}
      <div style={S.leftPanel}>
        {/* PRICING MODE SELECTOR */}
        <div style={{ display:"flex", gap:4, marginBottom:12 }}>
          {[
            { id:"internal", label:"AI Match", icon:"🧠" },
            { id:"loansifter", label:"Quick Quote", icon:"⚡" },
            { id:"loansifter_full", label:"Loansifter Full", icon:"🏦" },
          ].map(m => (
            <button key={m.id} onClick={() => setPricingMode(m.id)} style={{
              flex:1, padding:"8px 6px", background: pricingMode===m.id ? GOLD+"22" : CARD_BG,
              border: `1px solid ${pricingMode===m.id ? GOLD : CARD_BORDER}`, borderRadius:8,
              color: pricingMode===m.id ? GOLD : TXT_DIM, cursor:"pointer", fontSize:10, fontWeight:600,
              display:"flex", flexDirection:"column", alignItems:"center", gap:3, transition:"all .2s"
            }}>
              <span style={{ fontSize:16 }}>{m.icon}</span>
              <span style={{ textTransform:"uppercase", letterSpacing:".04em" }}>{m.label}</span>
            </button>
          ))}
        </div>

        {/* LOANSIFTER IFRAME MODES */}
        {pricingMode === "loansifter" && (
          <div style={{ ...S.card, border:`1px solid ${BLUE}33`, marginBottom:12, padding:0, overflow:"hidden", borderRadius:10 }}>
            <div style={{ padding:"8px 12px", background:BLUE+"15", borderBottom:`1px solid ${BLUE}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:10, fontWeight:700, color:BLUE }}>LOANSIFTER QUICK QUOTE</span>
              <span style={{ fontSize:8, color:TXT_DIM }}>Powered by Optimal Blue</span>
            </div>
            <iframe
              src={LOANSIFTER_QUICK_QUOTE_URL}
              style={{ width:"100%", height:600, border:"none", background:"#fff" }}
              title="Loansifter Quick Quote"
              allow="clipboard-write"
            />
          </div>
        )}
        {pricingMode === "loansifter_full" && (
          <div style={{ ...S.card, border:`1px solid ${GOLD}33`, marginBottom:12, padding:0, overflow:"hidden", borderRadius:10 }}>
            <div style={{ padding:"8px 12px", background:GOLD+"15", borderBottom:`1px solid ${GOLD}33`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontSize:10, fontWeight:700, color:GOLD }}>LOANSIFTER FULL PPE</span>
              <a href={LOANSIFTER_FULL_URL} target="_blank" rel="noopener noreferrer" style={{ fontSize:8, color:BLUE, textDecoration:"none" }}>Open in new tab &rarr;</a>
            </div>
            <iframe
              src={LOANSIFTER_FULL_URL}
              style={{ width:"100%", height:700, border:"none", background:"#fff" }}
              title="Loansifter Full"
              allow="clipboard-write"
            />
          </div>
        )}

        {pricingMode === "internal" && (
        <div style={{ ...S.card, border:`1px solid ${GREEN}22`, marginBottom:12, padding:"8px 10px" }}>
          <div style={{ fontSize:9, color:GREEN, fontWeight:600, marginBottom:4 }}>AI SCENARIO MATCHER</div>
          <div style={{ fontSize:8, color:TXT_DIM }}>Match against your lender database ({programs.length} programs, {lenders.length} lenders)</div>
        </div>
        )}

        {/* QUICK SCENARIOS — only show in internal mode */}
        {pricingMode === "internal" && (<>
        <div style={{ marginBottom:12 }}>
          <div style={S.sectionTitle}>Quick Scenarios</div>
          <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
            {Object.keys(PRESETS).map(name => (
              <button key={name} style={S.presetBtn} onClick={() => applyPreset(name)}>{name}</button>
            ))}
          </div>
        </div>

        {/* SAVED SCENARIOS */}
        {savedScenarios.length > 0 && (
          <div style={{ marginBottom:12 }}>
            <div style={S.sectionTitle}>Saved Scenarios</div>
            <div style={{ display:"flex", flexWrap:"wrap", gap:4 }}>
              {savedScenarios.map((s, i) => (
                <div key={i} style={{ display:"flex", alignItems:"center", gap:2 }}>
                  <button style={S.presetBtn} onClick={() => loadScenario(i)}>{s.name}</button>
                  <button style={{ ...S.btnSmall, color:RED, border:"none", padding:"2px 4px", fontSize:8 }} onClick={() => deleteScenario(i)}>x</button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CREDIT REPORT DROP ZONE */}
        <div style={S.sectionTitle}>Credit Report Import</div>
        </>)}
        {pricingMode === "internal" && <CreditReportParser
          showToast={showToast}
          onApplyToScenario={({ fico, monthlyDebt, liabilities, scores }) => {
            const updates = {};
            if (fico) updates.fico = fico;
            if (monthlyDebt && scenario.monthlyIncome) {
              updates.dti = Math.round((monthlyDebt / scenario.monthlyIncome) * 100);
            }
            updateScenario(updates);
          }}
        />}

        {pricingMode === "internal" && (<>
        {/* BORROWER INFO */}
        <div style={S.sectionTitle}>Borrower Info</div>
        <div style={S.card}>
          <div style={S.row}>
            <Field label="FICO Score">
              <input type="number" min={300} max={850} style={S.input} value={scenario.fico} onChange={e => updateScenario({ fico:Number(e.target.value) })} />
            </Field>
            <Field label="Employment">
              <select style={S.select} value={scenario.employment} onChange={e => updateScenario({ employment:e.target.value })}>
                {EMPLOYMENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div style={S.row}>
            <Field label="Monthly Income ($)">
              <input type="number" style={S.input} value={scenario.monthlyIncome} onChange={e => updateScenario({ monthlyIncome:e.target.value })} placeholder="7,500" />
            </Field>
            <Field label="DTI %">
              <input type="number" style={S.input} value={scenario.dti} onChange={e => updateScenario({ dti:e.target.value })} placeholder="Auto or manual" />
            </Field>
          </div>
          <div style={S.row}>
            <Field label="Citizenship">
              <select style={S.select} value={scenario.citizenship} onChange={e => updateScenario({ citizenship:e.target.value })}>
                {CITIZENSHIP_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="First-Time Buyer" style={{ flex:"0 0 auto", minWidth:100 }}>
              <Toggle value={scenario.firstTime} onChange={v => updateScenario({ firstTime:v })} />
            </Field>
          </div>
        </div>

        {/* PROPERTY INFO */}
        <div style={S.sectionTitle}>Property Info</div>
        <div style={S.card}>
          <div style={S.row}>
            <Field label="Property Type">
              <select style={S.select} value={scenario.propertyType} onChange={e => updateScenario({ propertyType:e.target.value })}>
                {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Occupancy">
              <select style={S.select} value={scenario.occupancy} onChange={e => updateScenario({ occupancy:e.target.value })}>
                {OCCUPANCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div style={S.row}>
            <Field label="State">
              <select style={S.select} value={scenario.state} onChange={e => updateScenario({ state:e.target.value })}>
                <option value="">Select state...</option>
                {US_STATES.map(s => <option key={s} value={s}>{s} - {STATE_NAMES[s]}</option>)}
              </select>
            </Field>
            <Field label="Property Value ($)">
              <input type="number" style={S.input} value={scenario.propertyValue} onChange={e => updateScenario({ propertyValue:e.target.value })} placeholder="500,000" />
            </Field>
          </div>
        </div>

        {/* LOAN DETAILS */}
        <div style={S.sectionTitle}>Loan Details</div>
        <div style={S.card}>
          <div style={S.row}>
            <Field label="Loan Purpose">
              <select style={S.select} value={scenario.loanPurpose} onChange={e => updateScenario({ loanPurpose:e.target.value })}>
                {LOAN_PURPOSES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Loan Amount ($)">
              <input type="number" style={S.input} value={scenario.loanAmount} onChange={e => updateScenario({ loanAmount:e.target.value })} placeholder="400,000" />
            </Field>
          </div>
          <div style={S.row}>
            <Field label="LTV %">
              <input type="number" style={S.input} value={scenario.ltv || (scenario.propertyValue && scenario.loanAmount ? calcLTV(scenario) : "")} onChange={e => updateScenario({ ltv:e.target.value })} placeholder="Auto" />
            </Field>
            <Field label="Down Payment ($)">
              <input type="number" style={S.input} value={scenario.downPayment || (scenario.propertyValue && scenario.loanAmount ? calcDownPayment(scenario) : "")} onChange={e => updateScenario({ downPayment:e.target.value })} placeholder="Auto" />
            </Field>
          </div>
          <div style={S.row}>
            <Field label="Loan Term">
              <select style={S.select} value={scenario.loanTerm} onChange={e => updateScenario({ loanTerm:e.target.value })}>
                {LOAN_TERMS.map(t => <option key={t} value={t}>{t} years</option>)}
              </select>
            </Field>
            <Field label="Loan Type">
              <select style={S.select} value={scenario.loanType} onChange={e => updateScenario({ loanType:e.target.value })}>
                {LOAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
          </div>
          <div style={S.row}>
            <Field label="Doc Type">
              <select style={S.select} value={scenario.docType} onChange={e => updateScenario({ docType:e.target.value })}>
                {DOC_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </Field>
            <Field label="Points / Credits">
              <input type="number" step="0.125" style={S.input} value={scenario.points} onChange={e => updateScenario({ points:e.target.value })} placeholder="0" />
            </Field>
          </div>
          <div style={{ ...S.row, alignItems:"center" }}>
            <Field label="Interest Only" style={{ flex:"0 0 auto", minWidth:100 }}>
              <Toggle value={scenario.interestOnly} onChange={v => updateScenario({ interestOnly:v })} />
            </Field>
          </div>
        </div>

        {/* INVESTOR / DSCR FIELDS */}
        {showInvestor && (
          <>
            <div style={S.sectionTitle}>Investor / DSCR</div>
            <div style={S.card}>
              <div style={S.row}>
                <Field label="DSCR Ratio">
                  <input type="number" step="0.01" style={S.input} value={scenario.dscrRatio} onChange={e => updateScenario({ dscrRatio:e.target.value })} placeholder="1.25" />
                </Field>
                <Field label="Properties Owned">
                  <input type="number" style={S.input} value={scenario.propertiesOwned} onChange={e => updateScenario({ propertiesOwned:e.target.value })} placeholder="0" />
                </Field>
              </div>
              <div style={S.row}>
                <Field label="Rental Income ($)">
                  <input type="number" style={S.input} value={scenario.rentalIncome} onChange={e => updateScenario({ rentalIncome:e.target.value })} placeholder="2,500" />
                </Field>
                <Field label="">&nbsp;</Field>
              </div>
            </div>
          </>
        )}

        {/* ACTION BUTTONS */}
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:6 }}>
          <button style={S.btnGold} onClick={handleSearch} disabled={loading}>
            {loading ? "Searching..." : "Find Best Programs"}
          </button>
          <div style={{ display:"flex", gap:6 }}>
            <button style={{ ...S.btnOutline, flex:1 }} onClick={() => setShowSaveModal(true)}>Save Scenario</button>
            <button style={{ ...S.btnOutline, flex:1 }} onClick={() => setScenario({ ...defaultScenario })}>Reset</button>
            <button style={{ ...S.btnOutline, flex:1, color:"#a78bfa", borderColor:"#a78bfa55" }} onClick={() => setShowChat(true)}>AI Advisor</button>
          </div>
        </div>
        </>)}
      </div>

      {/* ─── RIGHT PANEL: RESULTS ───────────────────────────────────────────── */}
      <div style={S.rightPanel}>
        {!searched ? (
          <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100%", textAlign:"center", opacity:.5 }}>
            <div style={{ fontSize:36, marginBottom:12 }}>&#x1F50D;</div>
            <div style={{ fontSize:12, fontWeight:600, color:TXT_DIM, marginBottom:6 }}>Loan Pricing Engine</div>
            <div style={{ fontSize:10, color:TXT_DIM, maxWidth:320, lineHeight:1.6 }}>
              Configure your borrower scenario on the left and click "Find Best Programs" to search across all available lender programs.
            </div>
          </div>
        ) : loading ? (
          <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100%", opacity:.5 }}>
            <div style={{ fontSize:11, color:TXT_DIM }}>Searching programs...</div>
          </div>
        ) : (
          <>
            {/* SUMMARY BAR */}
            <div style={{ ...S.card, display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12, background:`${GOLD}08`, border:`1px solid ${GOLD}22` }}>
              <div style={{ display:"flex", gap:20 }}>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:GOLD }}>{results.length}</div>
                  <div style={{ fontSize:8, color:TXT_DIM, textTransform:"uppercase", letterSpacing:".08em" }}>Programs Matched</div>
                </div>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:TXT_BRIGHT }}>{uniqueLenders}</div>
                  <div style={{ fontSize:8, color:TXT_DIM, textTransform:"uppercase", letterSpacing:".08em" }}>Lenders</div>
                </div>
                <div>
                  <div style={{ fontSize:18, fontWeight:800, color:GREEN }}>{bestRate ? `${Number(bestRate).toFixed(3)}%` : "N/A"}</div>
                  <div style={{ fontSize:8, color:TXT_DIM, textTransform:"uppercase", letterSpacing:".08em" }}>Best Rate</div>
                </div>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                {compareIds.length > 0 && (
                  <button style={{ ...S.btnOutline, fontSize:8 }} onClick={() => setShowCompare(true)}>
                    Compare ({compareIds.length})
                  </button>
                )}
              </div>
            </div>

            {/* AI RECOMMENDATION CARDS - TOP 3 */}
            {top3.length > 0 && (
              <>
                <div style={S.sectionTitle}>AI Recommendations</div>
                <div style={{ display:"flex", gap:8, marginBottom:14 }}>
                  {top3.map((prog, i) => {
                    const medals = ["\uD83E\uDD47", "\uD83E\uDD48", "\uD83E\uDD49"];
                    return (
                      <div key={prog.id} style={{ ...S.goldCard, flex:1, borderColor:i===0?`${GOLD}88`:i===1?`${GOLD}55`:`${GOLD}33` }}>
                        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:6 }}>
                          <span style={{ fontSize:16 }}>{medals[i]}</span>
                          <ScoreBar score={prog._score} />
                        </div>
                        <div style={{ fontSize:10, fontWeight:700, color:TXT_BRIGHT, marginBottom:2 }}>{prog.name}</div>
                        <div style={{ fontSize:8, color:GOLD, marginBottom:4 }}>{prog._lender?.name || "Unknown Lender"}</div>
                        <div style={{ fontSize:9, color:TXT_BRIGHT, marginBottom:4 }}>{fmtRate(prog.rate_min, prog.rate_max)}</div>
                        <div style={{ fontSize:8, color:TXT_DIM, lineHeight:1.5, marginBottom:6 }}>
                          {generateAIReason(prog, scenario, i)}
                        </div>
                        <div style={{ marginBottom:6 }}>
                          {(prog.highlights || []).slice(0, 3).map((h, j) => (
                            <span key={j} style={S.greenBadge}>{h}</span>
                          ))}
                        </div>
                        <button style={{ ...S.btnOutline, width:"100%", fontSize:8, padding:"4px 0" }} onClick={() => setSelectedProgram(prog)}>
                          View Details
                        </button>
                      </div>
                    );
                  })}
                </div>
              </>
            )}

            {/* RESULTS TABLE */}
            {sortedResults.length > 0 && (
              <>
                <div style={{ ...S.sectionTitle, justifyContent:"space-between" }}>
                  <span>All Results ({sortedResults.length})</span>
                </div>
                <div style={{ ...S.card, padding:0, overflow:"hidden" }}>
                  <div style={{ overflowX:"auto" }}>
                    <table style={S.table}>
                      <thead>
                        <tr style={{ background:"#0d0d16" }}>
                          <th style={{ ...S.th, width:28 }}>
                            <span style={{ fontSize:7, color:TXT_DIM }}>CMP</span>
                          </th>
                          {[
                            { key:"lender", label:"Lender" },
                            { key:"name", label:"Program" },
                            { key:"category", label:"Category" },
                            { key:"rate", label:"Rate" },
                            { key:"ltv", label:"Max LTV" },
                            { key:"fico", label:"Min FICO" },
                            { key:"loanRange", label:"Loan Range" },
                            { key:"docType", label:"Doc Type" },
                            { key:"score", label:"Match" }
                          ].map(col => (
                            <th key={col.key} style={{ ...S.th, cursor:"pointer", userSelect:"none" }} onClick={() => col.key !== "loanRange" && col.key !== "docType" ? handleSort(col.key) : null}>
                              {col.label}
                              {sortCol === col.key && <span style={{ marginLeft:3, fontSize:7 }}>{sortDir === "asc" ? "\u25B2" : "\u25BC"}</span>}
                            </th>
                          ))}
                          <th style={S.th}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedResults.map(prog => (
                          <tr key={prog.id} style={{ cursor:"pointer" }} onMouseOver={e => e.currentTarget.style.background="#161620"} onMouseOut={e => e.currentTarget.style.background="transparent"}>
                            <td style={S.td}>
                              <input
                                type="checkbox"
                                checked={compareIds.includes(prog.id)}
                                onChange={() => toggleCompare(prog.id)}
                                style={{ accentColor:GOLD, width:12, height:12, cursor:"pointer" }}
                              />
                            </td>
                            <td style={{ ...S.td, fontWeight:600, color:TXT_BRIGHT, maxWidth:100, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {prog._lender?.name || "—"}
                            </td>
                            <td style={{ ...S.td, color:TXT_BRIGHT, maxWidth:130, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                              {prog.name}
                            </td>
                            <td style={S.td}>
                              <CategoryBadge category={prog.category || prog.program_type || "—"} />
                            </td>
                            <td style={{ ...S.td, color:GREEN, fontWeight:600 }}>
                              {fmtRate(prog.rate_min, prog.rate_max)}
                            </td>
                            <td style={S.td}>{prog.max_ltv ? `${prog.max_ltv}%` : "—"}</td>
                            <td style={S.td}>{prog.min_fico || "—"}</td>
                            <td style={{ ...S.td, fontSize:8 }}>
                              {prog.min_loan || prog.max_loan ? `${fmt$(prog.min_loan)} - ${fmt$(prog.max_loan)}` : "—"}
                            </td>
                            <td style={{ ...S.td, fontSize:8 }}>
                              {prog.doc_types && Array.isArray(prog.doc_types) ? prog.doc_types.slice(0,2).join(", ") : "—"}
                            </td>
                            <td style={{ ...S.td, minWidth:80 }}>
                              <ScoreBar score={prog._score} />
                            </td>
                            <td style={S.td}>
                              <button style={{ ...S.btnSmall, color:GOLD, borderColor:`${GOLD}44` }} onClick={() => setSelectedProgram(prog)}>Details</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {results.length === 0 && searched && !loading && (
              <div style={{ ...S.card, textAlign:"center", padding:30 }}>
                <div style={{ fontSize:24, marginBottom:8, opacity:.5 }}>&#x1F6AB;</div>
                <div style={{ fontSize:11, fontWeight:600, color:TXT_DIM, marginBottom:4 }}>No Programs Matched</div>
                <div style={{ fontSize:9, color:TXT_DIM, lineHeight:1.5 }}>
                  Try adjusting your FICO score, LTV, or loan amount. Broaden the loan type or remove state restrictions.
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* ─── PROGRAM DETAIL DRAWER ──────────────────────────────────────────── */}
      {selectedProgram && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setSelectedProgram(null); }}>
          <div style={S.drawer}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div>
                <div style={{ fontSize:12, fontWeight:700, color:TXT_BRIGHT }}>{selectedProgram.name}</div>
                <div style={{ fontSize:9, color:GOLD }}>{selectedProgram._lender?.name || "Unknown Lender"}</div>
              </div>
              <button style={{ ...S.btnSmall, fontSize:12, padding:"4px 8px" }} onClick={() => setSelectedProgram(null)}>&times;</button>
            </div>

            {/* Score */}
            <div style={{ marginBottom:12 }}>
              <div style={{ fontSize:8, color:TXT_DIM, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Match Score</div>
              <ScoreBar score={selectedProgram._score} />
            </div>

            {/* Key Details */}
            <div style={S.sectionTitle}>Program Details</div>
            <div style={S.card}>
              <DetailRow label="Category" value={selectedProgram.category || selectedProgram.program_type || "—"} />
              <DetailRow label="Rate Range" value={fmtRate(selectedProgram.rate_min, selectedProgram.rate_max)} valueColor={GREEN} />
              <DetailRow label="Min FICO" value={selectedProgram.min_fico || "N/A"} />
              <DetailRow label="Max LTV" value={selectedProgram.max_ltv ? `${selectedProgram.max_ltv}%` : "N/A"} />
              <DetailRow label="Loan Range" value={`${fmt$(selectedProgram.min_loan)} - ${fmt$(selectedProgram.max_loan)}`} />
              <DetailRow label="Min Down %" value={selectedProgram.min_down_pct ? `${selectedProgram.min_down_pct}%` : "N/A"} />
            </div>

            {/* Property Types */}
            {selectedProgram.property_types && selectedProgram.property_types.length > 0 && (
              <>
                <div style={S.sectionTitle}>Property Types</div>
                <div style={{ ...S.card, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {selectedProgram.property_types.map((t, i) => <span key={i} style={S.greenBadge}>{t}</span>)}
                </div>
              </>
            )}

            {/* Occupancy Types */}
            {selectedProgram.occupancy_types && selectedProgram.occupancy_types.length > 0 && (
              <>
                <div style={S.sectionTitle}>Occupancy Types</div>
                <div style={{ ...S.card, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {selectedProgram.occupancy_types.map((t, i) => <span key={i} style={S.greenBadge}>{t}</span>)}
                </div>
              </>
            )}

            {/* Doc Types */}
            {selectedProgram.doc_types && selectedProgram.doc_types.length > 0 && (
              <>
                <div style={S.sectionTitle}>Documentation Types</div>
                <div style={{ ...S.card, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {selectedProgram.doc_types.map((t, i) => <span key={i} style={{ ...S.badge, background:`${BLUE}22`, color:BLUE }}>{t}</span>)}
                </div>
              </>
            )}

            {/* Loan Purposes */}
            {selectedProgram.loan_purposes && selectedProgram.loan_purposes.length > 0 && (
              <>
                <div style={S.sectionTitle}>Loan Purposes</div>
                <div style={{ ...S.card, display:"flex", flexWrap:"wrap", gap:4 }}>
                  {selectedProgram.loan_purposes.map((t, i) => <span key={i} style={{ ...S.badge, background:`${GOLD}22`, color:GOLD }}>{t}</span>)}
                </div>
              </>
            )}

            {/* Eligible States */}
            {selectedProgram.eligible_states && selectedProgram.eligible_states.length > 0 && (
              <>
                <div style={S.sectionTitle}>Eligible States</div>
                <div style={{ ...S.card, fontSize:9, color:TXT, lineHeight:1.6 }}>
                  {selectedProgram.eligible_states.length > 45 ? (
                    <span style={{ color:GREEN, fontWeight:600 }}>All 50 states + DC</span>
                  ) : (
                    selectedProgram.eligible_states.join(", ")
                  )}
                </div>
              </>
            )}

            {/* Highlights */}
            {selectedProgram.highlights && selectedProgram.highlights.length > 0 && (
              <>
                <div style={S.sectionTitle}>Highlights</div>
                <div style={{ ...S.card, display:"flex", flexDirection:"column", gap:4 }}>
                  {selectedProgram.highlights.map((h, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:6 }}>
                      <span style={{ color:GREEN, fontSize:10, lineHeight:1 }}>&#x2713;</span>
                      <span style={{ fontSize:9, color:TXT, lineHeight:1.4 }}>{h}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Restrictions */}
            {selectedProgram.restrictions && selectedProgram.restrictions.length > 0 && (
              <>
                <div style={S.sectionTitle}>Restrictions</div>
                <div style={{ ...S.card, display:"flex", flexDirection:"column", gap:4 }}>
                  {selectedProgram.restrictions.map((r, i) => (
                    <div key={i} style={{ display:"flex", alignItems:"flex-start", gap:6 }}>
                      <span style={{ color:RED, fontSize:10, lineHeight:1 }}>&#x26A0;</span>
                      <span style={{ fontSize:9, color:TXT, lineHeight:1.4 }}>{r}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Source Email */}
            {(selectedProgram.source_email_subject || selectedProgram.source_email_date) && (
              <>
                <div style={S.sectionTitle}>Source</div>
                <div style={S.card}>
                  {selectedProgram.source_email_subject && <DetailRow label="Email Subject" value={selectedProgram.source_email_subject} />}
                  {selectedProgram.source_email_date && <DetailRow label="Date" value={new Date(selectedProgram.source_email_date).toLocaleDateString()} />}
                </div>
              </>
            )}

            {/* Lender Contact */}
            {selectedProgram._lender && (
              <>
                <div style={S.sectionTitle}>Lender Contact</div>
                <div style={S.card}>
                  <DetailRow label="Lender" value={selectedProgram._lender.name || "—"} />
                  {selectedProgram._lender.ae_name && <DetailRow label="AE" value={selectedProgram._lender.ae_name} />}
                  {selectedProgram._lender.email && <DetailRow label="Email" value={selectedProgram._lender.email} />}
                  {selectedProgram._lender.phone && <DetailRow label="Phone" value={selectedProgram._lender.phone} />}
                  {selectedProgram._lender.website && <DetailRow label="Website" value={selectedProgram._lender.website} />}
                </div>
              </>
            )}

            {/* Match Reasons */}
            {selectedProgram._reasons && selectedProgram._reasons.length > 0 && (
              <>
                <div style={S.sectionTitle}>Match Analysis</div>
                <div style={S.card}>
                  {selectedProgram._reasons.map((r, i) => (
                    <div key={i} style={{ fontSize:9, color:TXT, marginBottom:3, display:"flex", alignItems:"center", gap:4 }}>
                      <span style={{ width:4, height:4, borderRadius:2, background:GOLD, flexShrink:0 }} />
                      {r}
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Action Buttons */}
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button style={{ ...S.btnGold, flex:1, opacity:.6 }} disabled>Lock Rate</button>
              <button style={{ ...S.btnOutline, flex:1, opacity:.6 }} disabled>Generate Pre-Approval</button>
            </div>
            <div style={{ fontSize:7, color:TXT_DIM, textAlign:"center", marginTop:4 }}>Rate lock and pre-approval generation coming soon</div>
          </div>
        </div>
      )}

      {/* ─── COMPARISON MODAL ───────────────────────────────────────────────── */}
      {showCompare && comparePrograms.length > 0 && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowCompare(false); }}>
          <div style={{ ...S.drawer, width: Math.min(280 * comparePrograms.length + 180, 900), maxWidth:"95vw" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:14 }}>
              <div style={{ fontSize:12, fontWeight:700, color:TXT_BRIGHT }}>Program Comparison</div>
              <button style={{ ...S.btnSmall, fontSize:12, padding:"4px 8px" }} onClick={() => setShowCompare(false)}>&times;</button>
            </div>

            <div style={{ overflowX:"auto" }}>
              <table style={{ ...S.table, minWidth:comparePrograms.length * 200 + 140 }}>
                <thead>
                  <tr>
                    <th style={{ ...S.th, minWidth:120, position:"sticky", left:0, background:CARD_BG, zIndex:1 }}>Field</th>
                    {comparePrograms.map(p => (
                      <th key={p.id} style={{ ...S.th, minWidth:180, textAlign:"center" }}>
                        <div style={{ fontSize:10, color:TXT_BRIGHT, fontWeight:700 }}>{p.name}</div>
                        <div style={{ fontSize:8, color:GOLD, fontWeight:400 }}>{p._lender?.name}</div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    { label:"Match Score", fn: p => `${p._score}%` },
                    { label:"Rate Range", fn: p => fmtRate(p.rate_min, p.rate_max) },
                    { label:"Category", fn: p => p.category || p.program_type || "—" },
                    { label:"Min FICO", fn: p => p.min_fico || "N/A" },
                    { label:"Max LTV", fn: p => p.max_ltv ? `${p.max_ltv}%` : "N/A" },
                    { label:"Loan Range", fn: p => `${fmt$(p.min_loan)} - ${fmt$(p.max_loan)}` },
                    { label:"Min Down %", fn: p => p.min_down_pct ? `${p.min_down_pct}%` : "N/A" },
                    { label:"Property Types", fn: p => (p.property_types||[]).join(", ") || "—" },
                    { label:"Occupancy", fn: p => (p.occupancy_types||[]).join(", ") || "—" },
                    { label:"Doc Types", fn: p => (p.doc_types||[]).join(", ") || "—" },
                    { label:"Loan Purposes", fn: p => (p.loan_purposes||[]).join(", ") || "—" },
                    { label:"Highlights", fn: p => (p.highlights||[]).length + " items" },
                    { label:"Restrictions", fn: p => (p.restrictions||[]).length + " items" },
                    { label:"States", fn: p => (p.eligible_states||[]).length > 45 ? "All states" : (p.eligible_states||[]).length + " states" },
                    { label:"AE Contact", fn: p => p._lender?.ae_name || "—" },
                  ].map((row, i) => (
                    <tr key={i}>
                      <td style={{ ...S.td, fontWeight:600, color:TXT_DIM, position:"sticky", left:0, background:CARD_BG, zIndex:1 }}>{row.label}</td>
                      {comparePrograms.map(p => (
                        <td key={p.id} style={{ ...S.td, textAlign:"center" }}>{row.fn(p)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop:12, display:"flex", gap:8 }}>
              <button style={{ ...S.btnOutline, flex:1 }} onClick={() => { setCompareIds([]); setShowCompare(false); }}>Clear Selection</button>
              <button style={{ ...S.btnSmall, flex:1 }} onClick={() => setShowCompare(false)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── AI CHAT PANEL ──────────────────────────────────────────────────── */}
      {showChat && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowChat(false); }}>
          <div style={S.chatPanel}>
            {/* Chat Header */}
            <div style={{ padding:"12px 14px", borderBottom:`1px solid ${CARD_BORDER}`, display:"flex", justifyContent:"space-between", alignItems:"center", flexShrink:0 }}>
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:TXT_BRIGHT }}>AI Loan Advisor</div>
                <div style={{ fontSize:8, color:TXT_DIM }}>Ask about scenarios, programs, and rates</div>
              </div>
              <button style={{ ...S.btnSmall, fontSize:12, padding:"4px 8px" }} onClick={() => setShowChat(false)}>&times;</button>
            </div>

            {/* Chat Messages */}
            <div style={{ flex:1, overflowY:"auto", padding:"12px 14px" }}>
              {chatMessages.length === 0 && (
                <div style={{ textAlign:"center", padding:"30px 0", opacity:.5 }}>
                  <div style={{ fontSize:24, marginBottom:8 }}>&#x1F4AC;</div>
                  <div style={{ fontSize:10, color:TXT_DIM, lineHeight:1.5, maxWidth:260, margin:"0 auto" }}>
                    Ask me anything about loan scenarios. Try:
                    <br /><br />
                    "Best option for 680 FICO self-employed borrower?"
                    <br /><br />
                    "What if my client has 600 FICO with 20% down?"
                  </div>
                </div>
              )}
              {chatMessages.map((msg, i) => (
                <div key={i} style={{ display:"flex", justifyContent:msg.role==="user"?"flex-end":"flex-start", marginBottom:8 }}>
                  <div style={{
                    ...S.chatMsg,
                    background: msg.role==="user" ? `${GOLD}22` : CARD_BG,
                    color: msg.role==="user" ? GOLD : TXT,
                    borderBottomRightRadius: msg.role==="user" ? 0 : 6,
                    borderBottomLeftRadius: msg.role==="assistant" ? 0 : 6,
                    border: msg.role==="assistant" ? `1px solid ${CARD_BORDER}` : "none"
                  }}>
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatLoading && (
                <div style={{ display:"flex", justifyContent:"flex-start", marginBottom:8 }}>
                  <div style={{ ...S.chatMsg, background:CARD_BG, color:TXT_DIM, border:`1px solid ${CARD_BORDER}` }}>
                    Thinking...
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Input */}
            <div style={{ padding:"10px 14px", borderTop:`1px solid ${CARD_BORDER}`, display:"flex", gap:6, flexShrink:0 }}>
              <input
                style={{ ...S.input, flex:1 }}
                placeholder="Ask about a loan scenario..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              />
              <button style={{ ...S.btnGold, width:60, padding:"6px 0" }} onClick={sendChat} disabled={chatLoading}>
                Send
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SAVE SCENARIO MODAL ────────────────────────────────────────────── */}
      {showSaveModal && (
        <div style={S.overlay} onClick={(e) => { if (e.target === e.currentTarget) setShowSaveModal(false); }}>
          <div style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", background:CARD_BG, border:`1px solid ${CARD_BORDER}`, borderRadius:8, padding:"20px 24px", width:340, maxWidth:"90vw" }}>
            <div style={{ fontSize:12, fontWeight:700, color:TXT_BRIGHT, marginBottom:12 }}>Save Scenario</div>
            <Field label="Scenario Name">
              <input
                style={S.input}
                placeholder="e.g., John Smith Purchase"
                value={saveScenarioName}
                onChange={e => setSaveScenarioName(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") saveCurrentScenario(); }}
                autoFocus
              />
            </Field>
            <div style={{ fontSize:8, color:TXT_DIM, margin:"8px 0" }}>
              Saves: FICO {scenario.fico}, {scenario.loanType}, {scenario.occupancy}, {fmt$(scenario.loanAmount)}
            </div>
            <div style={{ display:"flex", gap:8, marginTop:12 }}>
              <button style={{ ...S.btnGold, flex:1 }} onClick={saveCurrentScenario}>Save</button>
              <button style={{ ...S.btnOutline, flex:1 }} onClick={() => setShowSaveModal(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── DETAIL ROW SUB-COMPONENT ─────────────────────────────────────────────────
function DetailRow({ label, value, valueColor }) {
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
      <span style={{ fontSize:8, color:TXT_DIM, textTransform:"uppercase", letterSpacing:".06em" }}>{label}</span>
      <span style={{ fontSize:9, color:valueColor||TXT_BRIGHT, fontWeight:600 }}>{value}</span>
    </div>
  );
}
