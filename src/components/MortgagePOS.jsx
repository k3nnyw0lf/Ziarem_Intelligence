import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import LoanPricingView from "./LoanPricing.jsx";

/*
── SQL: vault_loans table ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_loans (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  user_id uuid,
  stage text DEFAULT 'Lead',
  -- Borrower
  first_name text, middle_name text, last_name text, suffix text,
  ssn_masked text, dob date, phone text, email text,
  address text, city text, state text, zip text,
  years_at_address numeric, housing_type text, -- Own/Rent
  prev_address text, prev_city text, prev_state text, prev_zip text,
  marital_status text, dependents int DEFAULT 0,
  -- Employment
  employer_name text, employer_address text, employer_phone text,
  position_title text, employment_start date,
  monthly_base numeric DEFAULT 0, monthly_overtime numeric DEFAULT 0,
  monthly_bonus numeric DEFAULT 0, monthly_commission numeric DEFAULT 0,
  self_employment_income numeric DEFAULT 0,
  other_income jsonb DEFAULT '[]',
  prev_employer text, prev_position text, prev_start date, prev_end date,
  -- Assets
  bank_accounts jsonb DEFAULT '[]',
  investment_accounts jsonb DEFAULT '[]',
  real_estate_owned jsonb DEFAULT '[]',
  -- Property & Loan
  property_address text, property_city text, property_state text, property_zip text,
  purchase_price numeric, estimated_value numeric,
  loan_amount numeric, down_payment numeric,
  loan_purpose text, property_type text, occupancy text,
  loan_program text, lender text, rate numeric, apr numeric,
  ltv numeric, fico int,
  -- Declarations
  declarations jsonb DEFAULT '{}',
  -- Docs
  documents jsonb DEFAULT '[]',
  doc_completion_pct int DEFAULT 0,
  -- Meta
  notes text,
  loan_officer text,
  stage_entered_at timestamptz DEFAULT now(),
  funded_at timestamptz,
  denied_at timestamptz,
  commission numeric DEFAULT 0
);

── SQL: vault_loan_documents table ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vault_loan_documents (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  loan_id uuid REFERENCES vault_loans(id),
  category text,
  doc_name text,
  status text DEFAULT 'Missing',
  file_url text,
  notes text,
  received_at timestamptz,
  created_at timestamptz DEFAULT now()
);
*/

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

async function sbInsert(table, body) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}`, { method:"POST", headers:SBH, body:JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); console.error("sbInsert err", t); return null; }
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  } catch(e) { console.error("sbInsert",e); return null; }
}

async function sbUpdate(table, id, body) {
  try {
    const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method:"PATCH", headers:SBH, body:JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); console.error("sbUpdate err",t); return null; }
    const d = await r.json();
    return Array.isArray(d) ? d[0] : d;
  } catch(e) { console.error("sbUpdate",e); return null; }
}

async function sbDelete(table, id) {
  try {
    await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, { method:"DELETE", headers:SBH });
    return true;
  } catch(e) { console.error("sbDelete",e); return false; }
}

// ─── STYLE CONSTANTS ──────────────────────────────────────────────────────────
const GOLD = "#d4af37";
const GOLD_HOVER = "#e5c348";
const BG = "#0a0a12";
const CARD = "#12121e";
const BORDER = "rgba(212,175,55,0.08)";
const BORDER_HOVER = "rgba(212,175,55,0.2)";
const INPUT_BG = "#0a0a12";
const INPUT_BD = "rgba(255,255,255,0.08)";
const TXT = "#f0ece4";
const DIM = "#8a8578";
const BRIGHT = "#ffffff";
const GREEN = "#10b981";
const SUCCESS = "#10b981";
const RED = "#ef4444";
const DANGER = "#ef4444";
const BLUE = "#3b82f6";
const INFO = "#3b82f6";
const YELLOW = "#f59e0b";
const WARNING = "#f59e0b";
const ORANGE = "#f97316";
const PURPLE = "#8b5cf6";
const CARD_HOVER = "#1a1a2e";

const STAGES = ["Lead","Pre-Qual","Application","Processing","Underwriting","Clear to Close","Closing","Funded","Denied"];

const DOC_CHECKLIST = {
  "Income": ["W-2s (2 Years)","Pay Stubs (30 Days)","Tax Returns (2 Years)","1099s","P&L Statement (Self-Employed)"],
  "Assets": ["Bank Statements (2 Months)","Investment Statements","Gift Letter","Earnest Money Receipt"],
  "Property": ["Purchase Contract","Appraisal","Title Commitment","Homeowners Insurance","HOA Documents"],
  "Identity": ["Driver's License","Social Security Card","Green Card / Visa"],
  "Credit": ["Credit Report","LOE for Inquiries","Bankruptcy Discharge Papers"],
  "Other": ["Divorce Decree","Child Support Order"],
};

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","DC","FL","GA","HI","ID","IL","IN",
  "IA","KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH",
  "NJ","NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT",
  "VT","VA","WA","WV","WI","WY"
];

const PROPERTY_TYPES = ["Single Family","Condo","Townhouse","2-Unit","3-Unit","4-Unit","Co-op","Manufactured"];
const OCCUPANCY_TYPES = ["Primary Residence","Second Home","Investment Property"];
const LOAN_PURPOSES = ["Purchase","Refinance - Rate/Term","Refinance - Cash Out","HELOC","Construction"];
const HOUSING_TYPES = ["Own","Rent","Living Rent Free"];
const MARITAL_STATUSES = ["Single","Married","Separated","Divorced","Widowed"];

// ─── STYLE HELPERS ────────────────────────────────────────────────────────────
const inputS = { background:INPUT_BG, border:`1px solid ${INPUT_BD}`, color:TXT, padding:"10px 14px", fontSize:12, borderRadius:8, outline:"none", width:"100%", boxSizing:"border-box", letterSpacing:".02em", transition:"all 0.15s ease", lineHeight:1.5 };
const selectS = { ...inputS, appearance:"none", cursor:"pointer" };
const labelS = { fontSize:11, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:6, display:"block", fontWeight:600 };
const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:20, boxShadow:"0 4px 24px rgba(0,0,0,0.3)", transition:"all 0.2s ease" };
const btnS = { background:GOLD, color:"#0a0a12", border:"none", borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:".03em", transition:"all 0.2s ease" };
const btnOutS = { ...btnS, background:"transparent", border:`1px solid rgba(212,175,55,0.3)`, color:GOLD };
const btnSmS = { ...btnS, padding:"6px 14px", fontSize:11 };
const badgeS = (bg) => ({ background:bg+"22", color:bg, padding:"3px 10px", borderRadius:20, fontSize:10, fontWeight:600, letterSpacing:".04em" });

// ─── EDGE FUNCTION HELPER ────────────────────────────────────────────────────
const EDGE_URL = SB_URL + "/functions/v1";
const EDGE_HEADERS = { "Content-Type":"application/json", apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}` };
async function edgeFn(path, body, method="POST") {
  try {
    const opts = { method, headers:EDGE_HEADERS };
    if (body && method!=="GET") opts.body = JSON.stringify(body);
    const r = await fetch(`${EDGE_URL}/${path}`, opts);
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { raw: t, ok: r.ok }; }
  } catch(e) { console.error("edgeFn", e); return { error: e.message }; }
}

function fmtMoney(n) { if (!n && n!==0) return "$0"; return "$"+Number(n).toLocaleString("en-US",{maximumFractionDigits:0}); }
function fmtPct(n) { return n!=null ? Number(n).toFixed(1)+"%" : "—"; }
function daysBetween(d1,d2) { if(!d1) return 0; const a=new Date(d1),b=d2?new Date(d2):new Date(); return Math.max(0,Math.floor((b-a)/(86400000))); }
function timeAgo(d) { if(!d) return "—"; const days=daysBetween(d); if(days===0) return "Today"; if(days===1) return "Yesterday"; if(days<7) return days+"d ago"; if(days<30) return Math.floor(days/7)+"w ago"; return Math.floor(days/30)+"mo ago"; }
function getPriority(loan) { const days=daysBetween(loan.stage_entered_at||loan.created_at); const amt=Number(loan.loan_amount)||0; if(days<=2&&amt>=500000) return "hot"; if(days<=5) return "warm"; return "cold"; }
function getPriorityIcon(p) { if(p==="hot") return "\uD83D\uDD25"; if(p==="warm") return "\uD83D\uDD36"; return "\u2744\uFE0F"; }
function getPriorityColor(p) { if(p==="hot") return "#ef4444"; if(p==="warm") return "#f97316"; return "#6b7280"; }
function exportLoansCSV(loans) {
  const headers=["Name","Email","Phone","Amount","Stage","Service","Business","Lender","Program","LO","Created"];
  const rows=loans.map(l=>[`${l.first_name||""} ${l.last_name||""}`.trim(),l.email||"",l.phone||"",l.loan_amount||0,l.stage||"",l.service_type||"",l.business||"",l.lender||"",l.loan_program||"",l.loan_officer||"",l.created_at?new Date(l.created_at).toLocaleDateString():""]);
  const csv=[headers.join(","),...rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(","))].join("\n");
  const blob=new Blob([csv],{type:"text/csv"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download=`vault_deals_${new Date().toISOString().slice(0,10)}.csv`;a.click();URL.revokeObjectURL(url);
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
// ─── MULTI-BUSINESS CONFIG ──────────────────────────────────────────────────
const BUSINESSES = [
  { id:"all", label:"ALL DEALS", icon:"⬡", color:GOLD },
  { id:"DOS Mortgage", label:"DOS MORTGAGE", icon:"🏦", color:"#3b82f6",
    services:["Conventional","FHA","VA","USDA","Jumbo","Non-QM","DSCR","Commercial","Reverse","HELOC","Construction","Bridge","Hard Money","Personal Loan"],
    stages:["Lead","Pre-Qual","Application","Processing","Underwriting","Conditional","Clear to Close","Closing","Funded","Denied","Withdrawn"] },
  { id:"Wolf Surety", label:"WOLF INSURANCE", icon:"🐺", color:"#10b981",
    services:["Surety Bond","Commercial Insurance","Homeowners","Auto","Life","Umbrella","Workers Comp","General Liability","E&O","D&O"],
    stages:["Lead","Quote Requested","Quoting","Quote Sent","Binding","Bound","Active","Renewal","Expired","Cancelled"] },
  { id:"Re4lty", label:"RE4LTY", icon:"🏠", color:"#8b5cf6",
    services:["Buyer Rep","Seller Rep","Listing","Rental","Commercial RE","Land","Investment Property"],
    stages:["Lead","Consultation","Active Search","Offer Submitted","Under Contract","Inspection","Appraisal","Closing","Closed","Lost"] },
  { id:"Credit Repair", label:"CREDIT REPAIR", icon:"⚡", color:"#f59e0b",
    services:["Full Credit Repair","Rapid Rescore","Dispute Only","Credit Monitoring","Identity Theft"],
    stages:["Enrolled","Analysis","Round 1","Round 2","Round 3","Maintenance","Graduated","Cancelled"] },
  { id:"Laenan", label:"LAENAN GROUP", icon:"🏢", color:"#ec4899",
    services:["Business Consulting","Tax Planning","Entity Formation","Accounting","Payroll"],
    stages:["Lead","Discovery","Proposal","Active","Completed","On Hold"] },
  { id:"Title", label:"Closed By Whom", icon:"📜", color:"#8b5cf6",
    stages:["New Order","Title Search","Exam/Review","Commitment Issued","Clearing Exceptions","Pre-Closing","Closing Scheduled","Closing Complete","Post-Closing","Recorded"],
    services:["Residential Purchase","Residential Refi","Commercial","Short Sale","REO/Foreclosure","Cash Deal","HELOC","Construction","1031 Exchange"],
    settings:{ defaultStage:"New Order" } },
];

const DEFAULT_STAGES = ["Lead","Contacted","Proposal","In Progress","Review","Closing","Completed","Lost"];

export default function MortgagePOSView({ user, contacts, showToast, initialTab }) {
  const [tab, setTab] = useState(initialTab || 0);
  const [loans, setLoans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedLoan, setSelectedLoan] = useState(null);
  const [appForm, setAppForm] = useState(null);
  const [loanDocs, setLoanDocs] = useState([]);
  const [activeBiz, setActiveBiz] = useState("all");

  const loadLoans = useCallback(async () => {
    setLoading(true);
    const q = activeBiz === "all" ? "" : `&business=eq.${encodeURIComponent(activeBiz)}`;
    const data = await sbFetch("vault_loans",`?order=created_at.desc&limit=500${q}`);
    setLoans(data||[]);
    setLoading(false);
  },[activeBiz]);

  useEffect(() => { loadLoans(); }, [loadLoans]);

  const loadDocs = useCallback(async (loanId) => {
    if (!loanId) return;
    const d = await sbFetch("vault_loan_documents",`?loan_id=eq.${loanId}&order=category.asc,doc_name.asc`);
    setLoanDocs(d||[]);
  },[]);

  const activeBizConfig = BUSINESSES.find(b=>b.id===activeBiz) || BUSINESSES[0];
  const activeStages = activeBizConfig.stages || DEFAULT_STAGES;
  const activeServices = activeBizConfig.services || [];

  const openNewApp = (prefill) => { setAppForm({...(prefill||{}), business: activeBiz==="all"?"DOS Mortgage":activeBiz }); setTab(2); };
  const openLoanDetail = (loan) => { setSelectedLoan(loan); setTab(2); setAppForm(loan); };

  const bizStats = useMemo(()=>{
    const stats = {};
    BUSINESSES.forEach(b=>{ stats[b.id] = loans.filter(l=> b.id==="all" || l.business===b.id).length; });
    return stats;
  },[loans]);

  const [showNotifications, setShowNotifications] = useState(false);

  // Notifications: stale deals, missing docs, approaching deadlines
  const notifications = useMemo(() => {
    const items = [];
    loans.forEach(l => {
      const days = daysBetween(l.stage_entered_at || l.created_at);
      if (days > 7 && !["Funded","Denied","Withdrawn","Cancelled","Closed","Graduated","Completed","Expired"].includes(l.stage)) {
        items.push({ type:"stale", icon:"\u23F0", color:ORANGE, msg:`${l.first_name||""} ${l.last_name||""} stale ${days}d in ${l.stage}`, loanId:l.id });
      }
      if ((l.doc_completion_pct||0) < 50 && ["Processing","Underwriting","Conditional"].includes(l.stage)) {
        items.push({ type:"docs", icon:"\uD83D\uDCC4", color:RED, msg:`${l.first_name||""} ${l.last_name||""} missing docs (${l.doc_completion_pct||0}%)`, loanId:l.id });
      }
    });
    return items;
  }, [loans]);

  const TABS = [
    { icon:"\uD83D\uDD0D", label:"Pricing Engine" },
    { icon:"\uD83D\uDCCB", label:"Pipeline" },
    { icon:"\uD83D\uDCC4", label:"New Deal" },
    { icon:"\uD83D\uDCC1", label:"Documents" },
    { icon:"\uD83D\uDCCA", label:"Analytics" },
    { icon:"\uD83C\uDFE0", label:"Real Estate" },
    { icon:"\uD83D\uDEE1", label:"Insurance" },
    { icon:"\u26A1", label:"Credit Optimization" },
    { icon:"\uD83D\uDCDC", label:"Title" },
  ];

  return (
    <div style={{ background:BG, minHeight:"100vh", color:TXT, fontFamily:"'Inter','Segoe UI',system-ui,sans-serif" }}>
      {/* ── BUSINESS SELECTOR BAR ────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:8, background:"rgba(10,10,18,0.95)", padding:"12px 24px", borderBottom:`1px solid ${BORDER}`, overflowX:"auto", backdropFilter:"blur(12px)" }}>
        {BUSINESSES.map(b=>(
          <div key={b.id} onClick={()=>{ setActiveBiz(b.id); }} style={{
            padding:"8px 18px", cursor:"pointer", fontSize:12, fontWeight:activeBiz===b.id?700:500,
            color:activeBiz===b.id?BRIGHT:DIM, background:activeBiz===b.id?b.color+"18":"transparent",
            border:`1px solid ${activeBiz===b.id?b.color+"55":BORDER}`, borderRadius:24,
            display:"flex", alignItems:"center", gap:8, whiteSpace:"nowrap", transition:"all .2s",
            userSelect:"none", letterSpacing:".03em"
          }}>
            <span style={{ fontSize:14 }}>{b.icon}</span>
            <span>{b.label}</span>
            {bizStats[b.id]>0 && <span style={{ background:b.color+"22", color:b.color, fontSize:11, padding:"2px 8px", borderRadius:12, fontWeight:700 }}>{bizStats[b.id]}</span>}
          </div>
        ))}
      </div>
      {/* ── TAB NAV ─────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${BORDER}`, background:CARD, padding:"0 24px", position:"sticky", top:0, zIndex:50, alignItems:"center", boxShadow:"0 2px 12px rgba(0,0,0,0.2)" }}>
        <div style={{ display:"flex", flex:1, gap:24 }}>
          {TABS.map((t,i)=>(
            <div key={i} onClick={()=>setTab(i)} style={{
              padding:"14px 4px", cursor:"pointer", fontSize:11, fontWeight:tab===i?600:500,
              color:tab===i?(activeBizConfig.color||GOLD):DIM, borderBottom:tab===i?`2px solid ${activeBizConfig.color||GOLD}`:"2px solid transparent",
              letterSpacing:".08em", transition:"all .2s", display:"flex", alignItems:"center", gap:8,
              userSelect:"none", textTransform:"uppercase"
            }}>
              <span style={{ fontSize:14 }}>{t.icon}</span>
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        {/* Notification Bell */}
        <div style={{ position:"relative" }}>
          <div onClick={()=>setShowNotifications(!showNotifications)} style={{
            cursor:"pointer", fontSize:18, padding:"8px 12px", borderRadius:8, transition:"all .2s",
            background:showNotifications?GOLD+"18":"transparent", position:"relative"
          }}>
            {"\uD83D\uDD14"}
            {notifications.length>0 && (
              <span style={{ position:"absolute", top:4, right:6, background:RED, color:"#fff", fontSize:9, fontWeight:700,
                width:18, height:18, borderRadius:9, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {notifications.length > 9 ? "9+" : notifications.length}
              </span>
            )}
          </div>
          {showNotifications && (
            <div style={{ position:"absolute", right:0, top:"100%", marginTop:8, width:360, maxHeight:400, overflowY:"auto",
              background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, padding:12, zIndex:100,
              boxShadow:"0 16px 48px rgba(0,0,0,.6)", backdropFilter:"blur(8px)" }}>
              <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:12, padding:"6px 8px 10px", borderBottom:`1px solid ${BORDER}` }}>
                Notifications ({notifications.length})
              </div>
              {notifications.length===0 && <div style={{ fontSize:12, color:DIM, padding:20, textAlign:"center" }}>All caught up!</div>}
              {notifications.map((n,i)=>(
                <div key={i} onClick={()=>{const loan=loans.find(l=>l.id===n.loanId);if(loan){openLoanDetail(loan);setShowNotifications(false);}}}
                  style={{ display:"flex", gap:10, alignItems:"center", padding:"10px 8px", borderBottom:`1px solid ${BORDER}`, cursor:"pointer",
                    borderRadius:8, transition:"background .15s" }}
                  onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{ fontSize:14 }}>{n.icon}</span>
                  <span style={{ fontSize:12, color:n.color, flex:1, lineHeight:1.4 }}>{n.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ padding:24 }}>
        {tab===0 && <LoanPricingView user={user} contacts={contacts} showToast={showToast} />}
        {tab===1 && <PipelineTab loans={loans} allLoans={loans} loading={loading} reload={loadLoans} openNewApp={openNewApp} openLoanDetail={openLoanDetail} showToast={showToast} activeBiz={activeBiz} activeBizConfig={activeBizConfig} activeStages={activeStages} activeServices={activeServices} />}
        {tab===2 && <ApplicationTab prefill={appForm} user={user} showToast={showToast} reload={loadLoans} setTab={setTab} selectedLoan={selectedLoan} setSelectedLoan={setSelectedLoan} />}
        {tab===3 && <DocumentCenterTab loans={loans} loanDocs={loanDocs} loadDocs={loadDocs} showToast={showToast} />}
        {tab===5 && <RealtyTab loans={loans} contacts={contacts} showToast={showToast} />}
        {tab===6 && <InsuranceTab loans={loans} showToast={showToast} />}
        {tab===7 && <CreditRepairTab loans={loans} contacts={contacts} showToast={showToast} />}
        {tab===7 && <AnalyticsTab loans={loans} />}
        {tab===8 && <TitleTab showToast={showToast} />}
      </div>

      {/* ── QUICK ACTIONS FLOATING BAR ────────────────────────────────── */}
      <div style={{ position:"fixed", bottom:24, right:24, display:"flex", gap:10, zIndex:80 }}>
        <button onClick={()=>openNewApp(null)} style={{ ...btnS, borderRadius:28, padding:"12px 24px", fontSize:12, boxShadow:"0 8px 32px rgba(212,175,55,.35)", display:"flex", alignItems:"center", gap:8, transition:"transform .2s, box-shadow .2s" }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 12px 40px rgba(212,175,55,.5)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 8px 32px rgba(212,175,55,.35)";}}>
          + New Deal
        </button>
        <button onClick={()=>setTab(0)} style={{ ...btnOutS, borderRadius:28, padding:"12px 20px", fontSize:12, boxShadow:"0 8px 24px rgba(0,0,0,.4)", background:CARD, display:"flex", alignItems:"center", gap:8 }}
          onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
          onMouseLeave={e=>e.currentTarget.style.background=CARD}>
          {"\u26A1"} Quick Quote
        </button>
        <button onClick={()=>exportLoansCSV(loans)} style={{ ...btnOutS, borderRadius:28, padding:"12px 20px", fontSize:12, boxShadow:"0 8px 24px rgba(0,0,0,.4)", background:CARD, display:"flex", alignItems:"center", gap:8 }}
          onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
          onMouseLeave={e=>e.currentTarget.style.background=CARD}>
          {"\uD83D\uDCE5"} Export CSV
        </button>
      </div>
    </div>
  );
}


// ─── MODAL OVERLAY ────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, width=600 }) {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", backdropFilter:"blur(8px)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
      onClick={onClose}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, width, maxWidth:"95vw", maxHeight:"85vh", overflow:"auto", padding:32, boxShadow:"0 24px 48px rgba(0,0,0,0.5)" }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div style={{ fontSize:18, fontWeight:600, color:BRIGHT }}>{title}</div>
          <div onClick={onClose} style={{ cursor:"pointer", fontSize:18, color:DIM, lineHeight:1, width:32, height:32, display:"flex", alignItems:"center", justifyContent:"center", borderRadius:8, transition:"all .15s" }}
            onMouseEnter={e=>{e.currentTarget.style.background=CARD_HOVER;e.currentTarget.style.color=BRIGHT;}}
            onMouseLeave={e=>{e.currentTarget.style.background="transparent";e.currentTarget.style.color=DIM;}}>
            ✕</div>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── CONFIRM DIALOG ───────────────────────────────────────────────────────────
function ConfirmDialog({ open, onClose, onConfirm, title, message }) {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", backdropFilter:"blur(8px)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:24 }}
      onClick={onClose}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:16, width:420, padding:32, boxShadow:"0 24px 48px rgba(0,0,0,0.5)" }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:16, fontWeight:600, color:RED, marginBottom:12 }}>{title||"Confirm"}</div>
        <div style={{ fontSize:13, color:TXT, marginBottom:24, lineHeight:1.5 }}>{message}</div>
        <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnOutS}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnS, background:RED, color:BRIGHT }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

// ─── LOAN QUICK VIEW MODAL ───────────────────────────────────────────────────
function LoanQuickView({ loan, open, onClose, onEdit, onStageChange, showToast }) {
  if (!open || !loan) return null;
  const days = daysBetween(loan.stage_entered_at||loan.created_at);
  const dayColor = days<3?GREEN:days<7?YELLOW:RED;
  const loanBiz = BUSINESSES.find(b => b.id === loan.business);
  const loanBizStages = loanBiz?.stages || STAGES;
  const totalIncome = (Number(loan.monthly_base)||0)+(Number(loan.monthly_overtime)||0)+(Number(loan.monthly_bonus)||0)+(Number(loan.monthly_commission)||0)+(Number(loan.self_employment_income)||0);

  return (
    <Modal open={open} onClose={onClose} title={`${loan.first_name||""} ${loan.last_name||""}`} width={600}>
      {/* Quick stats row */}
      <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
        <span style={badgeS(loan.stage==="Funded"?GREEN:loan.stage==="Denied"?RED:BLUE)}>{loan.stage}</span>
        <span style={badgeS(GOLD)}>{fmtMoney(loan.loan_amount)}</span>
        {loan.fico && <span style={badgeS(loan.fico>=740?GREEN:loan.fico>=680?YELLOW:RED)}>FICO {loan.fico}</span>}
        {loan.ltv && <span style={badgeS(BLUE)}>LTV {fmtPct(loan.ltv)}</span>}
        <span style={badgeS(dayColor)}>{days}d in stage</span>
      </div>

      {/* Info grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:16 }}>
        {[
          ["Property", loan.property_address||"\u2014"],
          ["Lender", loan.lender||"\u2014"],
          ["Program", loan.loan_program||"\u2014"],
          ["Purpose", loan.loan_purpose||"\u2014"],
          ["Rate", loan.rate ? loan.rate+"%" : "\u2014"],
          ["LO", loan.loan_officer||"\u2014"],
          ["Phone", loan.phone||"\u2014"],
          ["Email", loan.email||"\u2014"],
          ["Monthly Income", fmtMoney(totalIncome)],
          ["Docs Complete", (loan.doc_completion_pct||0)+"%"],
          ["Created", loan.created_at ? new Date(loan.created_at).toLocaleDateString() : "\u2014"],
          ["Purchase Price", fmtMoney(loan.purchase_price)],
        ].map(([k,v],i) => (
          <div key={i} style={{ fontSize:12, lineHeight:1.5 }}>
            <span style={{ color:DIM }}>{k}: </span>
            <span style={{ color:BRIGHT, fontWeight:500 }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Stage quick-change */}
      <div style={{ marginBottom:16 }}>
        <label style={labelS}>Move to Stage</label>
        <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginTop:6 }}>
          {(loanBizStages || STAGES).map(s => (
            <button key={s} onClick={()=>onStageChange(loan.id,s)}
              style={{ ...btnSmS, fontSize:10, background:loan.stage===s?GOLD+"22":"transparent", border:`1px solid ${loan.stage===s?GOLD:BORDER}`, color:loan.stage===s?GOLD:DIM, padding:"6px 12px", borderRadius:20 }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Activity Timeline */}
      <div style={{ marginBottom:12 }}>
        <label style={labelS}>Activity Timeline</label>
        <div style={{ marginTop:6, paddingLeft:12, borderLeft:`2px solid ${BORDER}` }}>
          {loan.funded_at && (
            <div style={{ position:"relative", paddingBottom:10, paddingLeft:14 }}>
              <div style={{ position:"absolute", left:-7, top:2, width:10, height:10, borderRadius:5, background:GREEN, border:`2px solid ${BG}` }} />
              <div style={{ fontSize:9, color:GREEN, fontWeight:600 }}>Funded</div>
              <div style={{ fontSize:8, color:DIM }}>{new Date(loan.funded_at).toLocaleDateString()} {new Date(loan.funded_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          )}
          {loan.stage_entered_at && (
            <div style={{ position:"relative", paddingBottom:10, paddingLeft:14 }}>
              <div style={{ position:"absolute", left:-7, top:2, width:10, height:10, borderRadius:5, background:BLUE, border:`2px solid ${BG}` }} />
              <div style={{ fontSize:9, color:BLUE, fontWeight:600 }}>Moved to {loan.stage}</div>
              <div style={{ fontSize:8, color:DIM }}>{new Date(loan.stage_entered_at).toLocaleDateString()} {new Date(loan.stage_entered_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          )}
          {loan.updated_at && loan.updated_at !== loan.stage_entered_at && (
            <div style={{ position:"relative", paddingBottom:10, paddingLeft:14 }}>
              <div style={{ position:"absolute", left:-7, top:2, width:10, height:10, borderRadius:5, background:GOLD, border:`2px solid ${BG}` }} />
              <div style={{ fontSize:9, color:GOLD, fontWeight:600 }}>Last Updated</div>
              <div style={{ fontSize:8, color:DIM }}>{new Date(loan.updated_at).toLocaleDateString()} {new Date(loan.updated_at).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</div>
            </div>
          )}
          {loan.documents && Array.isArray(loan.documents) && loan.documents.length > 0 && (
            <div style={{ position:"relative", paddingBottom:10, paddingLeft:14 }}>
              <div style={{ position:"absolute", left:-7, top:2, width:10, height:10, borderRadius:5, background:PURPLE, border:`2px solid ${BG}` }} />
              <div style={{ fontSize:9, color:PURPLE, fontWeight:600 }}>{loan.documents.length} Document(s) uploaded</div>
            </div>
          )}
          <div style={{ position:"relative", paddingBottom:4, paddingLeft:14 }}>
            <div style={{ position:"absolute", left:-7, top:2, width:10, height:10, borderRadius:5, background:DIM, border:`2px solid ${BG}` }} />
            <div style={{ fontSize:9, color:DIM, fontWeight:600 }}>Deal Created</div>
            <div style={{ fontSize:8, color:DIM }}>{loan.created_at ? new Date(loan.created_at).toLocaleDateString() : "\u2014"}</div>
          </div>
        </div>
      </div>

      {/* Notes */}
      {loan.notes && (
        <div style={{ marginBottom:12 }}>
          <label style={labelS}>Notes</label>
          <div style={{ fontSize:9, color:TXT, background:INPUT_BG, padding:8, borderRadius:4, border:`1px solid ${INPUT_BD}` }}>{loan.notes}</div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
        <button onClick={()=>onEdit(loan)} style={btnS}>Edit Full Application</button>
        <button onClick={onClose} style={btnOutS}>Close</button>
      </div>
    </Modal>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 2: PIPELINE
// ═══════════════════════════════════════════════════════════════════════════════
function PipelineTab({ loans, allLoans, loading, reload, openNewApp, openLoanDetail, showToast, activeBiz, activeBizConfig, activeStages, activeServices }) {
  const [viewMode, setViewMode] = useState("kanban"); // kanban | table
  const [dragLoan, setDragLoan] = useState(null);
  const [dragOverStage, setDragOverStage] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [quickViewLoan, setQuickViewLoan] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [stageFilter, setStageFilter] = useState("All");
  const [serviceFilter, setServiceFilter] = useState("All");
  const [loFilter, setLoFilter] = useState("All");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");

  // ─── Edge Function States ──────────────────────────────────────────────────
  const [inviteModal, setInviteModal] = useState(null);
  const [inviteForm, setInviteForm] = useState({ client_name:"", email:"", phone:"", language:"en" });
  const [inviteResult, setInviteResult] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [rateAlertModal, setRateAlertModal] = useState(null);
  const [rateThreshold, setRateThreshold] = useState("");
  const [rateAlertLoading, setRateAlertLoading] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(null);
  const [referralModal, setReferralModal] = useState(false);
  const [referralForm, setReferralForm] = useState({ referrer_name:"", referrer_email:"", referrer_company:"", referrer_type:"realtor", referred_name:"", referred_email:"", referred_phone:"", deal_type:"mortgage" });
  const [referralLoading, setReferralLoading] = useState(false);

  const handleInviteClient = async () => {
    if (!inviteModal || !inviteForm.email) return;
    setInviteLoading(true);
    const res = await sbInsert("vault_client_invites", { loan_id:inviteModal.id, client_name:inviteForm.client_name||`${inviteModal.first_name||""} ${inviteModal.last_name||""}`.trim(), email:inviteForm.email, phone:inviteForm.phone, language:inviteForm.language, token:crypto.randomUUID() });
    setInviteLoading(false);
    if (res && res.token) {
      setInviteResult(`${EDGE_URL}/client-portal?token=${res.token}`);
      if (showToast) showToast("Client invite created","success");
    } else if (res && res.id) {
      const token = res.id;
      setInviteResult(`${EDGE_URL}/client-portal?token=${token}`);
      if (showToast) showToast("Client invite created","success");
    } else { if (showToast) showToast("Failed to create invite","error"); }
  };

  const handleSetRateAlert = async () => {
    if (!rateAlertModal || !rateThreshold) return;
    setRateAlertLoading(true);
    const res = await edgeFn("rate-alert/set", { loan_id:rateAlertModal.id, threshold_rate:Number(rateThreshold) });
    setRateAlertLoading(false);
    setRateAlertModal(null); setRateThreshold("");
    if (showToast) showToast(res?.error ? "Rate alert failed" : "Rate alert set","success");
  };

  const handleStartFollowUp = async (loan) => {
    setFollowUpLoading(loan.id);
    await edgeFn("follow-up-engine/create", { loan_id:loan.id, client_name:`${loan.first_name||""} ${loan.last_name||""}`.trim(), client_email:loan.email||"", client_phone:loan.phone||"", sequence_type:"new_lead" });
    setFollowUpLoading(null);
    if (showToast) showToast("Follow-up sequence started","success");
  };

  const handleLogReferral = async () => {
    setReferralLoading(true);
    await edgeFn("follow-up-engine/referral/track", referralForm);
    setReferralLoading(false);
    setReferralModal(false);
    setReferralForm({ referrer_name:"", referrer_email:"", referrer_company:"", referrer_type:"realtor", referred_name:"", referred_email:"", referred_phone:"", deal_type:"mortgage" });
    if (showToast) showToast("Referral logged","success");
  };

  const stagesForPipeline = activeStages || STAGES;

  // Get unique loan officers for filter
  const loanOfficers = useMemo(() => {
    const los = new Set();
    loans.forEach(l => { if(l.loan_officer) los.add(l.loan_officer); });
    return Array.from(los).sort();
  }, [loans]);

  const filtered = useMemo(() => {
    let list = loans;
    if (stageFilter && stageFilter!=="All") list = list.filter(l => l.stage===stageFilter);
    if (serviceFilter && serviceFilter!=="All") list = list.filter(l => l.service_type===serviceFilter);
    if (loFilter && loFilter!=="All") list = list.filter(l => l.loan_officer===loFilter);
    if (amountMin) list = list.filter(l => (l.loan_amount||0) >= Number(amountMin));
    if (amountMax) list = list.filter(l => (l.loan_amount||0) <= Number(amountMax));
    if (searchQ) {
      const q = searchQ.toLowerCase();
      list = list.filter(l =>
        (l.first_name||"").toLowerCase().includes(q) ||
        (l.last_name||"").toLowerCase().includes(q) ||
        (l.email||"").toLowerCase().includes(q) ||
        (l.phone||"").toLowerCase().includes(q) ||
        (l.property_address||"").toLowerCase().includes(q) ||
        (l.lender||"").toLowerCase().includes(q) ||
        (l.loan_program||"").toLowerCase().includes(q)
      );
    }
    return list;
  }, [loans, searchQ, stageFilter, serviceFilter, loFilter, amountMin, amountMax]);

  const byStage = useMemo(() => {
    const m = {};
    stagesForPipeline.forEach(s => m[s]=[]);
    filtered.forEach(l => { const s = l.stage||stagesForPipeline[0]; if (m[s]) m[s].push(l); else { const first = stagesForPipeline[0]; if(m[first]) m[first].push(l); } });
    return m;
  }, [filtered, stagesForPipeline]);

  // Stats - color-coded per active business
  const bizColor = activeBizConfig?.color || GOLD;
  const activeLoans = loans.filter(l => !["Funded","Denied","Withdrawn","Cancelled","Closed","Graduated","Completed","Expired"].includes(l.stage));
  const totalVolume = loans.reduce((s,l) => s+(l.loan_amount||0), 0);
  const now = new Date();
  const thisMonthRevenue = loans.filter(l => {
    if (l.stage!=="Funded"||!l.funded_at) return false;
    const d = new Date(l.funded_at);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  }).reduce((s,l)=>s+(l.commission||0),0);
  const fundedThisMonth = loans.filter(l => {
    if (l.stage!=="Funded"||!l.funded_at) return false;
    const d = new Date(l.funded_at);
    return d.getMonth()===now.getMonth() && d.getFullYear()===now.getFullYear();
  });
  const fundedLoans = loans.filter(l => l.stage==="Funded" && l.stage_entered_at);
  const avgDays = fundedLoans.length ? Math.round(fundedLoans.reduce((s,l) => s+daysBetween(l.created_at,l.funded_at||l.stage_entered_at),0)/fundedLoans.length) : 0;
  const appAndBeyond = loans.filter(l => !["Lead","Pre-Qual","Enrolled"].includes(l.stage));
  const conversionRate = appAndBeyond.length ? Math.round((fundedLoans.length/appAndBeyond.length)*100) : 0;

  const handleDrop = async (stage) => {
    if (!dragLoan || dragLoan.stage === stage) { setDragLoan(null); setDragOverStage(null); return; }
    const ts = new Date().toISOString();
    const updates = { stage, stage_entered_at:ts, updated_at:ts };
    if (stage==="Funded"||stage==="Closed") updates.funded_at = ts;
    if (stage==="Denied"||stage==="Cancelled"||stage==="Lost"||stage==="Withdrawn") updates.denied_at = ts;
    await sbUpdate("vault_loans", dragLoan.id, updates);
    setDragLoan(null);
    setDragOverStage(null);
    reload();
    if (showToast) showToast(`Moved to ${stage}`,"success");
  };

  const handleQuickStageChange = async (loanId, stage) => {
    const now = new Date().toISOString();
    const updates = { stage, stage_entered_at:now, updated_at:now };
    if (stage==="Funded") updates.funded_at = now;
    if (stage==="Denied") updates.denied_at = now;
    await sbUpdate("vault_loans", loanId, updates);
    setQuickViewLoan(null);
    reload();
    if (showToast) showToast(`Moved to ${stage}`,"success");
  };

  const handleDeleteLoan = async () => {
    if (!deleteConfirm) return;
    // Delete associated documents first
    const docs = await sbFetch("vault_loan_documents",`?loan_id=eq.${deleteConfirm.id}`);
    for (const d of docs) { await sbDelete("vault_loan_documents", d.id); }
    await sbDelete("vault_loans", deleteConfirm.id);
    setDeleteConfirm(null);
    reload();
    if (showToast) showToast("Loan deleted","success");
  };

  return (
    <div>
      {/* Quick View Modal */}
      <LoanQuickView
        loan={quickViewLoan} open={!!quickViewLoan}
        onClose={()=>setQuickViewLoan(null)}
        onEdit={(l)=>{ setQuickViewLoan(null); openLoanDetail(l); }}
        onStageChange={handleQuickStageChange}
        showToast={showToast}
      />
      {/* Delete Confirm */}
      <ConfirmDialog
        open={!!deleteConfirm} onClose={()=>setDeleteConfirm(null)} onConfirm={handleDeleteLoan}
        title="Delete Loan"
        message={`Are you sure you want to permanently delete the loan for ${deleteConfirm?.first_name||""} ${deleteConfirm?.last_name||""}? This will also remove all associated documents.`}
      />

      {/* ─── Invite Client Modal ──────────────────────────────────────── */}
      <Modal open={!!inviteModal} onClose={()=>{setInviteModal(null);setInviteResult(null);setInviteForm({client_name:"",email:"",phone:"",language:"en"});}} title="Invite Client to Portal" width={400}>
        {!inviteResult ? (<div>
          <div style={{marginBottom:8}}><label style={labelS}>Client Name</label><input style={inputS} value={inviteForm.client_name} onChange={e=>setInviteForm({...inviteForm,client_name:e.target.value})} placeholder={inviteModal?`${inviteModal.first_name||""} ${inviteModal.last_name||""}`.trim():""} /></div>
          <div style={{marginBottom:8}}><label style={labelS}>Email</label><input style={inputS} type="email" value={inviteForm.email} onChange={e=>setInviteForm({...inviteForm,email:e.target.value})} placeholder={inviteModal?.email||""} /></div>
          <div style={{marginBottom:8}}><label style={labelS}>Phone</label><input style={inputS} value={inviteForm.phone} onChange={e=>setInviteForm({...inviteForm,phone:e.target.value})} placeholder={inviteModal?.phone||""} /></div>
          <div style={{marginBottom:12}}><label style={labelS}>Language</label><select style={selectS} value={inviteForm.language} onChange={e=>setInviteForm({...inviteForm,language:e.target.value})}><option value="en">English</option><option value="es">Spanish</option></select></div>
          <button onClick={handleInviteClient} disabled={inviteLoading} style={btnS}>{inviteLoading?"Sending...":"Send Invite"}</button>
        </div>) : (<div>
          <div style={{fontSize:9,color:GREEN,marginBottom:8,fontWeight:600}}>Client portal link created!</div>
          <div style={{background:INPUT_BG,border:`1px solid ${INPUT_BD}`,borderRadius:4,padding:8,fontSize:9,color:GOLD,wordBreak:"break-all",marginBottom:10}}>{inviteResult}</div>
          <button onClick={()=>{navigator.clipboard.writeText(inviteResult);if(showToast)showToast("Link copied","success");}} style={btnS}>Copy Link</button>
        </div>)}
      </Modal>

      {/* ─── Rate Alert Modal ─────────────────────────────────────────── */}
      <Modal open={!!rateAlertModal} onClose={()=>{setRateAlertModal(null);setRateThreshold("");}} title="Set Rate Alert" width={340}>
        <div style={{marginBottom:8}}><label style={labelS}>Current Rate</label><div style={{fontSize:12,color:GOLD,fontWeight:700}}>{rateAlertModal?.rate ? rateAlertModal.rate+"%" : "N/A"}</div></div>
        <div style={{marginBottom:12}}><label style={labelS}>Alert When Rate Drops Below (%)</label><input style={inputS} type="number" step="0.125" value={rateThreshold} onChange={e=>setRateThreshold(e.target.value)} placeholder="e.g. 6.5" /></div>
        <button onClick={handleSetRateAlert} disabled={rateAlertLoading||!rateThreshold} style={btnS}>{rateAlertLoading?"Setting...":"Set Alert"}</button>
      </Modal>

      {/* ─── Log Referral Modal ───────────────────────────────────────── */}
      <Modal open={referralModal} onClose={()=>setReferralModal(false)} title="Log Referral" width={480}>
        <div style={{fontSize:9,fontWeight:600,color:GOLD,marginBottom:6}}>REFERRER</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          <div style={{flex:"1 1 45%"}}><label style={labelS}>Name</label><input style={inputS} value={referralForm.referrer_name} onChange={e=>setReferralForm({...referralForm,referrer_name:e.target.value})} /></div>
          <div style={{flex:"1 1 45%"}}><label style={labelS}>Email</label><input style={inputS} value={referralForm.referrer_email} onChange={e=>setReferralForm({...referralForm,referrer_email:e.target.value})} /></div>
          <div style={{flex:"1 1 45%"}}><label style={labelS}>Company</label><input style={inputS} value={referralForm.referrer_company} onChange={e=>setReferralForm({...referralForm,referrer_company:e.target.value})} /></div>
          <div style={{flex:"1 1 45%"}}><label style={labelS}>Type</label><select style={selectS} value={referralForm.referrer_type} onChange={e=>setReferralForm({...referralForm,referrer_type:e.target.value})}><option value="realtor">Realtor</option><option value="builder">Builder</option><option value="attorney">Attorney</option><option value="cpa">CPA</option><option value="financial_advisor">Financial Advisor</option><option value="past_client">Past Client</option><option value="other">Other</option></select></div>
        </div>
        <div style={{fontSize:9,fontWeight:600,color:GOLD,marginBottom:6}}>REFERRED CLIENT</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>
          <div style={{flex:"1 1 30%"}}><label style={labelS}>Name</label><input style={inputS} value={referralForm.referred_name} onChange={e=>setReferralForm({...referralForm,referred_name:e.target.value})} /></div>
          <div style={{flex:"1 1 30%"}}><label style={labelS}>Email</label><input style={inputS} value={referralForm.referred_email} onChange={e=>setReferralForm({...referralForm,referred_email:e.target.value})} /></div>
          <div style={{flex:"1 1 30%"}}><label style={labelS}>Phone</label><input style={inputS} value={referralForm.referred_phone} onChange={e=>setReferralForm({...referralForm,referred_phone:e.target.value})} /></div>
        </div>
        <div style={{marginBottom:12}}><label style={labelS}>Deal Type</label><select style={selectS} value={referralForm.deal_type} onChange={e=>setReferralForm({...referralForm,deal_type:e.target.value})}><option value="mortgage">Mortgage</option><option value="insurance">Insurance</option><option value="real_estate">Real Estate</option><option value="credit_repair">Credit Repair</option></select></div>
        <button onClick={handleLogReferral} disabled={referralLoading} style={btnS}>{referralLoading?"Saving...":"Log Referral"}</button>
      </Modal>

      {/* Quick Stats Dashboard */}
      <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
        {[
          { label:"Total Active Deals", val:activeLoans.length, sub:fmtMoney(totalVolume)+" volume", color:bizColor, icon:"\uD83D\uDCCA" },
          { label:"This Month Revenue", val:fmtMoney(thisMonthRevenue), sub:fundedThisMonth.length+" deals funded", color:GREEN, icon:"\uD83D\uDCB0" },
          { label:"Avg Days to Close", val:avgDays+"d", sub:fundedLoans.length+" funded total", color:BLUE, icon:"\u23F1\uFE0F" },
          { label:"Conversion Rate", val:conversionRate+"%", sub:fundedLoans.length+"/"+appAndBeyond.length+" converted", color:conversionRate>=50?GREEN:conversionRate>=30?YELLOW:RED, icon:"\uD83C\uDFAF" },
        ].map((s,i)=>(
          <div key={i} style={{ ...cardS, flex:"1 1 220px", minWidth:200, borderLeft:`3px solid ${s.color}`, transition:"transform .2s, box-shadow .2s", cursor:"default" }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 8px 32px ${s.color}22`;e.currentTarget.style.borderColor=`${BORDER_HOVER}`;}}
            onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 24px rgba(0,0,0,0.3)";e.currentTarget.style.borderColor=BORDER;}}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>{s.label}</div>
                <div style={{ fontSize:28, fontWeight:700, color:s.color, marginTop:6 }}>{s.val}</div>
                <div style={{ fontSize:11, color:DIM, marginTop:4 }}>{s.sub}</div>
              </div>
              <span style={{ fontSize:24, opacity:.4 }}>{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filter Bar */}
      <div style={{ ...cardS, marginBottom:16, padding:16 }}>
        <div style={{ display:"flex", gap:10, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={()=>openNewApp(null)} style={{ ...btnS, display:"flex", alignItems:"center", gap:6 }}>+ New Deal</button>
          <button onClick={()=>setReferralModal(true)} style={{ ...btnOutS, display:"flex", alignItems:"center", gap:6, padding:"8px 16px", fontSize:11 }}>{"\uD83E\uDD1D"} Log Referral</button>
          <div style={{ display:"flex", gap:0, borderRadius:8, overflow:"hidden", border:`1px solid ${BORDER}` }}>
            <button onClick={()=>setViewMode("kanban")} style={{ ...btnSmS, background:viewMode==="kanban"?bizColor+"22":"transparent", color:viewMode==="kanban"?bizColor:DIM, border:"none", borderRadius:0 }}>Kanban</button>
            <button onClick={()=>setViewMode("table")} style={{ ...btnSmS, background:viewMode==="table"?bizColor+"22":"transparent", color:viewMode==="table"?bizColor:DIM, border:"none", borderRadius:0 }}>Table</button>
          </div>
          <div style={{ position:"relative", flex:"1 1 200px", maxWidth:260 }}>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder={"\uD83D\uDD0D Search name, email, phone..."} style={{ ...inputS }} />
          </div>
          <select value={stageFilter} onChange={e=>setStageFilter(e.target.value)} style={{ ...selectS, width:130 }}>
            <option value="All">All Stages</option>
            {stagesForPipeline.map(s=><option key={s} value={s}>{s}</option>)}
          </select>
          {activeServices.length > 0 && (
            <select value={serviceFilter} onChange={e=>setServiceFilter(e.target.value)} style={{ ...selectS, width:140 }}>
              <option value="All">All Services</option>
              {activeServices.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
          )}
          {loanOfficers.length > 1 && (
            <select value={loFilter} onChange={e=>setLoFilter(e.target.value)} style={{ ...selectS, width:130 }}>
              <option value="All">All LOs</option>
              {loanOfficers.map(lo=><option key={lo} value={lo}>{lo}</option>)}
            </select>
          )}
          <input value={amountMin} onChange={e=>setAmountMin(e.target.value)} placeholder="Min $" type="number" style={{ ...inputS, width:80 }} />
          <input value={amountMax} onChange={e=>setAmountMax(e.target.value)} placeholder="Max $" type="number" style={{ ...inputS, width:80 }} />
          <button onClick={reload} style={{ ...btnOutS, padding:"8px 14px", fontSize:11 }}>{"\u21BB"} Refresh</button>
          {loading && <span style={{ fontSize:11, color:DIM }}>Loading...</span>}
          <span style={{ fontSize:11, color:DIM, marginLeft:"auto" }}>{filtered.length} deal{filtered.length!==1?"s":""}</span>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode==="kanban" && (
        <div style={{ display:"flex", gap:12, overflowX:"auto", paddingBottom:16 }}>
          {stagesForPipeline.map(stage => {
            const isDragOver = dragOverStage === stage;
            const terminalGreen = ["Funded","Closed","Completed","Graduated","Bound","Active"].includes(stage);
            const terminalRed = ["Denied","Withdrawn","Cancelled","Lost","Expired"].includes(stage);
            const stageColor = terminalGreen ? GREEN : terminalRed ? RED : BRIGHT;
            return (
              <div key={stage}
                onDragOver={e=>{e.preventDefault();setDragOverStage(stage);}}
                onDragLeave={()=>setDragOverStage(null)}
                onDrop={()=>handleDrop(stage)}
                style={{
                  minWidth:220, maxWidth:240, flex:"0 0 230px", background:isDragOver?bizColor+"08":CARD,
                  border:`1px solid ${isDragOver?bizColor+"44":BORDER}`, borderRadius:12, padding:12,
                  transition:"border-color .2s, background .2s", boxShadow:isDragOver?`0 0 20px ${bizColor}18`:"0 4px 24px rgba(0,0,0,0.3)"
                }}
              >
                <div style={{ fontSize:11, fontWeight:600, color:stageColor, letterSpacing:".08em", textTransform:"uppercase", marginBottom:12, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <span>{stage}</span>
                  <span style={{ ...badgeS(bizColor), fontSize:10 }}>{byStage[stage]?.length||0}</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:8, maxHeight:"60vh", overflowY:"auto" }}>
                  {(byStage[stage]||[]).map(loan => (
                    <LoanCard key={loan.id} loan={loan} allLoans={allLoans||loans} bizColor={bizColor}
                      onDragStart={()=>setDragLoan(loan)} onClick={()=>setQuickViewLoan(loan)} onDoubleClick={()=>openLoanDetail(loan)}
                      onInviteClient={()=>{setInviteModal(loan);setInviteForm({client_name:`${loan.first_name||""} ${loan.last_name||""}`.trim(),email:loan.email||"",phone:loan.phone||"",language:"en"});setInviteResult(null);}}
                      onSetRateAlert={()=>setRateAlertModal(loan)}
                      onStartFollowUp={()=>handleStartFollowUp(loan)}
                      followUpLoading={followUpLoading} />
                  ))}
                  {(byStage[stage]||[]).length===0 && <div style={{ fontSize:11, color:DIM, textAlign:"center", padding:24, border:`1px dashed ${BORDER}`, borderRadius:8 }}>Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode==="table" && (
        <div style={{ overflowX:"auto", borderRadius:12, border:`1px solid ${BORDER}`, background:CARD }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12, color:TXT }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                {["Borrower","Amount","Program","Stage","Lender","LO","Days","Docs %","Actions"].map(h=>(
                  <th key={h} style={{ padding:"12px 16px", textAlign:"left", fontSize:11, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const days = daysBetween(l.stage_entered_at || l.created_at);
                const dayColor = days<3?GREEN:days<7?YELLOW:RED;
                return (
                  <tr key={l.id} style={{ borderBottom:`1px solid ${BORDER}`, cursor:"pointer", transition:"background .15s" }}
                    onClick={()=>openLoanDetail(l)}
                    onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
                    onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                    <td style={{ padding:"12px 16px", fontWeight:500 }}>{l.first_name} {l.last_name}</td>
                    <td style={{ padding:"12px 16px", color:GOLD, fontWeight:600 }}>{fmtMoney(l.loan_amount)}</td>
                    <td style={{ padding:"12px 16px" }}>{l.loan_program||"\u2014"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={badgeS(l.stage==="Funded"?GREEN:l.stage==="Denied"?RED:BLUE)}>{l.stage}</span></td>
                    <td style={{ padding:"12px 16px" }}>{l.lender||"\u2014"}</td>
                    <td style={{ padding:"12px 16px" }}>{l.loan_officer||"\u2014"}</td>
                    <td style={{ padding:"12px 16px" }}><span style={{ color:dayColor, fontWeight:600 }}>{days}d</span></td>
                    <td style={{ padding:"12px 16px" }}>
                      <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:4, height:6, width:80 }}>
                        <div style={{ background:GREEN, height:6, borderRadius:4, width:`${l.doc_completion_pct||0}%` }} />
                      </div>
                      <span style={{ fontSize:10, color:DIM, marginTop:2, display:"block" }}>{l.doc_completion_pct||0}%</span>
                    </td>
                    <td style={{ padding:"12px 16px", display:"flex", gap:6 }}>
                      <button onClick={e=>{e.stopPropagation();setQuickViewLoan(l);}} style={{ ...btnSmS, fontSize:10 }}>View</button>
                      <button onClick={e=>{e.stopPropagation();openLoanDetail(l);}} style={{ ...btnSmS, fontSize:10, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>Edit</button>
                      <button onClick={e=>{e.stopPropagation();setDeleteConfirm(l);}} style={{ ...btnSmS, fontSize:10, background:RED+"18", color:RED, border:"none" }}>x</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length===0 && (
                <tr><td colSpan={9} style={{ padding:40, textAlign:"center", color:DIM, fontSize:13 }}>No loans found. Click "+ New Deal" to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── LOAN CARD (Kanban) ───────────────────────────────────────────────────────
function LoanCard({ loan, allLoans, bizColor, onDragStart, onClick, onDoubleClick, onInviteClient, onSetRateAlert, onStartFollowUp, followUpLoading }) {
  const [hovered, setHovered] = useState(false);
  const days = daysBetween(loan.stage_entered_at||loan.created_at);
  const dayColor = days<3?GREEN:days<7?YELLOW:RED;
  const priority = getPriority(loan);
  const pColor = getPriorityColor(priority);
  const pIcon = getPriorityIcon(priority);
  const bc = bizColor || GOLD;

  // Service type badge color from business config
  const loanBiz = BUSINESSES.find(b => b.id === loan.business);
  const serviceColor = loanBiz ? loanBiz.color : GOLD;

  // Cross-sell: check if related deals exist for this borrower
  const borrowerName = `${loan.first_name||""} ${loan.last_name||""}`.trim().toLowerCase();
  const relatedDeals = (allLoans||[]).filter(l => l.id !== loan.id && `${l.first_name||""} ${l.last_name||""}`.trim().toLowerCase() === borrowerName);
  const hasInsuranceDeal = relatedDeals.some(l => l.business === "Wolf Surety");
  const hasCreditDeal = relatedDeals.some(l => l.business === "Credit Repair");
  const hasMortgageDeal = relatedDeals.some(l => l.business === "DOS Mortgage");
  const needsInsurance = !hasInsuranceDeal && loan.business === "DOS Mortgage";
  const needsCreditRepair = !hasCreditDeal && loan.fico && loan.fico < 680;

  return (
    <div draggable onDragStart={onDragStart} onClick={onClick} onDoubleClick={e=>{e.stopPropagation();if(onDoubleClick)onDoubleClick();}}
      onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}
      style={{
        background:hovered ? CARD_HOVER : BG, border:`1px solid ${hovered ? bc+"44" : BORDER}`, borderRadius:12, padding:14,
        cursor:"grab", transition:"all .2s ease", borderLeft:`3px solid ${pColor}`,
        boxShadow:hovered ? `0 8px 24px rgba(0,0,0,.5)` : "0 2px 8px rgba(0,0,0,.2)",
        transform:hovered ? "translateY(-2px)" : "none"
      }}
    >
      {/* Header: Name + Priority */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:6 }}>
        <div style={{ fontSize:14, fontWeight:600, color:BRIGHT, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
          {loan.first_name||"\u2014"} {loan.last_name||""}
        </div>
        <span title={priority} style={{ fontSize:13, cursor:"default" }}>{pIcon}</span>
      </div>

      {/* Loan amount */}
      <div style={{ fontSize:16, color:bc, fontWeight:700, marginBottom:6 }}>
        {fmtMoney(loan.loan_amount)}
      </div>

      {/* Service type badge */}
      {loan.service_type && (
        <div style={{ marginBottom:6 }}>
          <span style={{ fontSize:9, padding:"3px 10px", borderRadius:20, background:serviceColor+"14", color:serviceColor, border:`1px solid ${serviceColor}22`, fontWeight:600, letterSpacing:".04em" }}>
            {loan.service_type}
          </span>
        </div>
      )}

      {loan.property_address && <div style={{ fontSize:11, color:DIM, marginBottom:4, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{loan.property_address}</div>}
      {loan.lender && <div style={{ fontSize:11, color:DIM, marginBottom:6 }}>{loan.lender} {loan.loan_program ? `\u00B7 ${loan.loan_program}`:""}</div>}

      {/* Badges row */}
      <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginBottom:6 }}>
        <span style={{ ...badgeS(dayColor), display:"flex", alignItems:"center", gap:3, fontSize:9 }}>{days}d in stage</span>
        {loan.fico && <span style={{ ...badgeS(loan.fico>=740?GREEN:loan.fico>=680?YELLOW:RED), fontSize:9 }}>FICO {loan.fico}</span>}
        {loan.ltv && <span style={{ ...badgeS(BLUE), fontSize:9 }}>LTV {fmtPct(loan.ltv)}</span>}
      </div>

      {/* Doc completion bar */}
      <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:4, height:4, width:"100%", marginBottom:4 }}>
        <div style={{ background:GREEN, height:4, borderRadius:4, width:`${loan.doc_completion_pct||0}%`, transition:"width .3s" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:10, color:DIM }}>Docs: {loan.doc_completion_pct||0}%</span>
        <span style={{ fontSize:10, color:DIM }}>{timeAgo(loan.updated_at||loan.created_at)}</span>
      </div>

      {/* Cross-sell indicators */}
      <div style={{ display:"flex", gap:3, marginTop:4, flexWrap:"wrap" }}>
        {needsInsurance && (
          <span style={{ fontSize:7, padding:"2px 5px", borderRadius:3, background:"rgba(16,185,129,.1)", color:"#10b981", border:"1px solid rgba(16,185,129,.25)", letterSpacing:".03em" }}>
            {"\uD83D\uDEE1\uFE0F"} Insurance Needed
          </span>
        )}
        {needsCreditRepair && (
          <span style={{ fontSize:7, padding:"2px 5px", borderRadius:3, background:"rgba(139,92,246,.1)", color:"#a78bfa", border:"1px solid rgba(139,92,246,.2)", letterSpacing:".03em" }}>
            {"\u26A1"} Credit Repair Opp
          </span>
        )}
        {loan.business === "Wolf Surety" && !hasMortgageDeal && (
          <span style={{ fontSize:7, padding:"2px 5px", borderRadius:3, background:"rgba(59,130,246,.1)", color:"#3b82f6", border:"1px solid rgba(59,130,246,.2)", letterSpacing:".03em" }}>
            {"\uD83C\uDFE6"} Mortgage Opp
          </span>
        )}
      </div>

      {/* ── Edge Function Action Buttons ────────────────────────────── */}
      <div style={{ display:"flex", gap:3, marginTop:4, flexWrap:"wrap" }}>
        {onInviteClient && (
          <button onClick={e=>{e.stopPropagation();onInviteClient();}} style={{ fontSize:7, padding:"2px 6px", borderRadius:3, background:GOLD+"18", color:GOLD, border:`1px solid ${GOLD}33`, cursor:"pointer", fontWeight:600, letterSpacing:".03em" }}>
            {"\uD83D\uDCE8"} Invite
          </button>
        )}
        {onSetRateAlert && ["Funded","Closed"].includes(loan.stage) && (
          <button onClick={e=>{e.stopPropagation();onSetRateAlert();}} style={{ fontSize:7, padding:"2px 6px", borderRadius:3, background:GREEN+"18", color:GREEN, border:`1px solid ${GREEN}33`, cursor:"pointer", fontWeight:600, letterSpacing:".03em" }}>
            {"\uD83D\uDD14"} Rate Alert
          </button>
        )}
        {onStartFollowUp && ["Lead","Pre-Qual"].includes(loan.stage) && (
          <button onClick={e=>{e.stopPropagation();onStartFollowUp();}} disabled={followUpLoading===loan.id} style={{ fontSize:7, padding:"2px 6px", borderRadius:3, background:BLUE+"18", color:BLUE, border:`1px solid ${BLUE}33`, cursor:"pointer", fontWeight:600, letterSpacing:".03em", opacity:followUpLoading===loan.id?.5:1 }}>
            {followUpLoading===loan.id ? "..." : "\uD83D\uDE80 Follow-Up"}
          </button>
        )}
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 3: LOAN APPLICATION (1003-style multi-step)
// ═══════════════════════════════════════════════════════════════════════════════
function ApplicationTab({ prefill, user, showToast, reload, setTab, selectedLoan, setSelectedLoan }) {
  const isEdit = !!(prefill && prefill.id);
  const emptyForm = {
    first_name:"", middle_name:"", last_name:"", suffix:"",
    ssn_masked:"", dob:"", phone:"", email:"",
    address:"", city:"", state:"", zip:"",
    years_at_address:"", housing_type:"Own",
    prev_address:"", prev_city:"", prev_state:"", prev_zip:"",
    marital_status:"Single", dependents:0,
    employer_name:"", employer_address:"", employer_phone:"",
    position_title:"", employment_start:"",
    monthly_base:0, monthly_overtime:0, monthly_bonus:0, monthly_commission:0,
    self_employment_income:0, other_income:[],
    prev_employer:"", prev_position:"", prev_start:"", prev_end:"",
    bank_accounts:[], investment_accounts:[], real_estate_owned:[],
    property_address:"", property_city:"", property_state:"", property_zip:"",
    purchase_price:"", estimated_value:"",
    loan_amount:"", down_payment:"",
    loan_purpose:"Purchase", property_type:"Single Family", occupancy:"Primary Residence",
    loan_program:"", lender:"", rate:"", ltv:"", fico:"",
    declarations:{
      outstanding_judgments:false, bankrupt_7yr:false, foreclosure_7yr:false,
      party_lawsuit:false, delinquent_loan:false, alimony_child_support:false,
      cosigner:false, us_citizen:true, primary_residence:true, ownership_3yr:false
    },
    stage:"Lead", notes:"",
    loan_officer: user?.full_name || user?.email || "",
  };

  const [form, setForm] = useState(() => {
    if (prefill && Object.keys(prefill).length>0) {
      const merged = { ...emptyForm };
      Object.keys(prefill).forEach(k => { if (prefill[k]!==null && prefill[k]!==undefined) merged[k]=prefill[k]; });
      if (typeof merged.declarations==="string") try { merged.declarations=JSON.parse(merged.declarations); } catch(e){}
      if (typeof merged.bank_accounts==="string") try { merged.bank_accounts=JSON.parse(merged.bank_accounts); } catch(e){}
      if (typeof merged.investment_accounts==="string") try { merged.investment_accounts=JSON.parse(merged.investment_accounts); } catch(e){}
      if (typeof merged.real_estate_owned==="string") try { merged.real_estate_owned=JSON.parse(merged.real_estate_owned); } catch(e){}
      if (typeof merged.other_income==="string") try { merged.other_income=JSON.parse(merged.other_income); } catch(e){}
      return merged;
    }
    return emptyForm;
  });

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [scanResult, setScanResult] = useState(null);
  const STEPS = ["Borrower Info","Employment & Income","Assets & Liabilities","Property & Loan","Declarations","Review & Submit"];

  const handleScanDocument = async (file) => {
    if (!file) return;
    setScanLoading(true);
    setScanResult(null);
    try {
      const reader = new FileReader();
      reader.onload = async () => {
        const base64 = reader.result.split(",")[1];
        const docType = file.name.toLowerCase().includes("w2") ? "w2" : file.name.toLowerCase().includes("paystub") ? "paystub" : file.name.toLowerCase().includes("bank") ? "bank_statement" : "other";
        const res = await edgeFn("doc-scanner/extract", { file_base64:base64, doc_type:docType, loan_id:prefill?.id||null });
        setScanLoading(false);
        setScanResult(res);
      };
      reader.readAsDataURL(file);
    } catch(e) { console.error(e); setScanLoading(false); }
  };

  const applyScanToForm = () => {
    if (!scanResult) return;
    const data = scanResult;
    const mapping = { first_name:"first_name", last_name:"last_name", phone:"phone", email:"email", address:"address", city:"city", state:"state", zip:"zip", employer_name:"employer_name", position_title:"position_title", monthly_base:"monthly_base", ssn_masked:"ssn_masked", dob:"dob" };
    Object.entries(mapping).forEach(([formKey, dataKey]) => {
      if (data[dataKey] && !form[formKey]) upd(formKey, data[dataKey]);
    });
    setScanResult(null);
    if (showToast) showToast("Extracted data applied to form","success");
  };

  const upd = (field, val) => setForm(p => ({ ...p, [field]:val }));
  const updDecl = (field, val) => setForm(p => ({ ...p, declarations:{ ...p.declarations, [field]:val } }));

  const saveDraft = async () => {
    setSaving(true);
    const payload = { ...form, updated_at:new Date().toISOString(), user_id:user?.id||null };
    delete payload.id; delete payload.created_at;
    // serialize json fields
    if (typeof payload.declarations==="object") payload.declarations = JSON.stringify(payload.declarations);
    if (Array.isArray(payload.bank_accounts)) payload.bank_accounts = JSON.stringify(payload.bank_accounts);
    if (Array.isArray(payload.investment_accounts)) payload.investment_accounts = JSON.stringify(payload.investment_accounts);
    if (Array.isArray(payload.real_estate_owned)) payload.real_estate_owned = JSON.stringify(payload.real_estate_owned);
    if (Array.isArray(payload.other_income)) payload.other_income = JSON.stringify(payload.other_income);
    // numeric
    ["purchase_price","estimated_value","loan_amount","down_payment","monthly_base","monthly_overtime","monthly_bonus","monthly_commission","self_employment_income","rate","ltv","years_at_address","dependents","fico","commission"].forEach(k=>{
      if (payload[k]===""||payload[k]===null||payload[k]===undefined) payload[k]=null;
      else payload[k]=Number(payload[k]);
    });
    try {
      let result;
      if (isEdit) {
        result = await sbUpdate("vault_loans", prefill.id, payload);
      } else {
        result = await sbInsert("vault_loans", payload);
      }
      if (result) {
        if (showToast) showToast(isEdit?"Loan updated":"Loan saved","success");
        if (!isEdit && result.id) {
          setSelectedLoan(result);
          // Generate doc checklist
          await generateDocChecklist(result.id);
        }
        reload();
      } else {
        if (showToast) showToast("Save failed","error");
      }
    } catch(e) { console.error(e); if (showToast) showToast("Error saving","error"); }
    setSaving(false);
  };

  const submitApp = async () => {
    upd("stage","Application");
    // wait for state update then save
    setTimeout(async () => {
      await saveDraft();
      if (showToast) showToast("Application submitted!","success");
      setTab(1);
    }, 100);
  };

  const generateDocChecklist = async (loanId) => {
    const docs = [];
    Object.entries(DOC_CHECKLIST).forEach(([cat, items]) => {
      items.forEach(name => {
        docs.push({ loan_id:loanId, category:cat, doc_name:name, status:"Missing" });
      });
    });
    for (const d of docs) {
      await sbInsert("vault_loan_documents", d);
    }
  };

  // ─── Field render helpers ───────────────────────────────────────────
  const Field = ({ label, field, type="text", w="100%", placeholder="" }) => (
    <div style={{ flex:`0 0 ${w}`, maxWidth:w, marginBottom:8 }}>
      <label style={labelS}>{label}</label>
      <input type={type} value={form[field]||""} onChange={e=>upd(field,e.target.value)} placeholder={placeholder} style={inputS} />
    </div>
  );

  const SelectField = ({ label, field, options, w="100%" }) => (
    <div style={{ flex:`0 0 ${w}`, maxWidth:w, marginBottom:8 }}>
      <label style={labelS}>{label}</label>
      <select value={form[field]||""} onChange={e=>upd(field,e.target.value)} style={selectS}>
        <option value="">Select...</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );

  const DeclToggle = ({ label, field }) => (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}22` }}>
      <span style={{ fontSize:10, color:TXT, maxWidth:"80%" }}>{label}</span>
      <div onClick={()=>updDecl(field,!form.declarations[field])} style={{
        width:36, height:18, borderRadius:9, background:form.declarations[field]?RED+"55":GREEN+"44",
        position:"relative", cursor:"pointer", transition:"background .2s"
      }}>
        <div style={{
          width:14, height:14, borderRadius:7, background:form.declarations[field]?RED:GREEN,
          position:"absolute", top:2, left:form.declarations[field]?20:2, transition:"left .2s"
        }} />
      </div>
    </div>
  );

  return (
    <div>
      {/* ── Document Scanner ─────────────────────────────────────────── */}
      <div style={{ ...cardS, marginBottom:12, display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <span style={{ fontSize:13 }}>{"\uD83D\uDCF7"}</span>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, fontWeight:600, color:GOLD }}>Scan Document (PDF/Image)</div>
          <div style={{ fontSize:8, color:DIM }}>Extract borrower data from W-2, pay stubs, bank statements</div>
        </div>
        <label style={{ ...btnS, fontSize:9, padding:"5px 12px", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:4, opacity:scanLoading?.6:1 }}>
          {scanLoading ? "Scanning..." : "\uD83D\uDCC4 Scan Document"}
          <input type="file" accept=".pdf,.png,.jpg,.jpeg,.tiff,.webp" style={{ display:"none" }} onChange={e=>handleScanDocument(e.target.files[0])} disabled={scanLoading} />
        </label>
      </div>
      {scanResult && !scanResult.error && (
        <div style={{ ...cardS, marginBottom:12, borderColor:GREEN+"33" }}>
          <div style={{ fontSize:9, fontWeight:700, color:GREEN, marginBottom:8 }}>Extracted Data</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:4, marginBottom:10 }}>
            {Object.entries(scanResult).filter(([k])=>!["error","raw","ok"].includes(k)).map(([k,v])=>(
              <div key={k} style={{ fontSize:9 }}>
                <span style={{ color:DIM }}>{k.replace(/_/g," ")}: </span>
                <span style={{ color:BRIGHT }}>{typeof v==="object"?JSON.stringify(v):String(v)}</span>
              </div>
            ))}
          </div>
          <button onClick={applyScanToForm} style={btnS}>Apply to Form</button>
          <button onClick={()=>setScanResult(null)} style={{ ...btnOutS, marginLeft:8 }}>Dismiss</button>
        </div>
      )}
      {scanResult && scanResult.error && (
        <div style={{ ...cardS, marginBottom:12, borderColor:RED+"33" }}>
          <div style={{ fontSize:9, color:RED }}>{scanResult.error || scanResult.raw || "Scan failed"}</div>
          <button onClick={()=>setScanResult(null)} style={{ ...btnOutS, marginTop:6, fontSize:8 }}>Dismiss</button>
        </div>
      )}

      {/* Step Indicator */}
      <div style={{ display:"flex", alignItems:"flex-start", marginBottom:24, padding:"0 16px" }}>
        {STEPS.map((s,i)=>(
          <div key={i} onClick={()=>setStep(i)} style={{ flex:1, cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", position:"relative" }}>
            {/* Connector line */}
            {i > 0 && <div style={{ position:"absolute", top:14, right:"50%", width:"100%", height:2, background:i<=step?GOLD:BORDER, zIndex:0 }} />}
            {/* Circle */}
            <div style={{
              width:28, height:28, borderRadius:14, display:"flex", alignItems:"center", justifyContent:"center",
              background:i<step?GOLD:i===step?GOLD+"22":"transparent",
              border:`2px solid ${i<=step?GOLD:BORDER}`,
              color:i<step?"#0a0a12":i===step?GOLD:DIM,
              fontSize:i<step?14:12, fontWeight:600, zIndex:1, position:"relative", transition:"all .2s"
            }}>
              {i<step ? "\u2713" : i+1}
            </div>
            {/* Label */}
            <div style={{ fontSize:10, color:i===step?GOLD:i<step?GREEN:DIM, marginTop:6, textAlign:"center", lineHeight:1.3, letterSpacing:".03em" }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div style={cardS}>
        {step===0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>BORROWER INFORMATION</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="First Name" field="first_name" w="24%" />
              <Field label="Middle" field="middle_name" w="14%" />
              <Field label="Last Name" field="last_name" w="24%" />
              <Field label="Suffix" field="suffix" w="10%" />
              <Field label="SSN (last 4)" field="ssn_masked" w="14%" placeholder="XXX-XX-****" />
              <Field label="Date of Birth" field="dob" type="date" w="16%" />
              <Field label="Phone" field="phone" w="20%" />
              <Field label="Email" field="email" type="email" w="30%" />
            </div>
            <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6 }}>Current Address</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="Street Address" field="address" w="40%" />
              <Field label="City" field="city" w="20%" />
              <SelectField label="State" field="state" options={US_STATES} w="12%" />
              <Field label="Zip" field="zip" w="12%" />
              <Field label="Years at Address" field="years_at_address" type="number" w="12%" />
              <SelectField label="Housing" field="housing_type" options={HOUSING_TYPES} w="14%" />
            </div>
            {(Number(form.years_at_address||99)<2) && (
              <div>
                <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6 }}>Previous Address (if less than 2 years)</div>
                <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
                  <Field label="Street Address" field="prev_address" w="40%" />
                  <Field label="City" field="prev_city" w="20%" />
                  <SelectField label="State" field="prev_state" options={US_STATES} w="12%" />
                  <Field label="Zip" field="prev_zip" w="12%" />
                </div>
              </div>
            )}
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
              <SelectField label="Marital Status" field="marital_status" options={MARITAL_STATUSES} w="20%" />
              <Field label="Dependents" field="dependents" type="number" w="12%" />
            </div>
          </div>
        )}

        {step===1 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>EMPLOYMENT & INCOME</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="Employer Name" field="employer_name" w="30%" />
              <Field label="Employer Address" field="employer_address" w="30%" />
              <Field label="Employer Phone" field="employer_phone" w="18%" />
              <Field label="Position / Title" field="position_title" w="24%" />
              <Field label="Start Date" field="employment_start" type="date" w="16%" />
            </div>
            <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6 }}>Monthly Income</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="Base Income" field="monthly_base" type="number" w="18%" />
              <Field label="Overtime" field="monthly_overtime" type="number" w="18%" />
              <Field label="Bonus" field="monthly_bonus" type="number" w="18%" />
              <Field label="Commission" field="monthly_commission" type="number" w="18%" />
              <Field label="Self-Employment" field="self_employment_income" type="number" w="18%" />
            </div>
            {/* Other Income */}
            <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span>Other Income Sources</span>
              <button onClick={()=>setForm(p=>({...p,other_income:[...p.other_income,{source:"",amount:0}]}))} style={btnSmS}>+ Add</button>
            </div>
            {(form.other_income||[]).map((inc,i) => (
              <div key={i} style={{ display:"flex", gap:8, marginBottom:4, alignItems:"center" }}>
                <input value={inc.source} onChange={e=>{const a=[...form.other_income];a[i]={...a[i],source:e.target.value};upd("other_income",a);}} placeholder="Source" style={{ ...inputS, flex:1 }} />
                <input type="number" value={inc.amount} onChange={e=>{const a=[...form.other_income];a[i]={...a[i],amount:Number(e.target.value)};upd("other_income",a);}} placeholder="$/mo" style={{ ...inputS, width:100 }} />
                <button onClick={()=>{const a=[...form.other_income];a.splice(i,1);upd("other_income",a);}} style={{ ...btnSmS, background:RED+"33", color:RED }}>✕</button>
              </div>
            ))}
            {/* Previous employer */}
            <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6 }}>Previous Employment (if current &lt; 2 years)</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="Previous Employer" field="prev_employer" w="30%" />
              <Field label="Position" field="prev_position" w="20%" />
              <Field label="Start Date" field="prev_start" type="date" w="16%" />
              <Field label="End Date" field="prev_end" type="date" w="16%" />
            </div>
          </div>
        )}

        {step===2 && <AssetsStep form={form} setForm={setForm} upd={upd} />}

        {step===3 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>PROPERTY & LOAN DETAILS</div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <Field label="Property Address" field="property_address" w="40%" />
              <Field label="City" field="property_city" w="20%" />
              <SelectField label="State" field="property_state" options={US_STATES} w="12%" />
              <Field label="Zip" field="property_zip" w="12%" />
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
              <Field label="Purchase Price" field="purchase_price" type="number" w="18%" />
              <Field label="Estimated Value" field="estimated_value" type="number" w="18%" />
              <Field label="Loan Amount" field="loan_amount" type="number" w="18%" />
              <Field label="Down Payment" field="down_payment" type="number" w="18%" />
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
              <SelectField label="Loan Purpose" field="loan_purpose" options={LOAN_PURPOSES} w="20%" />
              <SelectField label="Property Type" field="property_type" options={PROPERTY_TYPES} w="20%" />
              <SelectField label="Occupancy" field="occupancy" options={OCCUPANCY_TYPES} w="20%" />
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap", marginTop:8 }}>
              <Field label="Loan Program" field="loan_program" w="20%" />
              <Field label="Lender" field="lender" w="20%" />
              <Field label="Rate (%)" field="rate" type="number" w="12%" />
              <Field label="LTV (%)" field="ltv" type="number" w="12%" />
              <Field label="FICO Score" field="fico" type="number" w="12%" />
            </div>
          </div>
        )}

        {step===4 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>DECLARATIONS</div>
            <div style={{ fontSize:9, color:DIM, marginBottom:10 }}>Answer the following questions. Toggle ON (red) for YES, OFF (green) for NO.</div>
            <DeclToggle label="Are there any outstanding judgments against you?" field="outstanding_judgments" />
            <DeclToggle label="Have you been declared bankrupt within the past 7 years?" field="bankrupt_7yr" />
            <DeclToggle label="Have you had property foreclosed upon in the past 7 years?" field="foreclosure_7yr" />
            <DeclToggle label="Are you a party to a lawsuit?" field="party_lawsuit" />
            <DeclToggle label="Are you obligated on any loan which is currently delinquent?" field="delinquent_loan" />
            <DeclToggle label="Are you obligated to pay alimony, child support, or separate maintenance?" field="alimony_child_support" />
            <DeclToggle label="Are you a co-signer or endorser on any note?" field="cosigner" />
            <DeclToggle label="Are you a US citizen?" field="us_citizen" />
            <DeclToggle label="Will this property be your primary residence?" field="primary_residence" />
            <DeclToggle label="Have you had an ownership interest in property in the past 3 years?" field="ownership_3yr" />
          </div>
        )}

        {step===5 && (
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>REVIEW & SUBMIT</div>
            <ReviewSummary form={form} />

            {/* Notes */}
            <div style={{ marginTop:12 }}>
              <label style={labelS}>Internal Notes</label>
              <textarea value={form.notes||""} onChange={e=>upd("notes",e.target.value)} rows={3}
                placeholder="Add internal notes about this loan..."
                style={{ ...inputS, width:"100%", resize:"vertical", fontFamily:"inherit", minHeight:50 }} />
            </div>

            {/* Stage selector for edit mode */}
            {isEdit && (
              <div style={{ marginTop:12 }}>
                <label style={labelS}>Loan Stage</label>
                <select value={form.stage||"Lead"} onChange={e=>upd("stage",e.target.value)} style={{ ...selectS, maxWidth:200 }}>
                  {STAGES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}

            {/* Commission */}
            <div style={{ marginTop:8, display:"flex", gap:8 }}>
              <div style={{ flex:"0 0 160px" }}>
                <label style={labelS}>Commission ($)</label>
                <input type="number" value={form.commission||""} onChange={e=>upd("commission",e.target.value)} placeholder="0" style={inputS} />
              </div>
              <div style={{ flex:"0 0 160px" }}>
                <label style={labelS}>Loan Officer</label>
                <input value={form.loan_officer||""} onChange={e=>upd("loan_officer",e.target.value)} style={inputS} />
              </div>
            </div>

            {/* Validation warnings */}
            {(() => {
              const warnings = [];
              if (!form.first_name) warnings.push("Borrower first name is required");
              if (!form.last_name) warnings.push("Borrower last name is required");
              if (!form.loan_amount) warnings.push("Loan amount is required");
              if (!form.property_address) warnings.push("Property address is required");
              if (!form.loan_purpose) warnings.push("Loan purpose is required");
              if (warnings.length===0) return null;
              return (
                <div style={{ marginTop:12, padding:10, background:YELLOW+"11", border:`1px solid ${YELLOW}33`, borderRadius:5 }}>
                  <div style={{ fontSize:9, fontWeight:600, color:YELLOW, marginBottom:4 }}>⚠ Incomplete Fields</div>
                  {warnings.map((w,i) => <div key={i} style={{ fontSize:8, color:DIM, paddingLeft:8 }}>• {w}</div>)}
                </div>
              );
            })()}

            <div style={{ display:"flex", gap:12, marginTop:24 }}>
              <button onClick={submitApp} disabled={saving} style={{ ...btnS, fontSize:13, padding:"12px 32px" }}>
                {saving?"Submitting...": isEdit ? "Update Loan" : "Submit Application"}
              </button>
              {isEdit && (
                <button onClick={saveDraft} disabled={saving} style={{ ...btnOutS, fontSize:13, padding:"12px 32px" }}>
                  {saving?"Saving...":"Save Changes"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:20 }}>
        <button onClick={()=>setStep(Math.max(0,step-1))} disabled={step===0} style={{ ...btnOutS, opacity:step===0?.4:1, fontSize:12 }}>Previous</button>
        <button onClick={saveDraft} disabled={saving} style={{ ...btnOutS, fontSize:12 }}>{saving?"Saving...":"Save Draft"}</button>
        <button onClick={()=>setStep(Math.min(STEPS.length-1,step+1))} disabled={step===STEPS.length-1} style={{ ...btnS, opacity:step===STEPS.length-1?.4:1, fontSize:12 }}>Next</button>
      </div>
    </div>
  );
}


// ─── ASSETS STEP (sub-component for step 2) ──────────────────────────────────
function AssetsStep({ form, setForm, upd }) {
  const addBank = () => setForm(p => ({ ...p, bank_accounts:[...p.bank_accounts,{institution:"",type:"Checking",balance:0}] }));
  const addInvestment = () => setForm(p => ({ ...p, investment_accounts:[...p.investment_accounts,{institution:"",type:"",balance:0}] }));
  const addRE = () => setForm(p => ({ ...p, real_estate_owned:[...p.real_estate_owned,{address:"",market_value:0,mortgage_balance:0,rental_income:0}] }));

  const updArr = (field, idx, key, val) => {
    const a = [...(form[field]||[])];
    a[idx] = { ...a[idx], [key]:val };
    upd(field, a);
  };
  const rmArr = (field, idx) => {
    const a = [...(form[field]||[])];
    a.splice(idx,1);
    upd(field, a);
  };

  return (
    <div>
      <div style={{ fontSize:11, fontWeight:600, color:GOLD, marginBottom:16, letterSpacing:".1em", textTransform:"uppercase" }}>ASSETS & LIABILITIES</div>

      {/* Bank Accounts */}
      <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span>Bank Accounts</span>
        <button onClick={addBank} style={btnSmS}>+ Add Account</button>
      </div>
      {(form.bank_accounts||[]).map((acc,i) => (
        <div key={i} style={{ display:"flex", gap:6, marginBottom:4, alignItems:"center" }}>
          <input value={acc.institution} onChange={e=>updArr("bank_accounts",i,"institution",e.target.value)} placeholder="Institution" style={{ ...inputS, flex:2 }} />
          <select value={acc.type} onChange={e=>updArr("bank_accounts",i,"type",e.target.value)} style={{ ...selectS, flex:1 }}>
            <option>Checking</option><option>Savings</option><option>Money Market</option><option>CD</option>
          </select>
          <input type="number" value={acc.balance} onChange={e=>updArr("bank_accounts",i,"balance",Number(e.target.value))} placeholder="Balance" style={{ ...inputS, flex:1 }} />
          <button onClick={()=>rmArr("bank_accounts",i)} style={{ ...btnSmS, background:RED+"33", color:RED }}>✕</button>
        </div>
      ))}
      {(form.bank_accounts||[]).length===0 && <div style={{ fontSize:9, color:DIM, marginBottom:8 }}>No accounts added.</div>}

      {/* Investment Accounts */}
      <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span>Investment Accounts</span>
        <button onClick={addInvestment} style={btnSmS}>+ Add</button>
      </div>
      {(form.investment_accounts||[]).map((acc,i) => (
        <div key={i} style={{ display:"flex", gap:6, marginBottom:4, alignItems:"center" }}>
          <input value={acc.institution} onChange={e=>updArr("investment_accounts",i,"institution",e.target.value)} placeholder="Institution" style={{ ...inputS, flex:2 }} />
          <input value={acc.type} onChange={e=>updArr("investment_accounts",i,"type",e.target.value)} placeholder="Type (401k, IRA...)" style={{ ...inputS, flex:1 }} />
          <input type="number" value={acc.balance} onChange={e=>updArr("investment_accounts",i,"balance",Number(e.target.value))} placeholder="Balance" style={{ ...inputS, flex:1 }} />
          <button onClick={()=>rmArr("investment_accounts",i)} style={{ ...btnSmS, background:RED+"33", color:RED }}>✕</button>
        </div>
      ))}
      {(form.investment_accounts||[]).length===0 && <div style={{ fontSize:9, color:DIM, marginBottom:8 }}>No investment accounts added.</div>}

      {/* Real Estate Owned */}
      <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, marginTop:12, marginBottom:6, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span>Real Estate Owned</span>
        <button onClick={addRE} style={btnSmS}>+ Add Property</button>
      </div>
      {(form.real_estate_owned||[]).map((re,i) => (
        <div key={i} style={{ display:"flex", gap:6, marginBottom:4, alignItems:"center", flexWrap:"wrap" }}>
          <input value={re.address} onChange={e=>updArr("real_estate_owned",i,"address",e.target.value)} placeholder="Address" style={{ ...inputS, flex:3, minWidth:160 }} />
          <input type="number" value={re.market_value} onChange={e=>updArr("real_estate_owned",i,"market_value",Number(e.target.value))} placeholder="Market Value" style={{ ...inputS, flex:1, minWidth:100 }} />
          <input type="number" value={re.mortgage_balance} onChange={e=>updArr("real_estate_owned",i,"mortgage_balance",Number(e.target.value))} placeholder="Mortgage Bal" style={{ ...inputS, flex:1, minWidth:100 }} />
          <input type="number" value={re.rental_income} onChange={e=>updArr("real_estate_owned",i,"rental_income",Number(e.target.value))} placeholder="Rental $/mo" style={{ ...inputS, flex:1, minWidth:80 }} />
          <button onClick={()=>rmArr("real_estate_owned",i)} style={{ ...btnSmS, background:RED+"33", color:RED }}>✕</button>
        </div>
      ))}
      {(form.real_estate_owned||[]).length===0 && <div style={{ fontSize:9, color:DIM, marginBottom:8 }}>No properties added.</div>}

      {/* Liabilities placeholder */}
      <div style={{ marginTop:16, padding:12, background:BLUE+"11", border:`1px solid ${BLUE}33`, borderRadius:5 }}>
        <div style={{ fontSize:9, color:BLUE, fontWeight:600, letterSpacing:".06em" }}>MONTHLY LIABILITIES</div>
        <div style={{ fontSize:9, color:DIM, marginTop:4 }}>Auto-pulled from credit report when available. Manual entry coming soon.</div>
      </div>
    </div>
  );
}


// ─── REVIEW SUMMARY ──────────────────────────────────────────────────────────
function ReviewSummary({ form }) {
  const Section = ({ title, items }) => (
    <div style={{ marginBottom:12 }}>
      <div style={{ fontSize:9, fontWeight:700, color:GOLD, letterSpacing:".08em", textTransform:"uppercase", marginBottom:4, borderBottom:`1px solid ${BORDER}`, paddingBottom:4 }}>{title}</div>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(180px, 1fr))", gap:4 }}>
        {items.map(([label,val],i) => (
          <div key={i} style={{ fontSize:9 }}>
            <span style={{ color:DIM }}>{label}: </span>
            <span style={{ color:BRIGHT }}>{val||"—"}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const totalIncome = (Number(form.monthly_base)||0)+(Number(form.monthly_overtime)||0)+(Number(form.monthly_bonus)||0)+(Number(form.monthly_commission)||0)+(Number(form.self_employment_income)||0);
  const totalAssets = (form.bank_accounts||[]).reduce((s,a)=>s+(Number(a.balance)||0),0)+(form.investment_accounts||[]).reduce((s,a)=>s+(Number(a.balance)||0),0);

  return (
    <div>
      <Section title="Borrower" items={[
        ["Name",`${form.first_name} ${form.middle_name} ${form.last_name} ${form.suffix}`.trim()],
        ["DOB",form.dob], ["Phone",form.phone], ["Email",form.email],
        ["Address",`${form.address}, ${form.city}, ${form.state} ${form.zip}`],
        ["Housing",form.housing_type], ["Marital",form.marital_status], ["Dependents",form.dependents]
      ]} />
      <Section title="Employment & Income" items={[
        ["Employer",form.employer_name], ["Position",form.position_title],
        ["Start",form.employment_start], ["Monthly Income", fmtMoney(totalIncome)],
      ]} />
      <Section title="Assets" items={[
        ["Bank Accounts",`${(form.bank_accounts||[]).length} acct(s)`],
        ["Total Assets",fmtMoney(totalAssets)],
        ["Properties Owned",(form.real_estate_owned||[]).length],
      ]} />
      <Section title="Property & Loan" items={[
        ["Property",form.property_address ? `${form.property_address}, ${form.property_city}, ${form.property_state} ${form.property_zip}` : "—"],
        ["Purchase Price",fmtMoney(form.purchase_price)], ["Loan Amount",fmtMoney(form.loan_amount)],
        ["Down Payment",fmtMoney(form.down_payment)], ["Purpose",form.loan_purpose],
        ["Type",form.property_type], ["Occupancy",form.occupancy],
        ["Program",form.loan_program], ["Lender",form.lender],
        ["Rate",form.rate?form.rate+"%":"—"], ["LTV",form.ltv?form.ltv+"%":"—"], ["FICO",form.fico||"—"],
      ]} />
      <Section title="Declarations" items={
        Object.entries(form.declarations||{}).map(([k,v]) => [k.replace(/_/g," "), v?"YES":"NO"])
      } />
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 4: DOCUMENT CENTER
// ═══════════════════════════════════════════════════════════════════════════════
function DocumentCenterTab({ loans, loanDocs, loadDocs, showToast }) {
  const [selLoanId, setSelLoanId] = useState("");
  const [docs, setDocs] = useState([]);
  const [uploading, setUploading] = useState(null);

  useEffect(() => {
    if (selLoanId) {
      loadDocs(selLoanId);
    }
  }, [selLoanId, loadDocs]);

  useEffect(() => { setDocs(loanDocs); }, [loanDocs]);

  const activeLoan = loans.find(l => l.id===selLoanId);

  // Group docs by category
  const grouped = useMemo(() => {
    const m = {};
    (docs||[]).forEach(d => {
      if (!m[d.category]) m[d.category]=[];
      m[d.category].push(d);
    });
    return m;
  }, [docs]);

  const totalDocs = docs.length;
  const receivedDocs = docs.filter(d => d.status!=="Missing").length;
  const missingDocs = docs.filter(d => d.status==="Missing").length;
  const pct = totalDocs ? Math.round((receivedDocs/totalDocs)*100) : 0;

  const updateDocStatus = async (docId, status) => {
    const updates = { status, received_at: status!=="Missing" ? new Date().toISOString() : null };
    await sbUpdate("vault_loan_documents", docId, updates);
    loadDocs(selLoanId);
    // Update loan doc_completion_pct
    const allDocs = await sbFetch("vault_loan_documents",`?loan_id=eq.${selLoanId}`);
    const total = allDocs.length;
    const done = allDocs.filter(d=>d.status!=="Missing").length;
    const newPct = total ? Math.round((done/total)*100) : 0;
    await sbUpdate("vault_loans", selLoanId, { doc_completion_pct:newPct });
    if (showToast) showToast("Document status updated","success");
  };

  const handleUpload = async (docId, file) => {
    if (!file) return;
    setUploading(docId);
    try {
      const path = `loans/${selLoanId}/${Date.now()}_${file.name}`;
      const r = await fetch(`${SB_URL}/storage/v1/object/vault-documents/${path}`, {
        method:"POST",
        headers:{ apikey:SB_KEY, Authorization:`Bearer ${SB_KEY}`, "Content-Type":file.type },
        body:file
      });
      if (r.ok) {
        const fileUrl = `${SB_URL}/storage/v1/object/public/vault-documents/${path}`;
        await sbUpdate("vault_loan_documents", docId, { file_url:fileUrl, status:"Received", received_at:new Date().toISOString() });
        loadDocs(selLoanId);
        if (showToast) showToast("Document uploaded","success");
      } else {
        if (showToast) showToast("Upload failed","error");
      }
    } catch(e) { console.error(e); if (showToast) showToast("Upload error","error"); }
    setUploading(null);
  };

  const updateDocNotes = async (docId, notes) => {
    await sbUpdate("vault_loan_documents", docId, { notes });
  };

  const sendDocRequest = () => {
    if (!activeLoan) return;
    const missing = docs.filter(d=>d.status==="Missing").map(d=>d.doc_name);
    const body = `Hello ${activeLoan.first_name},\n\nWe still need the following documents for your loan application:\n\n${missing.map(m=>"- "+m).join("\n")}\n\nPlease upload or send these at your earliest convenience.\n\nThank you.`;
    if (activeLoan.email) {
      window.open(`mailto:${activeLoan.email}?subject=Missing Loan Documents&body=${encodeURIComponent(body)}`);
    } else {
      navigator.clipboard.writeText(body);
      if (showToast) showToast("Doc request copied to clipboard","success");
    }
  };

  const statusColors = { Missing:RED, Received:GREEN, "Under Review":YELLOW, Approved:BLUE };

  return (
    <div>
      {/* Loan Selector */}
      <div style={{ display:"flex", gap:10, alignItems:"center", marginBottom:14, flexWrap:"wrap" }}>
        <label style={{ ...labelS, marginBottom:0 }}>SELECT LOAN:</label>
        <select value={selLoanId} onChange={e=>setSelLoanId(e.target.value)} style={{ ...selectS, maxWidth:320 }}>
          <option value="">Choose a loan...</option>
          {loans.map(l => (
            <option key={l.id} value={l.id}>{l.first_name} {l.last_name} — {fmtMoney(l.loan_amount)} ({l.stage})</option>
          ))}
        </select>
        {selLoanId && (
          <>
            <button onClick={sendDocRequest} style={btnSmS}>📧 Send Doc Request</button>
            <button onClick={()=>{ if(showToast) showToast("Download all - coming soon","info"); }} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>⬇ Download All</button>
          </>
        )}
      </div>

      {!selLoanId && (
        <div style={{ ...cardS, textAlign:"center", padding:60 }}>
          <div style={{ fontSize:48, marginBottom:12, opacity:.3, color:GOLD }}>&#128193;</div>
          <div style={{ fontSize:14, color:DIM }}>Select a loan above to view and manage documents.</div>
        </div>
      )}

      {selLoanId && (
        <>
          {/* Stats */}
          <div style={{ display:"flex", gap:14, marginBottom:20, flexWrap:"wrap" }}>
            <div style={{ ...cardS, flex:"1 1 200px", borderLeft:`3px solid ${GOLD}` }}>
              <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Documents Collected</div>
              <div style={{ fontSize:28, fontWeight:700, color:GOLD, marginTop:6 }}>{receivedDocs} / {totalDocs}</div>
              <div style={{ background:"rgba(255,255,255,0.06)", borderRadius:4, height:6, marginTop:8 }}>
                <div style={{ background:GREEN, height:6, borderRadius:4, width:`${pct}%`, transition:"width .3s" }} />
              </div>
            </div>
            <div style={{ ...cardS, flex:"1 1 140px", borderLeft:`3px solid ${RED}` }}>
              <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Missing</div>
              <div style={{ fontSize:28, fontWeight:700, color:RED, marginTop:6 }}>{missingDocs}</div>
            </div>
            <div style={{ ...cardS, flex:"1 1 140px", borderLeft:`3px solid ${pct>=80?GREEN:pct>=50?YELLOW:RED}` }}>
              <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Completion</div>
              <div style={{ fontSize:28, fontWeight:700, color:pct>=80?GREEN:pct>=50?YELLOW:RED, marginTop:6 }}>{pct}%</div>
            </div>
            <div style={{ ...cardS, flex:"1 1 200px", borderLeft:`3px solid ${BLUE}` }}>
              <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Last Upload</div>
              <div style={{ fontSize:13, fontWeight:600, color:BRIGHT, marginTop:6 }}>
                {(() => {
                  const received = docs.filter(d=>d.received_at).sort((a,b)=>new Date(b.received_at)-new Date(a.received_at));
                  if (received.length===0) return "None";
                  const last = received[0];
                  const daysAgo = daysBetween(last.received_at);
                  return `${daysAgo===0?"Today":daysAgo===1?"Yesterday":daysAgo+"d ago"} — ${last.doc_name}`;
                })()}
              </div>
            </div>
          </div>

          {/* Borrower info bar */}
          {activeLoan && (
            <div style={{ ...cardS, marginBottom:10, display:"flex", gap:16, alignItems:"center", flexWrap:"wrap" }}>
              <div style={{ fontSize:10, fontWeight:600, color:BRIGHT }}>{activeLoan.first_name} {activeLoan.last_name}</div>
              <span style={badgeS(BLUE)}>{activeLoan.stage}</span>
              <span style={{ fontSize:9, color:GOLD }}>{fmtMoney(activeLoan.loan_amount)}</span>
              {activeLoan.property_address && <span style={{ fontSize:9, color:DIM }}>{activeLoan.property_address}</span>}
              {activeLoan.email && <span style={{ fontSize:9, color:DIM }}>{activeLoan.email}</span>}
              {activeLoan.phone && <span style={{ fontSize:9, color:DIM }}>{activeLoan.phone}</span>}
            </div>
          )}

          {/* Doc Checklist by Category */}
          {Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} style={{ ...cardS, marginBottom:10 }}>
              <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:8 }}>{cat}</div>
              {items.map(doc => (
                <div key={doc.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}22`, flexWrap:"wrap" }}>
                  {/* Checkbox */}
                  <div onClick={()=>updateDocStatus(doc.id, doc.status==="Missing"?"Received":"Missing")} style={{
                    width:16, height:16, borderRadius:3, border:`1px solid ${doc.status!=="Missing"?GREEN:BORDER}`,
                    background:doc.status!=="Missing"?GREEN+"22":"transparent", cursor:"pointer",
                    display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:GREEN, flexShrink:0
                  }}>
                    {doc.status!=="Missing" && "✓"}
                  </div>
                  {/* Name */}
                  <div style={{ flex:"1 1 160px", fontSize:10, color:doc.status==="Missing"?DIM:BRIGHT }}>{doc.doc_name}</div>
                  {/* Status badge */}
                  <select value={doc.status} onChange={e=>updateDocStatus(doc.id,e.target.value)} style={{ ...selectS, width:110, fontSize:8, color:statusColors[doc.status]||TXT }}>
                    <option value="Missing">Missing</option>
                    <option value="Received">Received</option>
                    <option value="Under Review">Under Review</option>
                    <option value="Approved">Approved</option>
                  </select>
                  {/* Upload */}
                  <label style={{ ...btnSmS, fontSize:8, display:"inline-flex", alignItems:"center", gap:3, cursor:"pointer", opacity:uploading===doc.id?.5:1 }}>
                    📎 Upload
                    <input type="file" style={{ display:"none" }} onChange={e=>handleUpload(doc.id,e.target.files[0])} />
                  </label>
                  {/* View */}
                  {doc.file_url && (
                    <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={{ fontSize:8, color:BLUE, textDecoration:"none" }}>View</a>
                  )}
                  {/* Notes */}
                  <input value={doc.notes||""} onChange={e=>{ const v=e.target.value; setDocs(p=>p.map(d=>d.id===doc.id?{...d,notes:v}:d)); }} onBlur={e=>updateDocNotes(doc.id,e.target.value)} placeholder="Notes..." style={{ ...inputS, width:120, fontSize:8 }} />
                  {/* Date */}
                  {doc.received_at && <span style={{ fontSize:7, color:DIM }}>{new Date(doc.received_at).toLocaleDateString()}</span>}
                </div>
              ))}
            </div>
          ))}

          {Object.keys(grouped).length===0 && (
            <div style={{ ...cardS, textAlign:"center", padding:24 }}>
              <div style={{ fontSize:10, color:DIM, marginBottom:10 }}>No documents in checklist yet.</div>
              <button onClick={async ()=>{
                const docs = [];
                Object.entries(DOC_CHECKLIST).forEach(([cat, items]) => {
                  items.forEach(name => { docs.push({ loan_id:selLoanId, category:cat, doc_name:name, status:"Missing" }); });
                });
                for (const d of docs) { await sbInsert("vault_loan_documents", d); }
                loadDocs(selLoanId);
                if (showToast) showToast("Document checklist generated","success");
              }} style={btnS}>Generate Document Checklist</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// TAB 5: INSURANCE (Wolf Surety Integration)
// ═══════════════════════════════════════════════════════════════════════════════
function InsuranceTab({ loans, showToast }) {
  const [policies, setPolicies] = useState([]);
  const [loading, setLoading] = useState(true);
  const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:20, boxShadow:"0 4px 24px rgba(0,0,0,0.3)", transition:"all 0.2s ease" };

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`${SB_URL}/rest/v1/ws_policies?select=*&order=expiration_date.asc&limit=50`, { headers:SBH });
        if (r.ok) setPolicies(await r.json());
      } catch {}
      setLoading(false);
    })();
  }, []);

  const now = new Date();
  const in30 = new Date(now.getTime() + 30*86400000);
  const in90 = new Date(now.getTime() + 90*86400000);
  const expiring30 = policies.filter(p => p.expiration_date && new Date(p.expiration_date) <= in30 && new Date(p.expiration_date) >= now);
  const expiring90 = policies.filter(p => p.expiration_date && new Date(p.expiration_date) <= in90 && new Date(p.expiration_date) >= now);
  const active = policies.filter(p => !p.expiration_date || new Date(p.expiration_date) >= now);
  const loansWithoutInsurance = loans.filter(l => !l.insurance_status || l.insurance_status === "none");

  const triggerQuote = async (loan) => {
    try {
      await fetch(`${SB_URL}/rest/v1/ws_quote_requests`, {
        method:"POST", headers:SBH,
        body:JSON.stringify({
          client_name: `${loan.first_name} ${loan.last_name}`,
          client_email: loan.email || "",
          line_of_business: "Homeowners",
          status: "new",
          source: "mortgage-pos",
          notes: `Auto-generated from loan. Property: ${loan.property_address || "N/A"}. Loan: ${fmtMoney(loan.loan_amount)}`,
        })
      });
      if (showToast) showToast("Insurance quote requested for " + loan.first_name);
    } catch { if (showToast) showToast("Error creating quote request"); }
  };

  return (
    <div>
      {/* Stats */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        {[
          { label:"Active Policies", val:active.length, color:GREEN },
          { label:"Expiring 30d", val:expiring30.length, color:expiring30.length ? RED : GREEN },
          { label:"Expiring 90d", val:expiring90.length, color:expiring90.length ? YELLOW : GREEN },
          { label:"Loans w/o Insurance", val:loansWithoutInsurance.length, color:loansWithoutInsurance.length ? RED : GREEN },
        ].map(s => (
          <div key={s.label} style={{ ...cardS, flex:1, minWidth:160, textAlign:"center", borderLeft:`3px solid ${s.color}` }}>
            <div style={{ fontSize:10, color:DIM, textTransform:"uppercase", letterSpacing:".08em" }}>{s.label}</div>
            <div style={{ fontSize:28, fontWeight:700, color:s.color, marginTop:6 }}>{s.val}</div>
          </div>
        ))}
      </div>

      {/* Loans needing insurance */}
      {loansWithoutInsurance.length > 0 && (
        <div style={{ ...cardS, marginBottom:12, borderColor:"rgba(239,68,68,.3)" }}>
          <div style={{ fontSize:10, fontWeight:700, color:RED, marginBottom:8 }}>⚠️ Loans Without Insurance</div>
          {loansWithoutInsurance.map(l => (
            <div key={l.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}` }}>
              <div>
                <div style={{ fontSize:9, color:BRIGHT, fontWeight:600 }}>{l.first_name} {l.last_name}</div>
                <div style={{ fontSize:8, color:DIM }}>{l.property_address || "No address"} · {fmtMoney(l.loan_amount)}</div>
              </div>
              <button onClick={() => triggerQuote(l)} style={{ background:GOLD, border:"none", color:"#000", fontSize:8, fontWeight:700, padding:"4px 10px", borderRadius:3, cursor:"pointer", fontFamily:"inherit" }}>
                🛡 Get Quote
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Upcoming Renewals */}
      <div style={cardS}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, marginBottom:10, textTransform:"uppercase", letterSpacing:".06em" }}>🔄 Upcoming Renewals</div>
        {expiring90.length === 0 && <div style={{ fontSize:9, color:DIM, padding:20, textAlign:"center" }}>No upcoming renewals in next 90 days</div>}
        {expiring90.map(p => {
          const exp = new Date(p.expiration_date);
          const days = Math.ceil((exp - now) / 86400000);
          const dotColor = days <= 14 ? RED : days <= 30 ? YELLOW : GREEN;
          return (
            <div key={p.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}` }}>
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <span style={{ fontSize:10 }}>{days<=14?"🔴":days<=30?"🟡":"🟢"}</span>
                <div>
                  <div style={{ fontSize:9, color:BRIGHT, fontWeight:600 }}>{p.client_name}</div>
                  <div style={{ fontSize:8, color:DIM }}>{p.carrier} · {p.line_of_business} · {fmtMoney(p.premium)}</div>
                </div>
              </div>
              <div style={{ textAlign:"right" }}>
                <div style={{ fontSize:9, color:dotColor, fontWeight:600 }}>{days}d</div>
                <div style={{ fontSize:7, color:DIM }}>{exp.toLocaleDateString()}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* All Policies */}
      <div style={{ ...cardS, marginTop:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, marginBottom:10, textTransform:"uppercase", letterSpacing:".06em" }}>All Policies ({policies.length})</div>
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
            <thead>
              <tr style={{ borderBottom:`2px solid ${BORDER}` }}>
                <th style={{ textAlign:"left", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Client</th>
                <th style={{ textAlign:"left", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Carrier</th>
                <th style={{ textAlign:"left", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Type</th>
                <th style={{ textAlign:"left", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Policy #</th>
                <th style={{ textAlign:"right", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Premium</th>
                <th style={{ textAlign:"center", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Effective</th>
                <th style={{ textAlign:"center", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Expires</th>
                <th style={{ textAlign:"center", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={8} style={{ padding:20, textAlign:"center", color:DIM, fontSize:9 }}>Loading...</td></tr>}
              {!loading && policies.map(p => {
                const statusColor = p.status==="active"?GREEN:p.status==="expired"?RED:p.status==="cancelled"?"#f59e0b":DIM;
                return (
                  <tr key={p.id} style={{ borderBottom:`1px solid ${BORDER}`, transition:"background .15s", cursor:"pointer" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(212,175,55,.05)"}
                    onMouseLeave={e=>e.currentTarget.style.background="none"}>
                    <td style={{ padding:"8px", color:BRIGHT, fontWeight:600 }}>{p.client_name}</td>
                    <td style={{ padding:"8px", color:TXT }}>{p.carrier_name||p.carrier||"—"}</td>
                    <td style={{ padding:"8px" }}><span style={{ background:"rgba(212,175,55,.12)", color:GOLD, padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:600 }}>{(p.line_of_business||p.policy_type||"—").replace(/_/g," ")}</span></td>
                    <td style={{ padding:"8px", color:DIM, fontFamily:"monospace", fontSize:8 }}>{p.policy_number||"—"}</td>
                    <td style={{ padding:"8px", textAlign:"right", color:GOLD, fontWeight:700 }}>{fmtMoney(p.premium)}</td>
                    <td style={{ padding:"8px", textAlign:"center", color:DIM, fontSize:8 }}>{p.effective_date?new Date(p.effective_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}):"—"}</td>
                    <td style={{ padding:"8px", textAlign:"center", color:DIM, fontSize:8 }}>{p.expiration_date?new Date(p.expiration_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"2-digit"}):"—"}</td>
                    <td style={{ padding:"8px", textAlign:"center" }}><span style={{ background:statusColor+"22", color:statusColor, padding:"2px 8px", borderRadius:10, fontSize:8, fontWeight:600, textTransform:"capitalize" }}>{p.status||"—"}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6: CREDIT REPAIR (Dispute Inc Integration)
// ═══════════════════════════════════════════════════════════════════════════════
function CreditRepairTab({ loans, contacts, showToast }) {
  // ─── STATE ────────────────────────────────────────────────────────────────────
  const [clients, setClients] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [subTab, setSubTab] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name:"",email:"",phone:"",ssn_last4:"",address:"",city:"",state:"",zip:"",score_tu:0,score_exp:0,score_eqf:0,goal_score:700,monthly_fee:99,notes:"",status:"enrolled" });
  const [selectedClient, setSelectedClient] = useState(null);
  const [editingClient, setEditingClient] = useState(null);

  // Dispute Engine state
  const [tradelines, setTradelines] = useState([]);
  const [selectedItems, setSelectedItems] = useState({});
  const [disputeStrategies, setDisputeStrategies] = useState({});
  const [generatedLetters, setGeneratedLetters] = useState([]);
  const [disputeStep, setDisputeStep] = useState(0);
  const [manualTradeline, setManualTradeline] = useState({ creditor:"",account_num:"",balance:"",payment:"",status:"Open",type:"Revolving",date_opened:"",last_reported:"",remarks:"" });

  // ID Theft state
  const [idTheft, setIdTheft] = useState({ ftc_report_num:"",ftc_date:"",police_report_num:"",police_date:"",ftc_filed:false,police_filed:false,freeze_tu:false,freeze_exp:false,freeze_eqf:false,freeze_nctue:false,freeze_chex:false,pin_tu:"",pin_exp:"",pin_eqf:"",pin_nctue:"",pin_chex:"",fraud_alert_type:"",fraud_alert_expires:"",fraudulent_accounts:[] });
  const [newFraudAcct, setNewFraudAcct] = useState({ creditor:"",account_num:"",balance:"",date_opened:"" });

  // Round Tracker state
  const [roundDetail, setRoundDetail] = useState(null);
  const [roundForm, setRoundForm] = useState({ items_disputed:[],letters_sent_at:"",bureau_responses:{},items_removed:0,items_updated:0,items_verified:0,score_tu_after:0,score_exp_after:0,score_eqf_after:0,notes:"" });

  // Letter Templates state
  const [templateCategory, setTemplateCategory] = useState("609");
  const [templateVariation, setTemplateVariation] = useState(0);
  const [editableTemplate, setEditableTemplate] = useState("");

  // ─── STYLES ───────────────────────────────────────────────────────────────────
  const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:20, boxShadow:"0 4px 24px rgba(0,0,0,0.3)", transition:"all 0.2s ease" };
  const inputS = { background:INPUT_BG, border:`1px solid ${INPUT_BD}`, color:TXT, padding:"10px 14px", fontSize:12, borderRadius:8, width:"100%", fontFamily:"inherit", boxSizing:"border-box", transition:"all 0.15s ease", lineHeight:1.5 };
  const btnGold = { background:GOLD, border:"none", color:"#0a0a12", fontSize:12, fontWeight:600, padding:"10px 20px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s ease" };
  const btnOutline = { background:"none", border:`1px solid rgba(212,175,55,0.3)`, color:TXT, fontSize:11, padding:"8px 16px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s ease" };
  const btnDanger = { background:"rgba(239,68,68,.12)", border:`1px solid rgba(239,68,68,.3)`, color:RED, fontSize:11, fontWeight:600, padding:"8px 16px", borderRadius:8, cursor:"pointer", fontFamily:"inherit", transition:"all 0.2s ease" };
  const labelS = { fontSize:11, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:6, fontWeight:600 };
  const sectionTitle = (txt,col) => ({ fontSize:13, fontWeight:600, color:col||GOLD, marginBottom:12, letterSpacing:".05em" });
  const lowFicoLoans = loans.filter(l => l.fico && l.fico < 680);
  const statusColors = { active:GREEN, enrolled:"#6366f1", graduated:GOLD, cancelled:RED, pending:DIM };

  // ─── DATA LOADING ─────────────────────────────────────────────────────────────
  useEffect(() => {
    sbFetch("vault_credit_repair_clients","?order=created_at.desc").then(d => setClients(d||[]));
  }, []);

  useEffect(() => {
    if (selectedClient) sbFetch("vault_credit_repair_rounds",`?client_id=eq.${selectedClient.id}&order=round_number.asc`).then(d => setRounds(d||[]));
  }, [selectedClient]);

  // ─── BUREAU ADDRESSES ─────────────────────────────────────────────────────────
  const BUREAU_ADDRS = {
    TransUnion: { name:"TransUnion LLC", dept:"Consumer Dispute Center", po:"P.O. Box 2000", city:"Chester, PA 19016" },
    Experian: { name:"Experian", dept:"National Consumer Assistance Center", po:"P.O. Box 4500", city:"Allen, TX 75013" },
    Equifax: { name:"Equifax Information Services LLC", dept:"Consumer Dispute Center", po:"P.O. Box 740256", city:"Atlanta, GA 30374" }
  };
  const fmtBureauAddr = (b) => { const a = BUREAU_ADDRS[b]; return a ? `${a.name}\n${a.dept}\n${a.po}\n${a.city}` : b; };
  const fmtBureauBlock = (b) => { const a = BUREAU_ADDRS[b]; return a ? `${a.name}, ${a.po}, ${a.city}` : b; };

  // ─── CLIENT CRUD ──────────────────────────────────────────────────────────────
  const addClient = async () => {
    if (!form.name) return;
    const r = await sbInsert("vault_credit_repair_clients", form);
    if (r) { setClients([r,...clients]); setShowNew(false); setForm({ name:"",email:"",phone:"",ssn_last4:"",address:"",city:"",state:"",zip:"",score_tu:0,score_exp:0,score_eqf:0,goal_score:700,monthly_fee:99,notes:"",status:"enrolled" }); if(showToast) showToast("Client enrolled"); }
  };

  const updateClient = async (id, updates) => {
    const r = await sbUpdate("vault_credit_repair_clients", id, updates);
    if (r) {
      setClients(clients.map(c => c.id === id ? { ...c, ...updates } : c));
      if (selectedClient && selectedClient.id === id) setSelectedClient({ ...selectedClient, ...updates });
      if(showToast) showToast("Client updated");
    }
  };

  const enrollFromLoan = (loan) => {
    setForm({ name:`${loan.first_name||""} ${loan.last_name||""}`.trim(), email:loan.email||"", phone:loan.phone||"", ssn_last4:"", address:loan.address||"", city:loan.city||"", state:loan.state||"", zip:loan.zip||"", score_tu:loan.fico||0, score_exp:loan.fico||0, score_eqf:loan.fico||0, goal_score:700, monthly_fee:99, notes:`From loan ${fmtMoney(loan.loan_amount)}`, status:"enrolled" });
    setShowNew(true);
  };

  // ─── ROUND CRUD ───────────────────────────────────────────────────────────────
  const addRound = async () => {
    if (!selectedClient) return;
    const num = rounds.length + 1;
    const r = await sbInsert("vault_credit_repair_rounds", { client_id:selectedClient.id, round_number:num, status:"pending", items_disputed:[], bureau_responses:{} });
    if (r) { setRounds([...rounds, r]); if(showToast) showToast(`Round ${num} created`); }
  };

  const updateRound = async (id, updates) => {
    const r = await sbUpdate("vault_credit_repair_rounds", id, updates);
    if (r) {
      setRounds(rounds.map(rd => rd.id === id ? { ...rd, ...updates } : rd));
      if(showToast) showToast("Round updated");
    }
  };

  // ─── TRADELINE PARSING ────────────────────────────────────────────────────────
  const parseHTMLReport = (htmlStr) => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(htmlStr, "text/html");
      const items = [];
      const rows = doc.querySelectorAll("tr, .account-row, .tradeline, [class*='account'], [class*='trade']");
      const textContent = doc.body ? doc.body.textContent : "";
      const lines = textContent.split("\n").map(l => l.trim()).filter(Boolean);
      let current = null;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (/^(creditor|company|account\s*name|furnisher)/i.test(line) && i + 1 < lines.length) {
          if (current && current.creditor) items.push(current);
          current = { creditor:lines[i+1], account_num:"", balance:"", payment:"", status:"Open", type:"Revolving", date_opened:"", last_reported:"", remarks:"", selected:false };
        }
        if (current) {
          if (/account\s*#|account\s*number/i.test(line) && i+1 < lines.length) current.account_num = lines[i+1];
          if (/balance/i.test(line) && i+1 < lines.length) current.balance = lines[i+1].replace(/[^0-9.,$-]/g,"");
          if (/payment|monthly/i.test(line) && i+1 < lines.length) current.payment = lines[i+1].replace(/[^0-9.,$-]/g,"");
          if (/status|condition/i.test(line) && i+1 < lines.length) current.status = lines[i+1];
          if (/type|account\s*type/i.test(line) && i+1 < lines.length) current.type = lines[i+1];
          if (/opened|date\s*opened/i.test(line) && i+1 < lines.length) current.date_opened = lines[i+1];
          if (/reported|last\s*reported/i.test(line) && i+1 < lines.length) current.last_reported = lines[i+1];
          if (/remarks|comment/i.test(line) && i+1 < lines.length) current.remarks = lines[i+1];
        }
      }
      if (current && current.creditor) items.push(current);
      return items;
    } catch(e) { return []; }
  };

  const handleFileImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const parsed = parseHTMLReport(ev.target.result);
      if (parsed.length > 0) {
        setTradelines(parsed);
        if(showToast) showToast(`Imported ${parsed.length} tradelines`);
      } else {
        if(showToast) showToast("Could not parse tradelines. Try manual entry.");
      }
    };
    reader.readAsText(file);
  };

  const addManualTradeline = () => {
    if (!manualTradeline.creditor) return;
    setTradelines([...tradelines, { ...manualTradeline, selected:false }]);
    setManualTradeline({ creditor:"",account_num:"",balance:"",payment:"",status:"Open",type:"Revolving",date_opened:"",last_reported:"",remarks:"" });
  };

  const toggleTradelineSelect = (idx) => {
    const updated = [...tradelines];
    updated[idx] = { ...updated[idx], selected:!updated[idx].selected };
    setTradelines(updated);
  };

  const selectAllTradelines = () => {
    const allSelected = tradelines.every(t => t.selected);
    setTradelines(tradelines.map(t => ({ ...t, selected:!allSelected })));
  };

  // ─── AI DISPUTE STRATEGY AUTO-DETECT ──────────────────────────────────────────
  const STRATEGY_TYPES = {
    "609": { label:"FCRA 609 - Verification Request", color:"#3b82f6", desc:"Request original signed agreement and method of verification" },
    "611": { label:"FCRA 611 - Formal Dispute", color:PURPLE, desc:"Dispute specific inaccuracies with factual basis" },
    "605b": { label:"FCRA 605B - ID Theft Block", color:RED, desc:"Block fraudulent accounts within 4 business days" },
    "623": { label:"FCRA 623 - Direct Furnisher Dispute", color:ORANGE, desc:"Dispute directly with the creditor after bureau fails" },
    "fdcpa": { label:"FDCPA Debt Validation", color:YELLOW, desc:"Demand validation of debt from collector" },
    "goodwill": { label:"Goodwill Removal Request", color:GREEN, desc:"Appeal to remove negative mark on paid account" },
    "pfd": { label:"Pay-for-Delete Negotiation", color:GOLD, desc:"Offer payment in exchange for removal" }
  };

  const autoDetectStrategy = (item) => {
    const st = (item.status || "").toLowerCase();
    const rm = (item.remarks || "").toLowerCase();
    const tp = (item.type || "").toLowerCase();
    const bal = parseFloat((item.balance||"0").replace(/[$,]/g,"")) || 0;
    if (rm.includes("fraud") || rm.includes("identity theft") || rm.includes("not mine")) return "605b";
    if (tp.includes("collection") || rm.includes("collection") || rm.includes("placed for collection")) return "fdcpa";
    if (st.includes("paid") || st.includes("settled") || st.includes("closed") && bal === 0) return "goodwill";
    if (rm.includes("late") || rm.includes("delinq") || rm.includes("past due")) {
      if (bal > 0) return "pfd";
      return "goodwill";
    }
    if (rm.includes("inaccurate") || rm.includes("wrong") || rm.includes("incorrect") || rm.includes("duplicate")) return "611";
    return "609";
  };

  const runAutoStrategy = () => {
    const strats = {};
    tradelines.forEach((t, i) => {
      if (t.selected) strats[i] = autoDetectStrategy(t);
    });
    setDisputeStrategies(strats);
    setDisputeStep(2);
  };

  // ─── HUMANIZED LETTER GENERATION ENGINE ───────────────────────────────────────
  const _seed = (s) => { let h=0; for(let i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;} return Math.abs(h); };
  const _pick = (arr, seed) => arr[seed % arr.length];

  const TONES = ["frustrated","confused","professional","first_time"];
  const FORMATS = ["formal","email","bullets","narrative"];

  const OPENINGS = {
    frustrated: [
      "I am writing because I recently reviewed my credit report and was quite concerned to find information that does not accurately reflect my credit history.",
      "After pulling my credit report, I was frustrated to discover what appears to be inaccurate information that is unfairly damaging my credit standing.",
      "I have been working hard to maintain good credit, so you can imagine my disappointment when I reviewed my report and found discrepancies that need to be addressed."
    ],
    confused: [
      "I recently obtained a copy of my credit report and I am confused by some of the information listed. I do not recognize or agree with certain items.",
      "While reviewing my credit file, I came across some entries that I do not understand and believe may be reporting incorrectly.",
      "I am reaching out because after looking through my credit report for the first time in a while, I noticed some items that do not look right to me."
    ],
    professional: [
      "This letter serves as a formal notification regarding inaccuracies identified on my credit report maintained by your bureau.",
      "I am writing to formally bring to your attention certain items on my credit report that require investigation and correction.",
      "Please accept this correspondence as my formal request to investigate and address the following discrepancies on my credit file."
    ],
    first_time: [
      "I recently checked my credit report for the first time in preparation for a major purchase, and I was surprised to find information that I believe is inaccurate.",
      "I am not very familiar with the credit dispute process, but after reviewing my report I noticed some things that do not seem correct and I would like your help getting them fixed.",
      "I am writing to you for the first time because I discovered some issues on my credit report that I need to bring to your attention."
    ]
  };

  const CLOSINGS_BUREAU = [
    "I expect this matter to be resolved within the 30-day timeframe as required by federal law. If this item cannot be properly verified, I request that it be promptly removed from my credit file. Please send me an updated copy of my report once your investigation is complete.",
    "Please investigate this matter thoroughly and provide me with the results within 30 days as mandated. Should you be unable to verify this information, I ask that it be deleted immediately. I also request a corrected copy of my credit report.",
    "I am requesting that you complete your investigation within the legally required timeframe. If the information cannot be substantiated, it must be removed. Please forward me a copy of my updated credit report and the method of verification used.",
    "I trust you will handle this matter with the urgency it deserves. If verification is not possible within 30 days, federal law requires deletion. Please update my file accordingly and send me confirmation of the changes."
  ];

  const CLOSINGS_CREDITOR = [
    "If I do not receive a satisfactory response within 30 days, I will have no choice but to escalate this matter to the Consumer Financial Protection Bureau and my state Attorney General's office.",
    "I expect a prompt resolution. Should you fail to investigate and respond appropriately, I am prepared to file formal complaints with the CFPB and relevant regulatory agencies.",
    "Please treat this matter with the seriousness it warrants. I have documented everything and will not hesitate to pursue all available remedies if this is not resolved.",
    "I look forward to your timely response. I have retained copies of all correspondence and will take additional action through regulatory channels if necessary."
  ];

  const CLOSINGS_GOODWILL = [
    "I understand you are under no obligation to make this change, but I would truly appreciate your consideration. This one mark is the only thing standing between me and my financial goals.",
    "I know this is an unusual request, and I am grateful for any consideration you can give. Removing this item would make a tremendous difference in my ability to move forward financially.",
    "Thank you for taking the time to review my situation. Any goodwill adjustment you can make would be deeply appreciated and would help me continue on the right financial path."
  ];

  const generate609Letter = (item, client, bureau, seed) => {
    const tone = _pick(TONES, seed);
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const opening = _pick(OPENINGS[tone], seed + 1);
    const closing = _pick(CLOSINGS_BUREAU, seed + 2);
    const acctRef = item.account_num ? `account number ending in ${item.account_num.slice(-4)}` : "the account referenced";

    const body = `Specifically, I am disputing the account listed under ${item.creditor} (${acctRef}). Under Section 609(a)(1)(A) of the Fair Credit Reporting Act, I have the right to request that you provide me with the original documentation used to verify this account.\n\nI am requesting the following:\n\n1. The original signed contract or agreement bearing my signature\n2. Complete payment history for this account from inception\n3. The method of verification used to confirm this information\n4. Any and all documentation from the original creditor substantiating this entry\n\nUntil these documents can be produced and verified, this account should not remain on my credit report. Reporting unverified information is a violation of the FCRA, and I expect this to be handled accordingly.`;

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${fmtBureauAddr(bureau)}\n\nRe: Request for Verification of Account — ${item.creditor}\n\nTo Whom It May Concern:\n\n${opening}\n\n${body}\n\n${closing}\n\nSincerely,\n\n${client.name}\nDate of Birth: [DOB]\nSSN: XXX-XX-${client.ssn_last4||"XXXX"}\n${client.phone||""}\n${client.email||""}`;
  };

  const generate611Letter = (item, client, bureau, seed) => {
    const tone = _pick(TONES, seed);
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const opening = _pick(OPENINGS[tone], seed + 3);
    const closing = _pick(CLOSINGS_BUREAU, seed + 4);
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "(see details below)";

    const reasons = [];
    const st = (item.status||"").toLowerCase();
    const rm = (item.remarks||"").toLowerCase();
    if (rm.includes("duplicate") || rm.includes("dup")) reasons.push("This account appears to be a duplicate of another entry already on my report");
    if (rm.includes("wrong") || rm.includes("incorrect")) reasons.push("The information being reported contains factual errors");
    if (st.includes("late") && !rm.includes("late")) reasons.push("The payment status is being reported incorrectly");
    if (reasons.length === 0) reasons.push("The account information as reported does not accurately reflect the true history of this account");

    const body = `I am formally disputing the following account under Section 611 of the Fair Credit Reporting Act:\n\nCreditor: ${item.creditor}\nAccount Number: ${acctRef}\nReported Balance: ${item.balance||"N/A"}\nAccount Status: ${item.status||"N/A"}\nDate Opened: ${item.date_opened||"N/A"}\n\nThe specific basis for my dispute is as follows:\n${reasons.map((r,i) => `\n${i+1}. ${r}`).join("")}\n\nPursuant to FCRA Section 611(a), you are required to conduct a reasonable investigation into this dispute and provide me with the results within 30 days. During your investigation, this item should be marked as "disputed" on my credit file. If the furnisher cannot substantiate the accuracy of this information, it must be corrected or deleted.`;

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${fmtBureauAddr(bureau)}\n\nRe: Formal Dispute of Inaccurate Information — ${item.creditor}\n\nTo Whom It May Concern:\n\n${opening}\n\n${body}\n\n${closing}\n\nSincerely,\n\n${client.name}\nSSN: XXX-XX-${client.ssn_last4||"XXXX"}\n${client.phone||""}\n${client.email||""}`;
  };

  const generate605bLetter = (item, client, bureau, seed) => {
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const closing = _pick(CLOSINGS_BUREAU, seed + 5);
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "(details below)";

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${fmtBureauAddr(bureau)}\n\nRe: Identity Theft — Request to Block Fraudulent Account Under FCRA Section 605B\n\nTo Whom It May Concern:\n\nI am a victim of identity theft and I am writing to request that you block the following fraudulent account from my credit report pursuant to Section 605B of the Fair Credit Reporting Act.\n\nFraudulent Account Details:\nCreditor: ${item.creditor}\nAccount Number: ${acctRef}\nReported Balance: ${item.balance||"N/A"}\nDate Opened: ${item.date_opened||"N/A"}\n\nI did not open this account, authorize anyone to open it on my behalf, nor did I benefit from it in any way. This account is the result of identity theft.\n\nEnclosed with this letter, please find:\n1. Copy of my FTC Identity Theft Report${idTheft.ftc_report_num ? ` (Report #${idTheft.ftc_report_num})` : ""}\n2. Copy of my police report${idTheft.police_report_num ? ` (Report #${idTheft.police_report_num})` : ""}\n3. Copy of my government-issued photo identification\n4. Proof of my current address\n\nUnder FCRA Section 605B, you are required to block this fraudulent information within four (4) business days of receiving this letter and the required documentation. You may not re-insert this blocked information unless you have reasonable grounds to believe the block was requested in error.\n\n${closing}\n\nSincerely,\n\n${client.name}\nSSN: XXX-XX-${client.ssn_last4||"XXXX"}\n${client.phone||""}\n${client.email||""}`;
  };

  const generate623Letter = (item, client, seed) => {
    const tone = _pick(TONES, seed);
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const opening = _pick(OPENINGS[tone], seed + 6);
    const closing = _pick(CLOSINGS_CREDITOR, seed + 7);
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "";

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${item.creditor}\nDispute Department\n[Creditor Address]\n\nRe: Direct Dispute Under FCRA Section 623 — Account ${acctRef}\n\nTo Whom It May Concern:\n\n${opening}\n\nI previously disputed this account through the credit bureaus, however it was verified without correction. I am now exercising my right under FCRA Section 623(a)(8) to dispute this information directly with you as the furnisher.\n\nAccount Details:\nCreditor: ${item.creditor}\nAccount Number: ${acctRef}\nReported Balance: ${item.balance||"N/A"}\nAccount Status: ${item.status||"N/A"}\n\nThe information you are furnishing to the credit reporting agencies regarding this account is inaccurate. Specifically, I believe the reported information does not reflect the true history or current status of this account.\n\nUnder FCRA Section 623(b), upon receiving this direct dispute, you are required to:\n1. Conduct a thorough investigation of the disputed information\n2. Review all relevant information provided\n3. Report the results to the credit reporting agencies\n4. Correct any information found to be inaccurate\n\n${closing}\n\nSincerely,\n\n${client.name}\nSSN: XXX-XX-${client.ssn_last4||"XXXX"}\n${client.phone||""}\n${client.email||""}`;
  };

  const generateFDCPALetter = (item, client, seed) => {
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const opening = _pick(OPENINGS.professional, seed + 8);
    const closing = _pick(CLOSINGS_CREDITOR, seed + 9);
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "";

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${item.creditor}\nDebt Validation Department\n[Collector Address]\n\nRe: Debt Validation Request Under FDCPA Section 809(b) — Account ${acctRef}\n\nTo Whom It May Concern:\n\n${opening}\n\nI am writing in response to the collection account you are reporting. Pursuant to Section 809(b) of the Fair Debt Collection Practices Act, I am requesting that you validate this alleged debt.\n\nPlease provide the following documentation:\n\n1. Verification of the exact amount claimed to be owed, including an itemized accounting of all charges, interest, and fees\n2. The name and address of the original creditor\n3. A copy of the original signed agreement between myself and the original creditor\n4. Proof that you are licensed to collect debts in my state\n5. Documentation showing the complete chain of ownership of this debt from the original creditor to your company\n6. Proof that the statute of limitations has not expired on this alleged debt\n\nUntil you have provided adequate validation, you must cease all collection activity on this account, including reporting to the credit bureaus. Continued reporting of unvalidated debt constitutes a violation of the FDCPA.\n\nPlease note that this is not a refusal to pay, but rather a request for validation as is my right under federal law.\n\n${closing}\n\nSincerely,\n\n${client.name}\n${client.phone||""}\n${client.email||""}`;
  };

  const generateGoodwillLetter = (item, client, seed) => {
    const tone = _pick(["first_time","confused"], seed);
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const closing = _pick(CLOSINGS_GOODWILL, seed + 10);
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "";

    const narratives = [
      "Looking back, the late payment was the result of circumstances beyond my control at the time. I was dealing with a temporary financial hardship that has since been fully resolved. Since then, I have been diligent about making every payment on time.",
      "I take full responsibility for the missed payment, which occurred during a difficult period in my life. I have since taken significant steps to improve my financial management and have maintained a perfect payment record.",
      "The negative mark on my account was an isolated incident that does not reflect my overall payment behavior. I have been a loyal customer and have consistently maintained my account in good standing both before and after this occurrence."
    ];

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${item.creditor}\nCustomer Relations Department\n[Creditor Address]\n\nRe: Goodwill Adjustment Request — Account ${acctRef}\n\nDear Sir or Madam:\n\nI am writing to kindly request a goodwill adjustment on my account with ${item.creditor}. I have been a customer and I value my relationship with your company.\n\n${_pick(narratives, seed + 11)}\n\nThe negative item on my credit report is preventing me from achieving important financial goals, and I am hoping that you might consider removing it as a gesture of goodwill. My account is currently ${item.status||"in good standing"} with a balance of ${item.balance||"$0"}.\n\n${closing}\n\nRespectfully,\n\n${client.name}\n${client.phone||""}\n${client.email||""}`;
  };

  const generatePFDLetter = (item, client, seed) => {
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const acctRef = item.account_num ? `ending in ${item.account_num.slice(-4)}` : "";
    const bal = item.balance || "[Amount]";

    const offers = [
      `I am prepared to make a payment of ${bal} to resolve this account, provided that you agree in writing to remove this account from all three major credit bureaus (TransUnion, Experian, and Equifax) upon receipt of payment.`,
      `I would like to propose a settlement arrangement: I will pay the outstanding balance of ${bal} in full, and in return, I am asking that you request deletion of this account from my credit reports with all three bureaus.`,
      `In an effort to resolve this matter, I am offering to pay ${bal} to satisfy this debt completely. My only condition is that upon receipt of payment, you submit a request to delete this tradeline from TransUnion, Experian, and Equifax.`
    ];

    return `${today}\n\n${client.name}\n${client.address||"[Your Address]"}\n${client.city||"[City]"}, ${client.state||"[ST]"} ${client.zip||"[ZIP]"}\n\n${item.creditor}\nSettlement Department\n[Creditor/Collector Address]\n\nRe: Pay-for-Delete Settlement Proposal — Account ${acctRef}\n\nTo Whom It May Concern:\n\nI am reaching out regarding the above-referenced account that is currently being reported on my credit file. I would like to find a mutually beneficial resolution.\n\n${_pick(offers, seed + 12)}\n\nPlease understand that this offer is contingent upon your written agreement to delete the account. Simply updating the status to "paid" or "settled" does not fulfill this request. I need complete deletion from all credit bureau reports.\n\nIf you agree to these terms, please respond in writing so that I can arrange payment promptly. This offer is valid for 30 days from the date of this letter.\n\nI look forward to resolving this matter amicably.\n\nSincerely,\n\n${client.name}\n${client.phone||""}\n${client.email||""}`;
  };

  // ─── MASTER LETTER GENERATOR ──────────────────────────────────────────────────
  const generateAllLetters = () => {
    if (!selectedClient) return;
    const letters = [];
    const bureaus = ["TransUnion","Experian","Equifax"];
    const now = Date.now();

    tradelines.forEach((item, idx) => {
      if (!item.selected) return;
      const strategy = disputeStrategies[idx] || "609";
      const seed = _seed(`${item.creditor}${item.account_num}${now}${idx}`);

      if (strategy === "605b" || strategy === "623" || strategy === "fdcpa" || strategy === "goodwill" || strategy === "pfd") {
        let letter = "";
        if (strategy === "605b") bureaus.forEach(b => { letter = generate605bLetter(item, selectedClient, b, seed); letters.push({ strategy, bureau:b, creditor:item.creditor, account:item.account_num, letter }); });
        else if (strategy === "623") { letter = generate623Letter(item, selectedClient, seed); letters.push({ strategy, bureau:"Creditor", creditor:item.creditor, account:item.account_num, letter }); }
        else if (strategy === "fdcpa") { letter = generateFDCPALetter(item, selectedClient, seed); letters.push({ strategy, bureau:"Collector", creditor:item.creditor, account:item.account_num, letter }); }
        else if (strategy === "goodwill") { letter = generateGoodwillLetter(item, selectedClient, seed); letters.push({ strategy, bureau:"Creditor", creditor:item.creditor, account:item.account_num, letter }); }
        else if (strategy === "pfd") { letter = generatePFDLetter(item, selectedClient, seed); letters.push({ strategy, bureau:"Creditor", creditor:item.creditor, account:item.account_num, letter }); }
      } else {
        bureaus.forEach(b => {
          const bSeed = seed + bureaus.indexOf(b) * 7;
          let letter = "";
          if (strategy === "609") letter = generate609Letter(item, selectedClient, b, bSeed);
          else if (strategy === "611") letter = generate611Letter(item, selectedClient, b, bSeed);
          letters.push({ strategy, bureau:b, creditor:item.creditor, account:item.account_num, letter });
        });
      }
    });

    setGeneratedLetters(letters);
    setDisputeStep(3);
  };

  const copyLetter = (txt) => { navigator.clipboard.writeText(txt); if(showToast) showToast("Letter copied to clipboard"); };
  const downloadLetter = (txt, name) => { const b=new Blob([txt],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=name;a.click();URL.revokeObjectURL(u); };
  const downloadAllLetters = () => { generatedLetters.forEach((l,i) => { setTimeout(()=>downloadLetter(l.letter,`dispute_${l.strategy}_${l.bureau}_${l.creditor.replace(/\s/g,"_")}_${i+1}.txt`), i*200); }); };

  // ─── LETTER TEMPLATES LIBRARY ─────────────────────────────────────────────────
  const TEMPLATES = {
    "609": {
      label: "FCRA 609 - Verification Request",
      variations: [
        { name:"Standard 609", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Request for Method of Verification — [CREDITOR NAME]\n\nTo Whom It May Concern:\n\nI am writing to request verification of the following account that appears on my credit report. Under Section 609(a)(1)(A) of the Fair Credit Reporting Act, I have the right to see any and all documentation used to verify this account.\n\nCreditor: [CREDITOR]\nAccount Number: [ACCOUNT NUMBER]\n\nPlease provide me with the following:\n1. Original signed agreement bearing my signature\n2. Complete payment history\n3. Method of verification used\n4. Name and contact of person who verified this information\n\nIf this information cannot be produced, I request that this item be immediately removed from my credit report.\n\nPlease send me an updated copy of my credit report once the investigation is complete.\n\nSincerely,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]\n[PHONE]\n[EMAIL]" },
        { name:"Detailed 609", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Formal Request for Account Verification Under Fair Credit Reporting Act\n\nDear Consumer Relations Department:\n\nI recently reviewed my credit report and found an account that I need verified. As a consumer, the FCRA grants me the right to request documentation.\n\nAccount in Question:\n- Company: [CREDITOR]\n- Account #: [ACCOUNT NUMBER]\n- Reported Balance: [BALANCE]\n- Account Status: [STATUS]\n\nI am exercising my rights under 15 U.S.C. Section 1681g to request:\n\n(a) The original application or signed contract for this account\n(b) A certified payment history from the date of origination\n(c) The specific method by which this account was verified as accurate\n(d) The name, address, and telephone number of each person contacted in connection with such information\n\nI understand you have 30 days to complete your investigation. If you cannot provide the requested documentation, this item must be deleted from my file.\n\nThank you for your prompt attention.\n\nRespectfully,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]" },
        { name:"Brief 609", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Verification Request — [CREDITOR]\n\nTo Whom It May Concern:\n\nI noticed an account on my credit report from [CREDITOR] (Account: [ACCOUNT NUMBER]) that I need verified.\n\nUnder FCRA Section 609, please provide the original documentation and method of verification for this account. If you cannot verify it with original documents within 30 days, please remove it.\n\nPlease send me updated results.\n\nThank you,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]\n[PHONE]" }
      ]
    },
    "611": {
      label: "FCRA 611 - Formal Dispute",
      variations: [
        { name:"Standard 611", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Formal Dispute Under FCRA Section 611\n\nTo Whom It May Concern:\n\nI am writing to formally dispute the accuracy of the following information on my credit report:\n\nCreditor: [CREDITOR]\nAccount Number: [ACCOUNT NUMBER]\nReason: [DISPUTE REASON]\n\nThis information is inaccurate because: [EXPLANATION]\n\nPursuant to Section 611 of the FCRA, you must investigate this dispute within 30 days and correct or delete any information that cannot be verified. During the investigation, this item must be marked as disputed.\n\nPlease send updated results.\n\nSincerely,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]" },
        { name:"Detailed 611 with Evidence", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Dispute of Inaccurate Credit Information — FCRA Section 611\n\nDear Dispute Department:\n\nI have identified inaccurate information on my credit file that requires immediate investigation.\n\nDisputed Account:\nCreditor: [CREDITOR]\nAccount #: [ACCOUNT NUMBER]\nBalance Reported: [BALANCE]\nStatus Reported: [STATUS]\nDate Opened: [DATE OPENED]\n\nThe specific inaccuracies are:\n1. [SPECIFIC ERROR 1]\n2. [SPECIFIC ERROR 2]\n\nEnclosed you will find supporting documentation that substantiates my dispute.\n\nUnder 15 U.S.C. 1681i, you are required to:\n- Forward all relevant information to the furnisher\n- Conduct a reasonable reinvestigation\n- Record the current status of the disputed information\n- Delete or modify information found to be inaccurate or unverifiable\n- Provide written results within 30 days\n\nSincerely,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]" },
        { name:"Concise 611", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Credit Report Dispute\n\nTo Whom It May Concern:\n\nI dispute the following on my credit report:\n\n- Creditor: [CREDITOR]\n- Account: [ACCOUNT NUMBER]\n- Issue: [DISPUTE REASON]\n\nThis is inaccurate. Please investigate per FCRA Section 611 and correct or remove within 30 days.\n\nThank you,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]\n[PHONE]" }
      ]
    },
    "605b": {
      label: "FCRA 605B - Identity Theft Block",
      variations: [
        { name:"Standard 605B Block Request", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[BUREAU ADDRESS]\n\nRe: Identity Theft — Request to Block Under FCRA Section 605B\n\nTo Whom It May Concern:\n\nI am a victim of identity theft. I am writing to request that you block the following fraudulent account(s) from my credit report pursuant to FCRA Section 605B (15 U.S.C. 1681c-2).\n\nFraudulent Account(s):\nCreditor: [CREDITOR]\nAccount Number: [ACCOUNT NUMBER]\nBalance: [BALANCE]\n\nI did not open this account, did not authorize anyone to open it, and received no benefit from it.\n\nEnclosed:\n1. FTC Identity Theft Report (Report #[FTC NUMBER])\n2. Police Report (Report #[POLICE NUMBER])\n3. Government-issued photo ID\n4. Proof of address\n\nYou are required to block this information within 4 business days.\n\nSincerely,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]" }
      ]
    },
    "623": {
      label: "FCRA 623 - Direct Furnisher Dispute",
      variations: [
        { name:"Standard 623 Direct Dispute", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[CREDITOR NAME]\nDispute Department\n[CREDITOR ADDRESS]\n\nRe: Direct Dispute Under FCRA Section 623(a)(8)\n\nTo Whom It May Concern:\n\nI previously disputed the account listed below through the credit reporting agencies. The information was verified, however I believe the verification was in error.\n\nI am now exercising my right under FCRA Section 623(a)(8) to dispute directly with you as the furnisher.\n\nAccount: [ACCOUNT NUMBER]\nReported Balance: [BALANCE]\nReported Status: [STATUS]\n\nThe information you are furnishing is inaccurate because: [EXPLANATION]\n\nAs the furnisher, you are required to conduct an investigation, review all relevant information, and report results to the credit bureaus.\n\nIf I do not receive a response within 30 days, I will escalate this matter to the CFPB.\n\nSincerely,\n[YOUR NAME]\nSSN: XXX-XX-[LAST4]" }
      ]
    },
    "fdcpa": {
      label: "FDCPA - Debt Validation",
      variations: [
        { name:"Standard Debt Validation", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[COLLECTOR NAME]\n[COLLECTOR ADDRESS]\n\nRe: Debt Validation Request — FDCPA Section 809(b)\n\nTo Whom It May Concern:\n\nI am writing in response to the collection account reported under your name. I am exercising my right under the Fair Debt Collection Practices Act to request validation of this alleged debt.\n\nPlease provide:\n1. Exact amount owed with itemized accounting\n2. Name and address of original creditor\n3. Original signed contract or agreement\n4. Proof of your license to collect in my state\n5. Complete chain of ownership documentation\n6. Proof the statute of limitations has not expired\n\nUntil proper validation is received, cease all collection activity including credit bureau reporting.\n\nThis is not a refusal to pay — it is a validation request under federal law.\n\nSincerely,\n[YOUR NAME]" }
      ]
    },
    "goodwill": {
      label: "Goodwill Removal Request",
      variations: [
        { name:"Standard Goodwill Letter", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[CREDITOR NAME]\nCustomer Relations\n[CREDITOR ADDRESS]\n\nRe: Goodwill Adjustment Request — Account [ACCOUNT NUMBER]\n\nDear Sir or Madam:\n\nI am reaching out to request a goodwill adjustment on my account. I value my relationship with your company and hope you will consider my request.\n\nDuring a difficult period, I fell behind on payments. Since then, I have been diligent about maintaining my account in good standing. The negative mark from that time is the only blemish on my otherwise positive credit history.\n\nI understand you are under no obligation to grant this request, but removing this item would make a significant difference in my ability to [achieve financial goal — home purchase, etc.].\n\nThank you for your consideration.\n\nRespectfully,\n[YOUR NAME]\n[PHONE]\n[EMAIL]" }
      ]
    },
    "pfd": {
      label: "Pay-for-Delete Offer",
      variations: [
        { name:"Standard Pay-for-Delete", text:"[DATE]\n\n[YOUR NAME]\n[YOUR ADDRESS]\n[CITY, STATE ZIP]\n\n[CREDITOR/COLLECTOR NAME]\nSettlement Department\n[ADDRESS]\n\nRe: Settlement and Deletion Proposal — Account [ACCOUNT NUMBER]\n\nTo Whom It May Concern:\n\nI am writing regarding the above-referenced account. I would like to propose a resolution that benefits both parties.\n\nI am willing to pay [AMOUNT] to resolve this account in full, provided that you agree in writing to:\n1. Accept this amount as payment in full\n2. Request deletion of this tradeline from all three credit bureaus\n\nSimply updating the status to 'paid' does not satisfy this request — I need full deletion.\n\nPlease respond in writing with your agreement to these terms. This offer is valid for 30 days.\n\nSincerely,\n[YOUR NAME]\n[PHONE]" }
      ]
    },
    "cfpb": {
      label: "CFPB Complaint Draft",
      variations: [
        { name:"CFPB Complaint", text:"[DATE]\n\nConsumer Financial Protection Bureau\nP.O. Box 4503\nIowa City, Iowa 52244\n\nRe: Formal Complaint — [BUREAU/CREDITOR NAME]\n\nTo Whom It May Concern:\n\nI am filing this complaint regarding [BUREAU/CREDITOR] for failing to properly investigate my dispute as required by the FCRA.\n\nOn [DATE OF ORIGINAL DISPUTE], I submitted a formal dispute regarding the following account:\nCreditor: [CREDITOR]\nAccount: [ACCOUNT NUMBER]\n\nThe [bureau/creditor] has [failed to investigate / verified without proper investigation / failed to respond within 30 days].\n\nI believe this constitutes a violation of [FCRA Section 611 / 623 / other applicable section].\n\nI am requesting your assistance in resolving this matter. Enclosed please find copies of all correspondence and supporting documentation.\n\nSincerely,\n[YOUR NAME]\n[ADDRESS]\n[PHONE]\n[EMAIL]" }
      ]
    },
    "ag": {
      label: "Attorney General Complaint",
      variations: [
        { name:"AG Complaint", text:"[DATE]\n\nOffice of the Attorney General\nConsumer Protection Division\n[STATE AG ADDRESS]\n\nRe: Consumer Complaint — [COMPANY NAME]\n\nDear Attorney General:\n\nI am writing to file a formal complaint against [COMPANY NAME] for violations of consumer protection laws and the Fair Credit Reporting Act.\n\nI have attempted to resolve this matter directly, but the company has [failed to respond / refused to correct inaccurate information / continued to report unverified data].\n\nDetails of the Complaint:\nCompany: [COMPANY NAME]\nAccount: [ACCOUNT NUMBER]\nNature of Complaint: [DESCRIPTION]\nDates of Correspondence: [DATES]\n\nI am requesting your office investigate this matter and take appropriate action.\n\nEnclosed: copies of all correspondence and documentation.\n\nSincerely,\n[YOUR NAME]\n[ADDRESS]\n[PHONE]\n[EMAIL]" }
      ]
    }
  };

  // ─── SUB-TAB NAVIGATION ───────────────────────────────────────────────────────
  const SUBTABS = ["Clients","Dispute Engine","ID Theft Center","Round Tracker","Letter Templates"];

  // ─── RENDER ───────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:BRIGHT }}>Credit Repair Center</div>
          <div style={{ fontSize:9, color:DIM }}>Professional dispute system with FCRA/FDCPA letter generation</div>
        </div>
        <div style={{ display:"flex", gap:6 }}>
          {selectedClient && <div style={{ fontSize:8, color:GOLD, border:`1px solid ${GOLD}33`, borderRadius:4, padding:"4px 10px", background:`${GOLD}11` }}>Client: {selectedClient.name}</div>}
          <button onClick={()=>{setShowNew(!showNew);setSubTab(0);}} style={btnGold}>+ Enroll Client</button>
        </div>
      </div>

      {/* Sub-tab bar */}
      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${BORDER}`, marginBottom:12 }}>
        {SUBTABS.map((t,i)=>(<div key={t} onClick={()=>setSubTab(i)} style={{ padding:"10px 4px", cursor:"pointer", fontSize:11, fontWeight:subTab===i?600:500, color:subTab===i?GOLD:DIM, borderBottom:subTab===i?`2px solid ${GOLD}`:"2px solid transparent", transition:"all .15s", textTransform:"uppercase", letterSpacing:".08em" }}>{t}</div>))}
      </div>

      {/* ═══════════════════ SUB-TAB 0: CLIENTS ═══════════════════ */}
      {subTab===0 && (<>
        {/* Stats */}
        <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
          {[{l:"Enrolled",v:clients.length,c:"#6366f1"},{l:"Active",v:clients.filter(c=>c.status==="active").length,c:GREEN},{l:"Low FICO Loans",v:lowFicoLoans.length,c:YELLOW},{l:"Graduated",v:clients.filter(c=>c.status==="graduated").length,c:GOLD}].map(s=>(
            <div key={s.l} style={{...cardS,flex:1,minWidth:130,textAlign:"center"}}><div style={{fontSize:7,color:DIM,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div><div style={{fontSize:18,fontWeight:700,color:s.c,marginTop:4}}>{s.v}</div></div>
          ))}
        </div>

        {/* Enroll form */}
        {showNew && (<div style={{...cardS,marginBottom:12,borderColor:GOLD+"44"}}>
          <div style={sectionTitle("Enroll New Client",GOLD)}>Enroll New Client</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["Name","name"],["Email","email"],["Phone","phone"],["SSN Last 4","ssn_last4"]].map(([l,k])=>(<div key={k}><div style={labelS}>{l}</div><input style={inputS} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} /></div>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["Address","address"],["City","city"],["State","state"],["ZIP","zip"]].map(([l,k])=>(<div key={k}><div style={labelS}>{l}</div><input style={inputS} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} /></div>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["TU Score","score_tu"],["EXP Score","score_exp"],["EQF Score","score_eqf"],["Goal","goal_score"],["Fee/mo","monthly_fee"]].map(([l,k])=>(<div key={k}><div style={labelS}>{l}</div><input type="number" style={inputS} value={form[k]} onChange={e=>setForm({...form,[k]:Number(e.target.value)})} /></div>))}
          </div>
          <div style={{marginBottom:8}}><div style={labelS}>Notes</div><input style={inputS} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={addClient} style={btnGold}>Enroll</button>
            <button onClick={()=>setShowNew(false)} style={btnOutline}>Cancel</button>
          </div>
        </div>)}

        {/* Low FICO loans */}
        {lowFicoLoans.length>0 && (<div style={{...cardS,marginBottom:12}}>
          <div style={sectionTitle("",YELLOW)}>Loan Borrowers Needing Credit Repair ({lowFicoLoans.length})</div>
          {lowFicoLoans.slice(0,5).map(l=>(<div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${BORDER}`}}>
            <div><div style={{fontSize:9,color:BRIGHT,fontWeight:600}}>{l.first_name} {l.last_name}</div><div style={{fontSize:8,color:DIM}}>FICO: <span style={{color:l.fico<620?RED:YELLOW,fontWeight:700}}>{l.fico}</span> | {fmtMoney(l.loan_amount)}</div></div>
            <button onClick={()=>enrollFromLoan(l)} style={{background:"rgba(139,92,246,.15)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",fontSize:8,fontWeight:600,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Enroll</button>
          </div>))}
        </div>)}

        {/* Client list */}
        <div style={cardS}>
          <div style={sectionTitle("",GOLD)}>All Clients ({clients.length})</div>
          {clients.length===0&&<div style={{fontSize:9,color:DIM,textAlign:"center",padding:20}}>No clients enrolled yet.</div>}
          {clients.map(c=>(<div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${BORDER}`,cursor:"pointer",transition:"background .1s"}} onClick={()=>{setSelectedClient(c);setEditingClient(null);}}>
            <div>
              <div style={{fontSize:10,color:BRIGHT,fontWeight:600}}>{c.name}</div>
              <div style={{fontSize:8,color:DIM}}>{c.email} | TU:{c.score_tu} EXP:{c.score_exp} EQF:{c.score_eqf} | Goal:{c.goal_score}</div>
            </div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <select value={c.status||"enrolled"} onClick={e=>e.stopPropagation()} onChange={e=>{e.stopPropagation();updateClient(c.id,{status:e.target.value});}} style={{...inputS,width:"auto",fontSize:7,padding:"2px 6px"}}>
                <option value="enrolled">Enrolled</option>
                <option value="active">Active</option>
                <option value="graduated">Graduated</option>
                <option value="cancelled">Cancelled</option>
              </select>
              <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:`${statusColors[c.status]||DIM}18`,color:statusColors[c.status]||DIM,border:`1px solid ${statusColors[c.status]||DIM}33`}}>{c.status||"enrolled"}</span>
            </div>
          </div>))}
        </div>

        {/* Selected client detail */}
        {selectedClient && (<div style={{...cardS,marginTop:12,borderColor:GOLD+"33"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={sectionTitle("",GOLD)}>Client: {selectedClient.name}</div>
            <button onClick={()=>setSelectedClient(null)} style={btnOutline}>Deselect</button>
          </div>
          <div style={{display:"flex",gap:16,marginBottom:12}}>
            {[["TransUnion",selectedClient.score_tu,"#0088cc"],["Experian",selectedClient.score_exp,"#3b82f6"],["Equifax",selectedClient.score_eqf,GREEN]].map(([b,s,col])=>(<div key={b} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:8,color:DIM}}>{b}</div>
              <div style={{fontSize:22,fontWeight:700,color:col}}>{s||"--"}</div>
            </div>))}
            <div style={{flex:1,textAlign:"center",borderLeft:`1px solid ${BORDER}`,paddingLeft:16}}>
              <div style={{fontSize:8,color:DIM}}>Goal</div>
              <div style={{fontSize:22,fontWeight:700,color:GOLD}}>{selectedClient.goal_score}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,fontSize:8,color:DIM,flexWrap:"wrap"}}>
            <span>Phone: {selectedClient.phone||"--"}</span>
            <span>|</span>
            <span>Email: {selectedClient.email||"--"}</span>
            <span>|</span>
            <span>SSN: XXX-XX-{selectedClient.ssn_last4||"XXXX"}</span>
            <span>|</span>
            <span>Fee: ${selectedClient.monthly_fee||0}/mo</span>
          </div>
          {selectedClient.notes && <div style={{fontSize:8,color:DIM,marginTop:4}}>Notes: {selectedClient.notes}</div>}
          {/* Score progress chart */}
          {rounds.filter(r=>r.score_tu_after).length>0 && (<div style={{marginTop:12}}>
            <div style={{fontSize:9,fontWeight:700,color:GOLD,marginBottom:8}}>Score Progress</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:8,height:100}}>
              {[{label:"Start",tu:selectedClient.score_tu,exp:selectedClient.score_exp,eqf:selectedClient.score_eqf},...rounds.filter(r=>r.score_tu_after).map(r=>({label:`R${r.round_number}`,tu:r.score_tu_after,exp:r.score_exp_after,eqf:r.score_eqf_after}))].map((pt,i)=>{
                const mid = Math.round(([pt.tu,pt.exp,pt.eqf].sort((a,b)=>a-b))[1]||0);
                const pct = Math.max(10,Math.min(100,((mid-400)/(850-400))*100));
                return (<div key={i} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:7,color:BRIGHT,fontWeight:700,marginBottom:2}}>{mid}</div>
                  <div style={{height:`${pct}%`,background:mid>=selectedClient.goal_score?GREEN:GOLD,borderRadius:"3px 3px 0 0",minHeight:6,transition:"height .3s"}} />
                  <div style={{fontSize:7,color:DIM,marginTop:2}}>{pt.label}</div>
                </div>);
              })}
            </div>
          </div>)}
        </div>)}
      </>)}

      {/* ═══════════════════ SUB-TAB 1: DISPUTE ENGINE ═══════════════════ */}
      {subTab===1 && (<>
        {!selectedClient ? (
          <div style={{...cardS,textAlign:"center",padding:30}}>
            <div style={{fontSize:12,color:DIM,marginBottom:6}}>No client selected</div>
            <div style={{fontSize:9,color:DIM}}>Go to the Clients tab and select a client first.</div>
          </div>
        ) : (<>
          {/* Step indicator */}
          <div style={{display:"flex",gap:0,marginBottom:14}}>
            {["Import Tradelines","AI Strategy","Review & Edit","Generated Letters"].map((s,i)=>(<div key={s} style={{flex:1,textAlign:"center",padding:"6px 4px",fontSize:8,fontWeight:disputeStep===i?700:400,color:disputeStep===i?GOLD:i<disputeStep?GREEN:DIM,borderBottom:`2px solid ${disputeStep===i?GOLD:i<disputeStep?GREEN+"55":"transparent"}`,cursor:"pointer"}} onClick={()=>{if(i<=disputeStep||i===0)setDisputeStep(i);}}>{i+1}. {s}</div>))}
          </div>

          {/* STEP 0: Import */}
          {disputeStep===0 && (<>
            <div style={{...cardS,marginBottom:12}}>
              <div style={sectionTitle("","#3b82f6")}>Import Credit Report</div>
              <div style={{fontSize:9,color:DIM,marginBottom:10}}>Drop a MyScoreIQ HTML export or manually enter tradelines below.</div>
              <div style={{display:"flex",gap:8,marginBottom:12}}>
                <label style={{...btnOutline,display:"inline-flex",alignItems:"center",gap:4,cursor:"pointer"}}>
                  Upload HTML Report
                  <input type="file" accept=".html,.htm" onChange={handleFileImport} style={{display:"none"}} />
                </label>
                {tradelines.length>0 && <button onClick={()=>{setTradelines([]);setDisputeStrategies({});setGeneratedLetters([]);}} style={btnDanger}>Clear All</button>}
              </div>

              {/* Manual entry */}
              <div style={{borderTop:`1px solid ${BORDER}`,paddingTop:10,marginTop:8}}>
                <div style={{fontSize:9,fontWeight:600,color:BRIGHT,marginBottom:8}}>Manual Entry</div>
                <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
                  <div><div style={labelS}>Creditor</div><input style={inputS} value={manualTradeline.creditor} onChange={e=>setManualTradeline({...manualTradeline,creditor:e.target.value})} /></div>
                  <div><div style={labelS}>Account #</div><input style={inputS} value={manualTradeline.account_num} onChange={e=>setManualTradeline({...manualTradeline,account_num:e.target.value})} /></div>
                  <div><div style={labelS}>Balance</div><input style={inputS} value={manualTradeline.balance} onChange={e=>setManualTradeline({...manualTradeline,balance:e.target.value})} placeholder="$0" /></div>
                  <div><div style={labelS}>Payment</div><input style={inputS} value={manualTradeline.payment} onChange={e=>setManualTradeline({...manualTradeline,payment:e.target.value})} placeholder="$0/mo" /></div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 2fr",gap:6,marginBottom:8}}>
                  <div><div style={labelS}>Status</div><select style={inputS} value={manualTradeline.status} onChange={e=>setManualTradeline({...manualTradeline,status:e.target.value})}><option>Open</option><option>Closed</option><option>Paid</option><option>Settled</option><option>Collection</option><option>Charge-Off</option><option>Late</option><option>Derogatory</option></select></div>
                  <div><div style={labelS}>Type</div><select style={inputS} value={manualTradeline.type} onChange={e=>setManualTradeline({...manualTradeline,type:e.target.value})}><option>Revolving</option><option>Installment</option><option>Mortgage</option><option>Collection</option><option>Student Loan</option><option>Auto Loan</option><option>Medical</option><option>Other</option></select></div>
                  <div><div style={labelS}>Date Opened</div><input type="date" style={inputS} value={manualTradeline.date_opened} onChange={e=>setManualTradeline({...manualTradeline,date_opened:e.target.value})} /></div>
                  <div><div style={labelS}>Last Reported</div><input type="date" style={inputS} value={manualTradeline.last_reported} onChange={e=>setManualTradeline({...manualTradeline,last_reported:e.target.value})} /></div>
                  <div><div style={labelS}>Remarks/Notes</div><input style={inputS} value={manualTradeline.remarks} onChange={e=>setManualTradeline({...manualTradeline,remarks:e.target.value})} placeholder="Late, collection, fraud, etc." /></div>
                </div>
                <button onClick={addManualTradeline} style={btnGold}>+ Add Tradeline</button>
              </div>
            </div>

            {/* Tradeline table */}
            {tradelines.length>0 && (<div style={{...cardS}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                <div style={sectionTitle("",BRIGHT)}>Tradelines ({tradelines.length})</div>
                <div style={{display:"flex",gap:6}}>
                  <button onClick={selectAllTradelines} style={btnOutline}>{tradelines.every(t=>t.selected)?"Deselect All":"Select All"}</button>
                  <button onClick={()=>{if(tradelines.some(t=>t.selected)){runAutoStrategy();}else{if(showToast)showToast("Select items to dispute first");}}} style={{...btnGold,background:tradelines.some(t=>t.selected)?GOLD:`${GOLD}44`}}>Next: AI Strategy</button>
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:9}}>
                  <thead><tr style={{borderBottom:`1px solid ${BORDER}`}}>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>SEL</th>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>CREDITOR</th>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>ACCT #</th>
                    <th style={{padding:"4px 6px",textAlign:"right",color:DIM,fontWeight:600,fontSize:7}}>BALANCE</th>
                    <th style={{padding:"4px 6px",textAlign:"right",color:DIM,fontWeight:600,fontSize:7}}>PMT</th>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>STATUS</th>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>TYPE</th>
                    <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontWeight:600,fontSize:7}}>REMARKS</th>
                    <th style={{padding:"4px 6px",textAlign:"center",color:DIM,fontWeight:600,fontSize:7}}>DEL</th>
                  </tr></thead>
                  <tbody>
                    {tradelines.map((t,i)=>(<tr key={i} style={{borderBottom:`1px solid ${BORDER}22`,background:t.selected?`${GOLD}08`:"transparent"}}>
                      <td style={{padding:"4px 6px"}}><input type="checkbox" checked={t.selected} onChange={()=>toggleTradelineSelect(i)} /></td>
                      <td style={{padding:"4px 6px",color:BRIGHT,fontWeight:600}}>{t.creditor}</td>
                      <td style={{padding:"4px 6px",color:DIM}}>{t.account_num||"--"}</td>
                      <td style={{padding:"4px 6px",textAlign:"right",color:TXT}}>{t.balance||"--"}</td>
                      <td style={{padding:"4px 6px",textAlign:"right",color:DIM}}>{t.payment||"--"}</td>
                      <td style={{padding:"4px 6px"}}><span style={{fontSize:7,padding:"1px 5px",borderRadius:2,background:t.status.toLowerCase().includes("collect")||t.status.toLowerCase().includes("charge")?`${RED}18`:t.status.toLowerCase().includes("late")||t.status.toLowerCase().includes("derog")?`${YELLOW}18`:`${GREEN}18`,color:t.status.toLowerCase().includes("collect")||t.status.toLowerCase().includes("charge")?RED:t.status.toLowerCase().includes("late")||t.status.toLowerCase().includes("derog")?YELLOW:GREEN}}>{t.status}</span></td>
                      <td style={{padding:"4px 6px",color:DIM,fontSize:8}}>{t.type}</td>
                      <td style={{padding:"4px 6px",color:DIM,fontSize:8,maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.remarks||"--"}</td>
                      <td style={{padding:"4px 6px",textAlign:"center"}}><button onClick={()=>setTradelines(tradelines.filter((_,j)=>j!==i))} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:10,fontFamily:"inherit"}}>x</button></td>
                    </tr>))}
                  </tbody>
                </table>
              </div>
            </div>)}
          </>)}

          {/* STEP 1: AI Strategy */}
          {disputeStep===1 && (<div style={{...cardS}}>
            <div style={sectionTitle("","#3b82f6")}>AI Dispute Strategy Assignment</div>
            <div style={{fontSize:9,color:DIM,marginBottom:12}}>Auto-detected strategies below. Override any by changing the dropdown.</div>
            {tradelines.filter(t=>t.selected).length===0 ? (
              <div style={{color:DIM,fontSize:9,textAlign:"center",padding:20}}>No items selected. Go back to Step 1 and select tradelines.</div>
            ) : (<>
              {tradelines.map((t,i)=>{
                if (!t.selected) return null;
                const strat = disputeStrategies[i] || autoDetectStrategy(t);
                const info = STRATEGY_TYPES[strat];
                return (<div key={i} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0",borderBottom:`1px solid ${BORDER}22`}}>
                  <div style={{flex:2}}>
                    <div style={{fontSize:9,color:BRIGHT,fontWeight:600}}>{t.creditor}</div>
                    <div style={{fontSize:8,color:DIM}}>{t.account_num||"--"} | {t.balance||"$0"} | {t.status}</div>
                  </div>
                  <div style={{flex:2}}>
                    <select style={{...inputS,fontSize:8}} value={disputeStrategies[i]||strat} onChange={e=>setDisputeStrategies({...disputeStrategies,[i]:e.target.value})}>
                      {Object.entries(STRATEGY_TYPES).map(([k,v])=>(<option key={k} value={k}>{v.label}</option>))}
                    </select>
                  </div>
                  <div style={{flex:2,fontSize:8,color:info?info.color:DIM}}>{info?info.desc:""}</div>
                </div>);
              })}
              <div style={{display:"flex",gap:8,marginTop:12}}>
                <button onClick={()=>setDisputeStep(0)} style={btnOutline}>Back</button>
                <button onClick={()=>{
                  const strats = {...disputeStrategies};
                  tradelines.forEach((t,i)=>{ if(t.selected && !strats[i]) strats[i]=autoDetectStrategy(t); });
                  setDisputeStrategies(strats);
                  setDisputeStep(2);
                }} style={btnGold}>Next: Review</button>
              </div>
            </>)}
          </div>)}

          {/* STEP 2: Review */}
          {disputeStep===2 && (<div style={{...cardS}}>
            <div style={sectionTitle("",GREEN)}>Review Before Generation</div>
            <div style={{fontSize:9,color:BRIGHT,marginBottom:6}}>Client: <strong>{selectedClient.name}</strong></div>
            <div style={{fontSize:8,color:DIM,marginBottom:12}}>SSN: XXX-XX-{selectedClient.ssn_last4||"XXXX"} | {selectedClient.email||"--"} | {selectedClient.phone||"--"}</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:9,marginBottom:12}}>
              <thead><tr style={{borderBottom:`1px solid ${BORDER}`}}>
                <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontSize:7}}>CREDITOR</th>
                <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontSize:7}}>STRATEGY</th>
                <th style={{padding:"4px 6px",textAlign:"left",color:DIM,fontSize:7}}>SEND TO</th>
              </tr></thead>
              <tbody>
                {tradelines.map((t,i)=>{
                  if (!t.selected) return null;
                  const strat = disputeStrategies[i] || "609";
                  const info = STRATEGY_TYPES[strat];
                  const target = strat==="623"||strat==="goodwill"||strat==="pfd"?"Creditor directly":strat==="fdcpa"?"Collection agency":"All 3 bureaus";
                  return (<tr key={i} style={{borderBottom:`1px solid ${BORDER}22`}}>
                    <td style={{padding:"4px 6px",color:BRIGHT,fontWeight:600}}>{t.creditor}</td>
                    <td style={{padding:"4px 6px",color:info?info.color:DIM,fontSize:8}}>{info?info.label:strat}</td>
                    <td style={{padding:"4px 6px",color:DIM,fontSize:8}}>{target}</td>
                  </tr>);
                })}
              </tbody>
            </table>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setDisputeStep(1)} style={btnOutline}>Back</button>
              <button onClick={generateAllLetters} style={{...btnGold,background:GREEN,fontSize:10,padding:"8px 20px"}}>Generate All Letters</button>
            </div>
          </div>)}

          {/* STEP 3: Generated Letters */}
          {disputeStep===3 && (<>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div style={sectionTitle("",GREEN)}>Generated Letters ({generatedLetters.length})</div>
              <div style={{display:"flex",gap:6}}>
                <button onClick={downloadAllLetters} style={btnGold}>Download All ({generatedLetters.length})</button>
                <button onClick={()=>{setDisputeStep(0);setGeneratedLetters([]);setDisputeStrategies({});setTradelines(t=>t.map(x=>({...x,selected:false})));}} style={btnOutline}>Start Over</button>
              </div>
            </div>
            {generatedLetters.map((l,i)=>{
              const info = STRATEGY_TYPES[l.strategy];
              return (<div key={i} style={{...cardS,marginBottom:10,borderColor:(info?info.color:BORDER)+"44"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                  <div>
                    <span style={{fontSize:9,fontWeight:700,color:info?info.color:BRIGHT}}>{info?info.label:l.strategy}</span>
                    <span style={{fontSize:8,color:DIM,marginLeft:8}}>To: {l.bureau} | Re: {l.creditor}</span>
                  </div>
                  <div style={{display:"flex",gap:4}}>
                    <button onClick={()=>copyLetter(l.letter)} style={btnOutline}>Copy</button>
                    <button onClick={()=>downloadLetter(l.letter,`dispute_${l.strategy}_${l.bureau}_${l.creditor.replace(/\s/g,"_")}.txt`)} style={btnOutline}>Download</button>
                  </div>
                </div>
                <textarea value={l.letter} onChange={e=>{const updated=[...generatedLetters];updated[i]={...updated[i],letter:e.target.value};setGeneratedLetters(updated);}} style={{...inputS,height:250,whiteSpace:"pre-wrap",lineHeight:1.6,fontSize:9}} />
              </div>);
            })}
          </>)}
        </>)}
      </>)}

      {/* ═══════════════════ SUB-TAB 2: ID THEFT CENTER ═══════════════════ */}
      {subTab===2 && (<>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
          {/* FTC Report */}
          <div style={cardS}>
            <div style={sectionTitle("",RED)}>Step 1: FTC Identity Theft Report</div>
            <div style={{fontSize:8,color:DIM,marginBottom:8}}>File at IdentityTheft.gov then record your info here.</div>
            <div style={{marginBottom:8}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <input type="checkbox" checked={idTheft.ftc_filed} onChange={e=>setIdTheft({...idTheft,ftc_filed:e.target.checked})} />
                <span style={{fontSize:9,color:idTheft.ftc_filed?GREEN:DIM}}>FTC Report Filed</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <div><div style={labelS}>FTC Report #</div><input style={inputS} value={idTheft.ftc_report_num} onChange={e=>setIdTheft({...idTheft,ftc_report_num:e.target.value})} /></div>
                <div><div style={labelS}>Date Filed</div><input type="date" style={inputS} value={idTheft.ftc_date} onChange={e=>setIdTheft({...idTheft,ftc_date:e.target.value})} /></div>
              </div>
            </div>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                <input type="checkbox" checked={idTheft.police_filed} onChange={e=>setIdTheft({...idTheft,police_filed:e.target.checked})} />
                <span style={{fontSize:9,color:idTheft.police_filed?GREEN:DIM}}>Police Report Filed</span>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
                <div><div style={labelS}>Police Report #</div><input style={inputS} value={idTheft.police_report_num} onChange={e=>setIdTheft({...idTheft,police_report_num:e.target.value})} /></div>
                <div><div style={labelS}>Date Filed</div><input type="date" style={inputS} value={idTheft.police_date} onChange={e=>setIdTheft({...idTheft,police_date:e.target.value})} /></div>
              </div>
            </div>
            <div style={{marginTop:10,padding:8,background:`${GREEN}08`,borderRadius:4,border:`1px solid ${GREEN}22`}}>
              <div style={{fontSize:8,fontWeight:700,color:GREEN,marginBottom:4}}>Checklist</div>
              {[["FTC report filed",idTheft.ftc_filed],["Police report filed",idTheft.police_filed],["Credit freezes placed",idTheft.freeze_tu&&idTheft.freeze_exp&&idTheft.freeze_eqf]].map(([label,done])=>(
                <div key={label} style={{fontSize:8,color:done?GREEN:DIM,display:"flex",gap:4,alignItems:"center"}}><span>{done?"[done]":"[ ]"}</span>{label}</div>
              ))}
            </div>
          </div>

          {/* 605B Block Requests */}
          <div style={cardS}>
            <div style={sectionTitle("",ORANGE)}>Step 2: 605B Block Requests</div>
            <div style={{fontSize:8,color:DIM,marginBottom:8}}>Generate block request letters for fraudulent accounts.</div>
            <div style={{marginBottom:8}}>
              <div style={{fontSize:9,fontWeight:600,color:BRIGHT,marginBottom:6}}>Fraudulent Accounts</div>
              {idTheft.fraudulent_accounts.map((a,i)=>(<div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"3px 0",borderBottom:`1px solid ${BORDER}22`,fontSize:8}}>
                <span style={{color:TXT}}>{a.creditor} - {a.account_num||"--"} ({a.balance||"$0"})</span>
                <button onClick={()=>setIdTheft({...idTheft,fraudulent_accounts:idTheft.fraudulent_accounts.filter((_,j)=>j!==i)})} style={{background:"none",border:"none",color:RED,cursor:"pointer",fontSize:9}}>x</button>
              </div>))}
              {idTheft.fraudulent_accounts.length===0&&<div style={{fontSize:8,color:DIM,padding:4}}>No accounts added yet.</div>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:6}}>
              <div><div style={labelS}>Creditor</div><input style={inputS} value={newFraudAcct.creditor} onChange={e=>setNewFraudAcct({...newFraudAcct,creditor:e.target.value})} /></div>
              <div><div style={labelS}>Account #</div><input style={inputS} value={newFraudAcct.account_num} onChange={e=>setNewFraudAcct({...newFraudAcct,account_num:e.target.value})} /></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:8}}>
              <div><div style={labelS}>Balance</div><input style={inputS} value={newFraudAcct.balance} onChange={e=>setNewFraudAcct({...newFraudAcct,balance:e.target.value})} /></div>
              <div><div style={labelS}>Date Opened</div><input type="date" style={inputS} value={newFraudAcct.date_opened} onChange={e=>setNewFraudAcct({...newFraudAcct,date_opened:e.target.value})} /></div>
            </div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>{if(!newFraudAcct.creditor)return;setIdTheft({...idTheft,fraudulent_accounts:[...idTheft.fraudulent_accounts,{...newFraudAcct}]});setNewFraudAcct({creditor:"",account_num:"",balance:"",date_opened:""});}} style={btnGold}>+ Add Account</button>
              {idTheft.fraudulent_accounts.length>0 && selectedClient && (
                <button onClick={()=>{
                  const letters605 = [];
                  ["TransUnion","Experian","Equifax"].forEach(bureau=>{
                    idTheft.fraudulent_accounts.forEach(acct=>{
                      letters605.push(generate605bLetter(acct, selectedClient, bureau, _seed(acct.creditor+bureau)));
                    });
                  });
                  letters605.forEach((lt,i)=>setTimeout(()=>downloadLetter(lt,`605b_block_${i+1}.txt`),i*200));
                  if(showToast)showToast(`Downloaded ${letters605.length} block request letters`);
                }} style={{...btnGold,background:RED}}>Generate 605B Letters</button>
              )}
            </div>
            <div style={{marginTop:8,fontSize:8,color:DIM}}>Required attachments: Government ID, proof of address, FTC affidavit, police report</div>
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          {/* Fraud Alerts */}
          <div style={cardS}>
            <div style={sectionTitle("",YELLOW)}>Step 3: Fraud Alerts</div>
            <div style={{marginBottom:8}}>
              <div style={labelS}>Alert Type</div>
              <select style={inputS} value={idTheft.fraud_alert_type} onChange={e=>setIdTheft({...idTheft,fraud_alert_type:e.target.value})}>
                <option value="">None Active</option>
                <option value="initial">Initial Fraud Alert (1 Year)</option>
                <option value="extended">Extended Fraud Alert (7 Years)</option>
              </select>
            </div>
            {idTheft.fraud_alert_type && (<div>
              <div style={labelS}>Expires</div>
              <input type="date" style={inputS} value={idTheft.fraud_alert_expires} onChange={e=>setIdTheft({...idTheft,fraud_alert_expires:e.target.value})} />
              {idTheft.fraud_alert_expires && (<div style={{fontSize:8,marginTop:4,color:new Date(idTheft.fraud_alert_expires)<new Date()?RED:GREEN}}>
                {new Date(idTheft.fraud_alert_expires)<new Date()?"EXPIRED - Renew immediately":`Active until ${new Date(idTheft.fraud_alert_expires).toLocaleDateString()}`}
              </div>)}
            </div>)}
            <div style={{marginTop:8,fontSize:8,color:DIM}}>
              Initial alert: Only 1 bureau needed (they notify the others).{"\n"}
              Extended alert: Requires FTC Identity Theft Report.
            </div>
          </div>

          {/* Credit Freezes */}
          <div style={cardS}>
            <div style={sectionTitle("","#3b82f6")}>Step 4: Credit Freezes</div>
            <div style={{fontSize:8,color:DIM,marginBottom:8}}>Track freeze status and PINs for all bureaus.</div>
            {[["TransUnion","freeze_tu","pin_tu"],["Experian","freeze_exp","pin_exp"],["Equifax","freeze_eqf","pin_eqf"],["NCTUE","freeze_nctue","pin_nctue"],["ChexSystems","freeze_chex","pin_chex"]].map(([label,freezeKey,pinKey])=>(
              <div key={label} style={{display:"flex",gap:8,alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${BORDER}22`}}>
                <input type="checkbox" checked={idTheft[freezeKey]} onChange={e=>setIdTheft({...idTheft,[freezeKey]:e.target.checked})} />
                <span style={{fontSize:9,color:idTheft[freezeKey]?GREEN:DIM,flex:1,fontWeight:600}}>{label}</span>
                <span style={{fontSize:7,color:idTheft[freezeKey]?GREEN:RED}}>{idTheft[freezeKey]?"FROZEN":"UNFROZEN"}</span>
                <input style={{...inputS,width:100,fontSize:8}} placeholder="PIN" type="password" value={idTheft[pinKey]} onChange={e=>setIdTheft({...idTheft,[pinKey]:e.target.value})} />
              </div>
            ))}
            <div style={{marginTop:8,fontSize:8,color:DIM}}>
              Freezes are free by federal law. Store PINs securely.
            </div>
          </div>
        </div>
      </>)}

      {/* ═══════════════════ SUB-TAB 3: ROUND TRACKER ═══════════════════ */}
      {subTab===3 && (<>
        {!selectedClient ? (
          <div style={{...cardS,textAlign:"center",padding:30,color:DIM,fontSize:9}}>Select a client from the Clients tab to track dispute rounds.</div>
        ) : (<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:BRIGHT}}>Rounds for {selectedClient.name}</div>
              <div style={{fontSize:8,color:DIM}}>TU:{selectedClient.score_tu} EXP:{selectedClient.score_exp} EQF:{selectedClient.score_eqf}</div>
            </div>
            <button onClick={addRound} style={btnGold}>+ New Round</button>
          </div>

          {/* Stats */}
          {rounds.length>0 && (<div style={{display:"flex",gap:10,marginBottom:12,flexWrap:"wrap"}}>
            {[
              {l:"Total Rounds",v:rounds.length,c:GOLD},
              {l:"Items Disputed",v:rounds.reduce((s,r)=>s+(Array.isArray(r.items_disputed)?r.items_disputed.length:0),0),c:"#3b82f6"},
              {l:"Items Removed",v:rounds.reduce((s,r)=>s+(r.items_removed||0),0),c:GREEN},
              {l:"Success Rate",v:rounds.reduce((s,r)=>s+(Array.isArray(r.items_disputed)?r.items_disputed.length:0),0)>0?Math.round(rounds.reduce((s,r)=>s+(r.items_removed||0),0)/rounds.reduce((s,r)=>s+(Array.isArray(r.items_disputed)?r.items_disputed.length:0),0)*100)+"%":"--",c:GOLD}
            ].map(s=>(
              <div key={s.l} style={{...cardS,flex:1,minWidth:110,textAlign:"center"}}><div style={{fontSize:7,color:DIM,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div><div style={{fontSize:16,fontWeight:700,color:s.c,marginTop:4}}>{s.v}</div></div>
            ))}
          </div>)}

          {/* Round cards */}
          {rounds.map(r=>(<div key={r.id} style={{...cardS,marginBottom:10,borderColor:roundDetail===r.id?GOLD+"44":BORDER}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6,cursor:"pointer"}} onClick={()=>setRoundDetail(roundDetail===r.id?null:r.id)}>
              <div style={{display:"flex",gap:10,alignItems:"center"}}>
                <div style={{fontSize:12,fontWeight:700,color:GOLD}}>Round {r.round_number}</div>
                <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:`${r.status==="completed"?GREEN:r.status==="pending"?DIM:r.status==="sent"?"#3b82f6":YELLOW}18`,color:r.status==="completed"?GREEN:r.status==="pending"?DIM:r.status==="sent"?"#3b82f6":YELLOW}}>{r.status||"pending"}</span>
              </div>
              <span style={{fontSize:8,color:DIM}}>{roundDetail===r.id?"Collapse":"Expand"}</span>
            </div>
            <div style={{display:"flex",gap:16,fontSize:8,color:DIM}}>
              <span>Items disputed: {Array.isArray(r.items_disputed)?r.items_disputed.length:0}</span>
              <span>Removed: {r.items_removed||0}</span>
              <span>Updated: {r.items_updated||0}</span>
              <span>Verified: {r.items_verified||0}</span>
              <span>Sent: {r.letters_sent_at?new Date(r.letters_sent_at).toLocaleDateString():"Not yet"}</span>
            </div>
            {(r.score_tu_after||r.score_exp_after||r.score_eqf_after)&&<div style={{display:"flex",gap:12,marginTop:4,fontSize:8}}>
              <span style={{color:TXT}}>After: TU:<span style={{color:GREEN,fontWeight:700}}>{r.score_tu_after}</span></span>
              <span style={{color:TXT}}>EXP:<span style={{color:GREEN,fontWeight:700}}>{r.score_exp_after}</span></span>
              <span style={{color:TXT}}>EQF:<span style={{color:GREEN,fontWeight:700}}>{r.score_eqf_after}</span></span>
            </div>}

            {/* Expanded detail */}
            {roundDetail===r.id && (<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${BORDER}`}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <div><div style={labelS}>Status</div><select style={inputS} value={r.status||"pending"} onChange={e=>updateRound(r.id,{status:e.target.value})}><option value="pending">Pending</option><option value="sent">Sent</option><option value="in_progress">In Progress</option><option value="completed">Completed</option></select></div>
                <div><div style={labelS}>Letters Sent Date</div><input type="date" style={inputS} value={r.letters_sent_at?r.letters_sent_at.split("T")[0]:""} onChange={e=>updateRound(r.id,{letters_sent_at:e.target.value||null})} /></div>
                <div><div style={labelS}>Items Removed</div><input type="number" style={inputS} value={r.items_removed||0} onChange={e=>updateRound(r.id,{items_removed:Number(e.target.value)})} /></div>
                <div><div style={labelS}>Items Updated</div><input type="number" style={inputS} value={r.items_updated||0} onChange={e=>updateRound(r.id,{items_updated:Number(e.target.value)})} /></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <div><div style={labelS}>Items Verified (not removed)</div><input type="number" style={inputS} value={r.items_verified||0} onChange={e=>updateRound(r.id,{items_verified:Number(e.target.value)})} /></div>
                <div><div style={labelS}>TU Score After</div><input type="number" style={inputS} value={r.score_tu_after||""} onChange={e=>updateRound(r.id,{score_tu_after:Number(e.target.value)||null})} /></div>
                <div><div style={labelS}>EXP Score After</div><input type="number" style={inputS} value={r.score_exp_after||""} onChange={e=>updateRound(r.id,{score_exp_after:Number(e.target.value)||null})} /></div>
                <div><div style={labelS}>EQF Score After</div><input type="number" style={inputS} value={r.score_eqf_after||""} onChange={e=>updateRound(r.id,{score_eqf_after:Number(e.target.value)||null})} /></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <div><div style={labelS}>TransUnion Response</div><select style={inputS} value={(r.bureau_responses||{}).tu||""} onChange={e=>updateRound(r.id,{bureau_responses:{...(r.bureau_responses||{}),tu:e.target.value}})}><option value="">Awaiting</option><option value="deleted">Deleted</option><option value="updated">Updated</option><option value="verified">Verified (no change)</option><option value="no_response">No Response (30 days)</option></select></div>
                <div><div style={labelS}>Experian Response</div><select style={inputS} value={(r.bureau_responses||{}).exp||""} onChange={e=>updateRound(r.id,{bureau_responses:{...(r.bureau_responses||{}),exp:e.target.value}})}><option value="">Awaiting</option><option value="deleted">Deleted</option><option value="updated">Updated</option><option value="verified">Verified (no change)</option><option value="no_response">No Response (30 days)</option></select></div>
                <div><div style={labelS}>Equifax Response</div><select style={inputS} value={(r.bureau_responses||{}).eqf||""} onChange={e=>updateRound(r.id,{bureau_responses:{...(r.bureau_responses||{}),eqf:e.target.value}})}><option value="">Awaiting</option><option value="deleted">Deleted</option><option value="updated">Updated</option><option value="verified">Verified (no change)</option><option value="no_response">No Response (30 days)</option></select></div>
              </div>
              <div><div style={labelS}>Round Notes</div><textarea style={{...inputS,height:50}} value={r.notes||""} onChange={e=>updateRound(r.id,{notes:e.target.value})} /></div>
            </div>)}
          </div>))}
          {rounds.length===0&&<div style={{...cardS,textAlign:"center",color:DIM,fontSize:9,padding:20}}>No rounds yet. Click "+ New Round" to start tracking disputes.</div>}
        </>)}
      </>)}

      {/* ═══════════════════ SUB-TAB 4: LETTER TEMPLATES ═══════════════════ */}
      {subTab===4 && (<>
        <div style={{display:"grid",gridTemplateColumns:"200px 1fr",gap:12}}>
          {/* Template sidebar */}
          <div style={cardS}>
            <div style={sectionTitle("",GOLD)}>Template Library</div>
            {Object.entries(TEMPLATES).map(([key,tmpl])=>(
              <div key={key} onClick={()=>{setTemplateCategory(key);setTemplateVariation(0);setEditableTemplate(tmpl.variations[0].text);}} style={{padding:"6px 8px",marginBottom:2,borderRadius:4,cursor:"pointer",fontSize:9,fontWeight:templateCategory===key?700:400,color:templateCategory===key?GOLD:DIM,background:templateCategory===key?`${GOLD}11`:"transparent",border:templateCategory===key?`1px solid ${GOLD}22`:"1px solid transparent"}}>
                {tmpl.label}
              </div>
            ))}
          </div>

          {/* Template editor */}
          <div style={cardS}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:GOLD}}>{TEMPLATES[templateCategory]?.label||""}</div>
                <div style={{fontSize:8,color:DIM,marginTop:2}}>{(TEMPLATES[templateCategory]?.variations||[]).length} variation(s) available</div>
              </div>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>{navigator.clipboard.writeText(editableTemplate);if(showToast)showToast("Template copied");}} style={btnOutline}>Copy</button>
                <button onClick={()=>{
                  const b=new Blob([editableTemplate],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`template_${templateCategory}_v${templateVariation+1}.txt`;a.click();URL.revokeObjectURL(u);
                }} style={btnOutline}>Download</button>
              </div>
            </div>

            {/* Variation tabs */}
            {(TEMPLATES[templateCategory]?.variations||[]).length>1 && (
              <div style={{display:"flex",gap:0,borderBottom:`1px solid ${BORDER}`,marginBottom:10}}>
                {(TEMPLATES[templateCategory]?.variations||[]).map((v,i)=>(
                  <div key={i} onClick={()=>{setTemplateVariation(i);setEditableTemplate(v.text);}} style={{padding:"4px 10px",cursor:"pointer",fontSize:8,fontWeight:templateVariation===i?700:400,color:templateVariation===i?GOLD:DIM,borderBottom:templateVariation===i?`2px solid ${GOLD}`:"2px solid transparent"}}>{v.name}</div>
                ))}
              </div>
            )}

            <div style={{fontSize:8,color:DIM,marginBottom:6}}>Edit the template below. Replace [BRACKETS] with actual data before sending.</div>
            <textarea value={editableTemplate} onChange={e=>setEditableTemplate(e.target.value)} style={{...inputS,height:400,whiteSpace:"pre-wrap",lineHeight:1.6,fontSize:9}} />
          </div>
        </div>
      </>)}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 7: RE4LTY (Real Estate Company Integration)
// ═══════════════════════════════════════════════════════════════════════════════
function RealtyTab({ loans, contacts, showToast }) {
  // ─── MOCK DATA ──────────────────────────────────────────────────────────────
  const MOCK_LISTINGS = [
    { id:"m1", address:"250 Ospreys Landing #1402", city:"Naples", state:"FL", zip:"34104", price:425000, beds:3, baths:2, sqft:1850, status:"Active", type:"Condo", agent:"Maria Santos", daysOnMarket:12, mls:"N224001", photo:null, created_at:"2026-03-10" },
    { id:"m2", address:"1200 Gulf Shore Blvd N #501", city:"Naples", state:"FL", zip:"34102", price:1250000, beds:4, baths:3, sqft:2400, status:"Active", type:"Condo", agent:"James Rivera", daysOnMarket:28, mls:"N224002", photo:null, created_at:"2026-02-22" },
    { id:"m3", address:"8765 Estero Blvd #202", city:"Fort Myers Beach", state:"FL", zip:"33931", price:550000, beds:2, baths:2, sqft:1200, status:"Pending", type:"Condo", agent:"Lisa Chen", daysOnMarket:45, mls:"F224003", photo:null, created_at:"2026-02-05" },
    { id:"m4", address:"4521 SW 75th Ave", city:"Miami", state:"FL", zip:"33155", price:680000, beds:4, baths:3, sqft:2100, status:"Active", type:"Single Family", agent:"Carlos Mendez", daysOnMarket:7, mls:"M224004", photo:null, created_at:"2026-03-15" },
    { id:"m5", address:"920 Intracoastal Dr #1801", city:"Fort Lauderdale", state:"FL", zip:"33304", price:890000, beds:3, baths:2, sqft:1750, status:"Sold", type:"Condo", agent:"Sarah Kim", daysOnMarket:62, mls:"B224005", photo:null, created_at:"2026-01-18" },
  ];

  const MOCK_COMPS = [
    { address:"245 Ospreys Landing #1308", salePrice:415000, priceSqft:228, beds:3, baths:2, saleDate:"2026-01-15", distance:"0.1 mi" },
    { address:"260 Ospreys Landing #902", salePrice:440000, priceSqft:241, beds:3, baths:2, saleDate:"2025-12-08", distance:"0.1 mi" },
    { address:"300 Dunes Blvd #1105", salePrice:398000, priceSqft:218, beds:3, baths:2, saleDate:"2026-02-20", distance:"0.4 mi" },
    { address:"275 Indies Way #1504", salePrice:455000, priceSqft:246, beds:3, baths:2, saleDate:"2025-11-22", distance:"0.6 mi" },
    { address:"310 Goodlette Rd S #608", salePrice:410000, priceSqft:225, beds:3, baths:2, saleDate:"2026-01-30", distance:"0.9 mi" },
  ];

  // ─── STATE ──────────────────────────────────────────────────────────────────
  const [subTab, setSubTab] = useState(0);
  // Search
  const [searchFilters, setSearchFilters] = useState({ city:"", state:"", zip:"", minPrice:"", maxPrice:"", beds:"", baths:"", type:"", status:"", minSqft:"", maxSqft:"" });
  const [searchResults, setSearchResults] = useState(MOCK_LISTINGS);
  const [hasSearched, setHasSearched] = useState(false);
  // Saved searches
  const [savedSearches, setSavedSearches] = useState(() => { try { const s=localStorage.getItem("re4lty_saved_searches"); return s?JSON.parse(s):[]; } catch{ return []; }});
  // Favorites
  const [favorites, setFavorites] = useState(() => { try { const f=localStorage.getItem("re4lty_favorites"); return f?JSON.parse(f):[]; } catch{ return []; }});
  // Comps
  const [compAddress, setCompAddress] = useState("");
  const [compResults, setCompResults] = useState([]);
  const [compRan, setCompRan] = useState(false);
  // MLS
  const [mlsConfigs, setMlsConfigs] = useState({ miami:{ status:"Connected", key:"" }, stellar:{ status:"Pending", key:"" }, swfl:{ status:"Not Connected", key:"" } });
  const [editingMls, setEditingMls] = useState(null);

  // ─── HELPERS ────────────────────────────────────────────────────────────────
  const rCardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:12, padding:20, boxShadow:"0 4px 24px rgba(0,0,0,0.3)", transition:"all 0.2s ease" };
  const rInputS = { background:INPUT_BG, border:`1px solid ${INPUT_BD}`, color:TXT, padding:"10px 14px", fontSize:12, borderRadius:8, width:"100%", fontFamily:"inherit", boxSizing:"border-box", letterSpacing:".02em", outline:"none", transition:"all 0.15s ease", lineHeight:1.5 };
  const rSelectS = { ...rInputS, appearance:"none", cursor:"pointer" };
  const rBtnS = { background:GOLD, color:"#0a0a12", border:"none", borderRadius:8, padding:"10px 20px", fontSize:12, fontWeight:600, cursor:"pointer", letterSpacing:".03em", fontFamily:"inherit", transition:"all 0.2s ease" };
  const rBtnOutS = { ...rBtnS, background:"transparent", border:`1px solid rgba(212,175,55,0.3)`, color:GOLD };
  const statusColors = { Active:GREEN, Pending:YELLOW, "Under Contract":GOLD, Sold:PURPLE, Withdrawn:DIM, Expired:RED };

  const persistFavorites = (f) => { setFavorites(f); localStorage.setItem("re4lty_favorites", JSON.stringify(f)); };
  const persistSavedSearches = (s) => { setSavedSearches(s); localStorage.setItem("re4lty_saved_searches", JSON.stringify(s)); };

  const toggleFavorite = (listing) => {
    const exists = favorites.find(f=>f.id===listing.id);
    if (exists) { persistFavorites(favorites.filter(f=>f.id!==listing.id)); if(showToast) showToast("Removed from favorites"); }
    else { persistFavorites([...favorites, listing]); if(showToast) showToast("Added to favorites"); }
  };
  const isFav = (id) => favorites.some(f=>f.id===id);

  const MLS_API = SB_URL + '/functions/v1/mls-bridge';
  const [mlsLoading, setMlsLoading] = useState(false);

  const runSearch = async () => {
    const f = searchFilters;
    setMlsLoading(true);
    try {
      const params = new URLSearchParams();
      if(f.city) params.set('city', f.city);
      if(f.state) params.set('state', f.state);
      if(f.zip) params.set('zip', f.zip);
      if(f.minPrice) params.set('min_price', f.minPrice);
      if(f.maxPrice) params.set('max_price', f.maxPrice);
      if(f.beds) params.set('beds', f.beds);
      if(f.baths) params.set('baths', f.baths);
      if(f.type) params.set('type', f.type);
      if(f.status) params.set('status', f.status || 'Active');
      params.set('limit', '25');
      const res = await fetch(MLS_API + '/listings?' + params.toString());
      const data = await res.json();
      if (data.listings && data.listings.length > 0) {
        setSearchResults(data.listings);
        setHasSearched(true);
        setMlsLoading(false);
        if(showToast) showToast(data.listings.length + ' live MLS listings found');
        return;
      }
    } catch(e) { console.log('MLS API fallback to local:', e); }
    // Fallback to local mock if MLS API fails
    setMlsLoading(false);
    let results = [...MOCK_LISTINGS];
    if(f.city) results = results.filter(r=>r.city.toLowerCase().includes(f.city.toLowerCase()));
    if(f.state) results = results.filter(r=>r.state.toLowerCase()===f.state.toLowerCase());
    if(f.zip) results = results.filter(r=>r.zip.includes(f.zip));
    if(f.minPrice) results = results.filter(r=>r.price>=Number(f.minPrice));
    if(f.maxPrice) results = results.filter(r=>r.price<=Number(f.maxPrice));
    if(f.beds) results = results.filter(r=>r.beds>=Number(f.beds));
    if(f.baths) results = results.filter(r=>r.baths>=Number(f.baths));
    if(f.type) results = results.filter(r=>r.type===f.type);
    if(f.status) results = results.filter(r=>r.status===f.status);
    if(f.minSqft) results = results.filter(r=>r.sqft>=Number(f.minSqft));
    if(f.maxSqft) results = results.filter(r=>r.sqft<=Number(f.maxSqft));
    setSearchResults(results);
    setHasSearched(true);
  };

  const saveCurrentSearch = () => {
    const name = `Search ${savedSearches.length+1} — ${searchFilters.city||"All"} ${searchFilters.state||""} ${searchFilters.status||"Any"}`.trim();
    persistSavedSearches([...savedSearches, { id:Date.now().toString(), name, filters:{...searchFilters}, savedAt:new Date().toISOString() }]);
    if(showToast) showToast("Search saved");
  };

  const loadSavedSearch = (s) => { setSearchFilters(s.filters); setSubTab(0); setTimeout(()=>{ runSearch(); },50); };

  const runCompAnalysis = () => {
    if(!compAddress.trim()) return;
    setCompResults(MOCK_COMPS);
    setCompRan(true);
  };

  const compStats = compResults.length > 0 ? {
    avg: Math.round(compResults.reduce((s,c)=>s+c.salePrice,0)/compResults.length),
    median: compResults.map(c=>c.salePrice).sort((a,b)=>a-b)[Math.floor(compResults.length/2)],
    min: Math.min(...compResults.map(c=>c.salePrice)),
    max: Math.max(...compResults.map(c=>c.salePrice)),
    avgPsf: Math.round(compResults.reduce((s,c)=>s+c.priceSqft,0)/compResults.length),
  } : null;

  // ─── SUB TABS ───────────────────────────────────────────────────────────────
  const SUB_TABS = [
    { icon:"\uD83D\uDD0D", label:"Properties" },
    { icon:"\uD83D\uDCC4", label:"Transactions" },
    { icon:"\uD83D\uDCDD", label:"Contracts" },
    { icon:"\u2705", label:"Compliance" },
    { icon:"\uD83D\uDCCA", label:"Comps" },
    { icon:"\uD83D\uDD17", label:"MLS" },
  ];

  // ─── Edge Function States ──────────────────────────────────────────────────
  const [analyzePanel, setAnalyzePanel] = useState(null);
  const [analyzeLoading, setAnalyzeLoading] = useState(null);
  const [topDealsModal, setTopDealsModal] = useState(false);
  const [topDealsForm, setTopDealsForm] = useState({ city:"Naples", state:"FL", max_price:"1000000" });
  const [topDealsResults, setTopDealsResults] = useState(null);
  const [topDealsLoading, setTopDealsLoading] = useState(false);
  const [negotiatePanel, setNegotiatePanel] = useState(null);
  const [negotiateLoading, setNegotiateLoading] = useState(null);

  const handleAnalyzeProperty = async (listing) => {
    setAnalyzeLoading(listing.id);
    const res = await edgeFn("deal-intelligence/analyze", { address:listing.address, city:listing.city, state:listing.state, zip:listing.zip });
    setAnalyzeLoading(null);
    setAnalyzePanel({ listing, data:res });
  };

  const handleTopDeals = async () => {
    setTopDealsLoading(true);
    const res = await edgeFn("deal-intelligence/top-deals", { city:topDealsForm.city, state:topDealsForm.state, max_price:Number(topDealsForm.max_price) });
    setTopDealsLoading(false);
    setTopDealsResults(res);
  };

  const handleNegotiate = async (listing) => {
    setNegotiateLoading(listing.id);
    const res = await edgeFn("deal-intelligence/negotiate", { property_address:listing.address, list_price:listing.price, days_on_market:listing.daysOnMarket });
    setNegotiateLoading(null);
    setNegotiatePanel({ listing, data:res });
  };

  // ─── TRANSACTION STATE ──────────────────────────────────────────────────────
  const [transactions, setTransactions] = useState([]);
  const [selectedTx, setSelectedTx] = useState(null);
  const [showNewTx, setShowNewTx] = useState(false);
  const [txForm, setTxForm] = useState({property_address:"",property_city:"",property_state:"FL",property_zip:"",buyer_name:"",seller_name:"",list_price:"",contract_price:"",contract_date:"",closing_date:"",stage:"Pre-Listing",transaction_type:"purchase"});
  const [complianceItems, setComplianceItems] = useState([]);

  useEffect(() => {
    sbFetch("vault_re_transactions","?order=created_at.desc&limit=100").then(d=>setTransactions(d||[]));
  }, []);

  const loadCompliance = async (txId) => {
    const items = await sbFetch("vault_re_compliance",`?transaction_id=eq.${txId}&order=category.asc,item_name.asc`);
    setComplianceItems(items||[]);
  };

  const createTransaction = async () => {
    if(!txForm.property_address) return;
    const r = await sbInsert("vault_re_transactions", txForm);
    if(r) {
      setTransactions([r,...transactions]);
      setShowNewTx(false);
      setTxForm({property_address:"",property_city:"",property_state:"FL",property_zip:"",buyer_name:"",seller_name:"",list_price:"",contract_price:"",contract_date:"",closing_date:"",stage:"Pre-Listing",transaction_type:"purchase"});
      // Auto-create compliance checklist
      const defaultItems = [
        {item_name:"Listing Agreement Signed",category:"Listing"},
        {item_name:"Buyer Broker Agreement Signed",category:"Buyer"},
        {item_name:"Property Disclosure Received",category:"Disclosure"},
        {item_name:"Lead Paint Disclosure",category:"Disclosure"},
        {item_name:"HOA Documents Received",category:"HOA"},
        {item_name:"Contract Fully Executed",category:"Contract"},
        {item_name:"Earnest Money Deposited",category:"Contract"},
        {item_name:"Inspection Completed",category:"Inspection",deadline:txForm.contract_date?new Date(new Date(txForm.contract_date).getTime()+15*86400000).toISOString().split("T")[0]:null},
        {item_name:"Appraisal Ordered",category:"Appraisal"},
        {item_name:"Appraisal Received",category:"Appraisal"},
        {item_name:"Title Search Completed",category:"Title"},
        {item_name:"Survey Ordered",category:"Title"},
        {item_name:"Loan Commitment Received",category:"Financing",deadline:txForm.contract_date?new Date(new Date(txForm.contract_date).getTime()+30*86400000).toISOString().split("T")[0]:null},
        {item_name:"Insurance Binder Received",category:"Insurance"},
        {item_name:"Walk-Through Completed",category:"Closing"},
        {item_name:"Closing Disclosure Signed",category:"Closing"},
        {item_name:"Final Settlement Statement",category:"Closing"},
      ];
      for(const item of defaultItems) await sbInsert("vault_re_compliance",{...item,transaction_id:r.id});
      if(showToast) showToast("Transaction created with compliance checklist");
    }
  };

  const FL_CONTRACTS = [
    {name:"FAR/BAR Residential Contract (Standard)",form:"FR/BAR-6",category:"Purchase",updated:"Jan 2026"},
    {name:"FAR/BAR AS IS Contract",form:"FR/BAR AS IS-6",category:"Purchase",updated:"Jan 2026"},
    {name:"Exclusive Right of Sale Listing Agreement",form:"ERS-18",category:"Listing",updated:"Jan 2026"},
    {name:"Buyer Broker Agreement",form:"BBA-3",category:"Buyer",updated:"Jan 2026"},
    {name:"Addendum: Financing Contingency",form:"FC-5",category:"Addendum",updated:"Jan 2026"},
    {name:"Addendum: Inspection",form:"INS-4",category:"Addendum",updated:"Jan 2026"},
    {name:"Addendum: HOA/Condo",form:"HOA-3",category:"Addendum",updated:"Jan 2026"},
    {name:"Seller Property Disclosure",form:"SPDS-6",category:"Disclosure",updated:"Jan 2026"},
    {name:"Lead-Based Paint Disclosure",form:"LBP-2",category:"Disclosure",updated:"2024"},
    {name:"FIRPTA Affidavit",form:"FIRPTA-1",category:"Disclosure",updated:"2024"},
    {name:"Compensation Agreement (MCSB-1)",form:"MCSB-1",category:"Compensation",updated:"Jan 2026"},
    {name:"Assignment of Contract",form:"AOC-2",category:"Contract",updated:"2024"},
    {name:"Extension of Time",form:"EOT-3",category:"Contract",updated:"Jan 2026"},
    {name:"Cancellation of Contract",form:"CAN-2",category:"Contract",updated:"2024"},
  ];

  const TX_STAGES = ["Pre-Listing","Listed","Under Contract","Inspection","Appraisal","Title/Survey","Clear to Close","Closing","Closed"];
  const stageColor = s => ({
    "Pre-Listing":DIM,"Listed":BLUE,"Under Contract":YELLOW,"Inspection":"#f97316",
    "Appraisal":"#a78bfa","Title/Survey":"#06b6d4","Clear to Close":GREEN,"Closing":GOLD,"Closed":GREEN
  }[s]||DIM);

  return (
    <div>
      {/* ─── Analyze Property Slide-Out Panel ────────────────────────── */}
      {analyzePanel && (
        <div style={{ position:"fixed", top:0, right:0, width:420, height:"100vh", background:CARD, borderLeft:`1px solid ${BORDER}`, zIndex:1000, overflowY:"auto", padding:20, boxShadow:"-4px 0 24px rgba(0,0,0,.6)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase" }}>Property Analysis</div>
            <div onClick={()=>setAnalyzePanel(null)} style={{ cursor:"pointer", fontSize:14, color:DIM }}>X</div>
          </div>
          <div style={{ fontSize:10, color:BRIGHT, fontWeight:600, marginBottom:4 }}>{analyzePanel.listing.address}</div>
          <div style={{ fontSize:9, color:DIM, marginBottom:12 }}>{analyzePanel.listing.city}, {analyzePanel.listing.state} {analyzePanel.listing.zip}</div>
          {analyzePanel.data && !analyzePanel.data.error ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
              {[
                { label:"Flood Zone", key:"flood_zone", icon:"\uD83C\uDF0A", color:BLUE },
                { label:"Tax Estimate", key:"tax_estimate", icon:"\uD83D\uDCB0", color:GOLD },
                { label:"Neighborhood", key:"neighborhood", icon:"\uD83C\uDFD8\uFE0F", color:GREEN },
                { label:"Hurricane Risk", key:"hurricane_risk", icon:"\uD83C\uDF00", color:RED },
                { label:"Insurance Est.", key:"insurance", icon:"\uD83D\uDEE1\uFE0F", color:ORANGE },
                { label:"Walkability", key:"walkability", icon:"\uD83D\uDEB6", color:PURPLE },
              ].map(item => (
                <div key={item.key} style={{ background:INPUT_BG, border:`1px solid ${INPUT_BD}`, borderRadius:4, padding:10, borderLeft:`3px solid ${item.color}` }}>
                  <div style={{ fontSize:8, color:DIM, letterSpacing:".06em", textTransform:"uppercase", marginBottom:2 }}>{item.icon} {item.label}</div>
                  <div style={{ fontSize:10, color:BRIGHT }}>{typeof analyzePanel.data[item.key]==="object" ? JSON.stringify(analyzePanel.data[item.key]) : (analyzePanel.data[item.key] || "N/A")}</div>
                </div>
              ))}
              {Object.entries(analyzePanel.data).filter(([k])=>!["flood_zone","tax_estimate","neighborhood","hurricane_risk","insurance","walkability","error","raw","ok"].includes(k)).map(([k,v])=>(
                <div key={k} style={{ background:INPUT_BG, border:`1px solid ${INPUT_BD}`, borderRadius:4, padding:10 }}>
                  <div style={{ fontSize:8, color:DIM, letterSpacing:".06em", textTransform:"uppercase", marginBottom:2 }}>{k.replace(/_/g," ")}</div>
                  <div style={{ fontSize:10, color:BRIGHT }}>{typeof v==="object"?JSON.stringify(v):String(v)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize:9, color:DIM }}>No analysis data returned. {analyzePanel.data?.error || analyzePanel.data?.raw || ""}</div>
          )}
        </div>
      )}

      {/* ─── Negotiate Slide-Out Panel ────────────────────────────────── */}
      {negotiatePanel && (
        <div style={{ position:"fixed", top:0, right:0, width:420, height:"100vh", background:CARD, borderLeft:`1px solid ${BORDER}`, zIndex:1000, overflowY:"auto", padding:20, boxShadow:"-4px 0 24px rgba(0,0,0,.6)" }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase" }}>Negotiation Playbook</div>
            <div onClick={()=>setNegotiatePanel(null)} style={{ cursor:"pointer", fontSize:14, color:DIM }}>X</div>
          </div>
          <div style={{ fontSize:10, color:BRIGHT, fontWeight:600, marginBottom:4 }}>{negotiatePanel.listing.address}</div>
          <div style={{ fontSize:9, color:DIM, marginBottom:4 }}>List: {fmtMoney(negotiatePanel.listing.price)} | {negotiatePanel.listing.daysOnMarket}d on market</div>
          {negotiatePanel.data && !negotiatePanel.data.error ? (
            <div style={{ display:"flex", flexDirection:"column", gap:8, marginTop:8 }}>
              {[
                { label:"Recommended Offer", key:"recommended_offer", color:GREEN },
                { label:"Strategy", key:"strategy", color:GOLD },
                { label:"Counter-Offer Playbook", key:"counter_offer_playbook", color:BLUE },
                { label:"Market Position", key:"market_position", color:PURPLE },
              ].map(item => (
                <div key={item.key} style={{ background:INPUT_BG, border:`1px solid ${INPUT_BD}`, borderRadius:4, padding:10, borderLeft:`3px solid ${item.color}` }}>
                  <div style={{ fontSize:8, color:DIM, letterSpacing:".06em", textTransform:"uppercase", marginBottom:2 }}>{item.label}</div>
                  <div style={{ fontSize:10, color:BRIGHT, whiteSpace:"pre-wrap" }}>{typeof negotiatePanel.data[item.key]==="object" ? JSON.stringify(negotiatePanel.data[item.key],null,2) : (negotiatePanel.data[item.key] || "N/A")}</div>
                </div>
              ))}
              {Object.entries(negotiatePanel.data).filter(([k])=>!["recommended_offer","strategy","counter_offer_playbook","market_position","error","raw","ok"].includes(k)).map(([k,v])=>(
                <div key={k} style={{ background:INPUT_BG, border:`1px solid ${INPUT_BD}`, borderRadius:4, padding:10 }}>
                  <div style={{ fontSize:8, color:DIM, letterSpacing:".06em", textTransform:"uppercase", marginBottom:2 }}>{k.replace(/_/g," ")}</div>
                  <div style={{ fontSize:10, color:BRIGHT, whiteSpace:"pre-wrap" }}>{typeof v==="object"?JSON.stringify(v,null,2):String(v)}</div>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize:9, color:DIM }}>No negotiation data returned. {negotiatePanel.data?.error || negotiatePanel.data?.raw || ""}</div>
          )}
        </div>
      )}

      {/* ─── Top 10 Deals Modal ───────────────────────────────────────── */}
      <Modal open={topDealsModal} onClose={()=>{setTopDealsModal(false);setTopDealsResults(null);}} title="Top 10 Deals" width={620}>
        <div style={{ display:"flex", gap:6, marginBottom:12, flexWrap:"wrap" }}>
          <div style={{ flex:"1 1 30%" }}><label style={labelS}>City</label><input style={inputS} value={topDealsForm.city} onChange={e=>setTopDealsForm({...topDealsForm,city:e.target.value})} /></div>
          <div style={{ flex:"1 1 20%" }}><label style={labelS}>State</label><select style={selectS} value={topDealsForm.state} onChange={e=>setTopDealsForm({...topDealsForm,state:e.target.value})}>{US_STATES.map(s=><option key={s} value={s}>{s}</option>)}</select></div>
          <div style={{ flex:"1 1 30%" }}><label style={labelS}>Max Price</label><input style={inputS} type="number" value={topDealsForm.max_price} onChange={e=>setTopDealsForm({...topDealsForm,max_price:e.target.value})} /></div>
          <div style={{ flex:"0 0 auto", display:"flex", alignItems:"flex-end" }}><button onClick={handleTopDeals} disabled={topDealsLoading} style={btnS}>{topDealsLoading ? "Searching..." : "Find Deals"}</button></div>
        </div>
        {topDealsResults && !topDealsResults.error ? (
          <div>
            {Array.isArray(topDealsResults) ? topDealsResults.map((deal,i) => (
              <div key={i} style={{ background:INPUT_BG, border:`1px solid ${INPUT_BD}`, borderRadius:4, padding:10, marginBottom:6, borderLeft:`3px solid ${GOLD}` }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                  <div style={{ fontSize:10, color:BRIGHT, fontWeight:600 }}>{deal.address || deal.property_address || `Deal #${i+1}`}</div>
                  {deal.score!=null && <span style={badgeS(GOLD)}>Score: {deal.score}</span>}
                </div>
                {deal.price && <div style={{ fontSize:11, color:GOLD, fontWeight:700 }}>{fmtMoney(deal.price)}</div>}
                {deal.negotiation_tactics && <div style={{ fontSize:8, color:DIM, marginTop:4 }}>{typeof deal.negotiation_tactics==="string"?deal.negotiation_tactics:JSON.stringify(deal.negotiation_tactics)}</div>}
                {Object.entries(deal).filter(([k])=>!["address","property_address","price","score","negotiation_tactics"].includes(k)).map(([k,v])=>(
                  <div key={k} style={{ fontSize:8, color:TXT, marginTop:2 }}><span style={{ color:DIM }}>{k.replace(/_/g," ")}: </span>{typeof v==="object"?JSON.stringify(v):String(v)}</div>
                ))}
              </div>
            )) : (
              <div style={{ fontSize:9, color:TXT }}>{typeof topDealsResults==="object" ? JSON.stringify(topDealsResults,null,2) : String(topDealsResults)}</div>
            )}
          </div>
        ) : topDealsResults?.error ? (
          <div style={{ fontSize:9, color:RED }}>{topDealsResults.error}</div>
        ) : null}
      </Modal>

      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:BRIGHT }}>{"\uD83C\uDFE0"} Re4lty Inc — Real Estate Platform</div>
          <div style={{ fontSize:9, color:DIM }}>Property search, comps analysis, MLS integration, favorites & saved searches</div>
        </div>
        <button onClick={()=>setTopDealsModal(true)} style={{ ...rBtnS, display:"flex", alignItems:"center", gap:4 }}>{"\uD83C\uDFC6"} Top 10 Deals</button>
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display:"flex", gap:24, marginBottom:24, borderBottom:`1px solid ${BORDER}` }}>
        {SUB_TABS.map((st,i)=>(
          <div key={i} onClick={()=>setSubTab(i)} style={{
            padding:"14px 4px", cursor:"pointer", fontSize:11, fontWeight:subTab===i?600:500,
            color:subTab===i?PURPLE:DIM, borderBottom:subTab===i?`2px solid ${PURPLE}`:"2px solid transparent",
            letterSpacing:".08em", transition:"all .2s", display:"flex", alignItems:"center", gap:8, userSelect:"none"
          }}>
            <span style={{ fontSize:14 }}>{st.icon}</span>
            <span style={{ textTransform:"uppercase" }}>{st.label}</span>
          </div>
        ))}
      </div>

      {/* ═══ SUB-TAB 0: Property Search ═══ */}
      {subTab===0 && (
        <div>
          {/* Filters */}
          <div style={{ ...rCardS, marginBottom:16, borderColor:PURPLE+"33" }}>
            <div style={{ fontSize:10, fontWeight:700, color:PURPLE, marginBottom:10, textTransform:"uppercase", letterSpacing:".06em" }}>Search Filters</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr", gap:8, marginBottom:8 }}>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>City</div><input style={rInputS} placeholder="e.g. Naples" value={searchFilters.city} onChange={e=>setSearchFilters({...searchFilters, city:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>State</div>
                <select style={rSelectS} value={searchFilters.state} onChange={e=>setSearchFilters({...searchFilters, state:e.target.value})}>
                  <option value="">Any</option>{US_STATES.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>ZIP</div><input style={rInputS} placeholder="e.g. 34104" value={searchFilters.zip} onChange={e=>setSearchFilters({...searchFilters, zip:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Min Price</div><input type="number" style={rInputS} placeholder="$0" value={searchFilters.minPrice} onChange={e=>setSearchFilters({...searchFilters, minPrice:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Max Price</div><input type="number" style={rInputS} placeholder="Any" value={searchFilters.maxPrice} onChange={e=>setSearchFilters({...searchFilters, maxPrice:e.target.value})} /></div>
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr", gap:8, marginBottom:10 }}>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Beds (min)</div><input type="number" style={rInputS} placeholder="Any" value={searchFilters.beds} onChange={e=>setSearchFilters({...searchFilters, beds:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Baths (min)</div><input type="number" style={rInputS} placeholder="Any" value={searchFilters.baths} onChange={e=>setSearchFilters({...searchFilters, baths:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Property Type</div>
                <select style={rSelectS} value={searchFilters.type} onChange={e=>setSearchFilters({...searchFilters, type:e.target.value})}>
                  <option value="">Any</option>{PROPERTY_TYPES.map(t=><option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Status</div>
                <select style={rSelectS} value={searchFilters.status} onChange={e=>setSearchFilters({...searchFilters, status:e.target.value})}>
                  <option value="">Any</option><option value="Active">Active</option><option value="Pending">Pending</option><option value="Sold">Sold</option>
                </select>
              </div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Min SqFt</div><input type="number" style={rInputS} placeholder="0" value={searchFilters.minSqft} onChange={e=>setSearchFilters({...searchFilters, minSqft:e.target.value})} /></div>
              <div><div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Max SqFt</div><input type="number" style={rInputS} placeholder="Any" value={searchFilters.maxSqft} onChange={e=>setSearchFilters({...searchFilters, maxSqft:e.target.value})} /></div>
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={runSearch} style={rBtnS}>{"\uD83D\uDD0D"} Search Properties</button>
              <button onClick={saveCurrentSearch} style={rBtnOutS}>{"\uD83D\uDCBE"} Save Search</button>
              <button onClick={()=>{setSearchFilters({ city:"", state:"", zip:"", minPrice:"", maxPrice:"", beds:"", baths:"", type:"", status:"", minSqft:"", maxSqft:"" });setSearchResults(MOCK_LISTINGS);setHasSearched(false);}} style={{ ...rBtnOutS, borderColor:DIM, color:DIM }}>Clear</button>
            </div>
          </div>

          {/* Bridge API / Data Source Notice */}
          <div style={{ ...rCardS, marginBottom:16, borderColor:BLUE+"33", display:"flex", alignItems:"center", gap:10, padding:10 }}>
            <span style={{ fontSize:14 }}>{"\uD83C\uDF10"}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:9, fontWeight:600, color:BLUE }}>Bridge API Integration</div>
              <div style={{ fontSize:8, color:DIM }}>{mlsConfigs.miami.status==="Connected"||mlsConfigs.stellar.status==="Connected"||mlsConfigs.swfl.status==="Connected" ? "Live MLS data available via Bridge API" : "Showing demo data — Connect an MLS in the MLS Connections tab to pull live listings"}</div>
            </div>
            <span style={{ ...badgeS(mlsConfigs.miami.status==="Connected"?GREEN:YELLOW), fontSize:7 }}>{mlsConfigs.miami.status==="Connected"?"LIVE":"DEMO"}</span>
          </div>

          {/* Results */}
          <div style={{ fontSize:9, color:DIM, marginBottom:8 }}>{hasSearched ? `${searchResults.length} result${searchResults.length!==1?"s":""}` : `Showing ${searchResults.length} demo listings`}</div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:12 }}>
            {searchResults.map(p=>(
              <div key={p.id} style={{ ...rCardS, position:"relative", transition:"border-color .2s" }}>
                {/* Photo placeholder */}
                <div style={{ background:BORDER, height:110, borderRadius:4, marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden" }}>
                  <span style={{ fontSize:32, opacity:.3 }}>{"\uD83C\uDFE0"}</span>
                </div>
                {/* Favorite star */}
                <div onClick={()=>toggleFavorite(p)} style={{ position:"absolute", top:20, right:20, cursor:"pointer", fontSize:16, filter:isFav(p.id)?"drop-shadow(0 0 4px #d4af37)":"none", transition:"all .2s" }}>
                  {isFav(p.id)?"\u2B50":"\u2606"}
                </div>
                {/* Status badge */}
                <span style={{ position:"absolute", top:20, left:20, fontSize:7, padding:"2px 7px", borderRadius:3, background:`${statusColors[p.status]||DIM}22`, color:statusColors[p.status]||DIM, fontWeight:700, letterSpacing:".04em", textTransform:"uppercase" }}>{p.status}</span>
                {/* Info */}
                <div style={{ fontSize:14, fontWeight:700, color:GOLD, marginBottom:2 }}>{fmtMoney(p.price)}</div>
                <div style={{ fontSize:10, color:BRIGHT, fontWeight:600, marginBottom:2 }}>{p.address}</div>
                <div style={{ fontSize:9, color:DIM, marginBottom:6 }}>{p.city}, {p.state} {p.zip}</div>
                <div style={{ display:"flex", gap:10, fontSize:9, color:TXT, marginBottom:6 }}>
                  <span>{p.beds} bd</span>
                  <span style={{ color:BORDER }}>|</span>
                  <span>{p.baths} ba</span>
                  <span style={{ color:BORDER }}>|</span>
                  <span>{Number(p.sqft).toLocaleString()} sqft</span>
                </div>
                <div style={{ display:"flex", justifyContent:"space-between", fontSize:8, color:DIM }}>
                  <span>{p.daysOnMarket}d on market</span>
                  <span>{p.agent}</span>
                </div>
                {p.mls && <div style={{ fontSize:7, color:DIM, marginTop:4 }}>MLS# {p.mls}</div>}
                <div style={{ display:"flex", gap:4, marginTop:8 }}>
                  <button onClick={()=>handleAnalyzeProperty(p)} disabled={analyzeLoading===p.id} style={{ ...rBtnOutS, fontSize:8, padding:"3px 8px", flex:1 }}>{analyzeLoading===p.id ? "..." : "\uD83D\uDD0D Analyze"}</button>
                  <button onClick={()=>handleNegotiate(p)} disabled={negotiateLoading===p.id} style={{ ...rBtnOutS, fontSize:8, padding:"3px 8px", flex:1, borderColor:GREEN, color:GREEN }}>{negotiateLoading===p.id ? "..." : "\uD83E\uDD1D Negotiate"}</button>
                </div>
              </div>
            ))}
          </div>
          {searchResults.length===0 && <div style={{ textAlign:"center", padding:40, color:DIM, fontSize:10 }}>No properties match your filters. Try broadening your search.</div>}
        </div>
      )}

      {/* ═══ SUB-TAB 1: Transactions ═══ */}
      {subTab===1 && (<div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:PURPLE,textTransform:"uppercase",letterSpacing:".06em"}}>Transactions ({transactions.length})</div>
          <button onClick={()=>setShowNewTx(!showNewTx)} style={rBtnS}>+ New Transaction</button>
        </div>
        {showNewTx&&(<div style={{...rCardS,marginBottom:12,borderColor:GOLD+"33"}}>
          <div style={{fontSize:10,fontWeight:700,color:GOLD,marginBottom:8}}>New Transaction</div>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 0.5fr 0.5fr",gap:6,marginBottom:6}}>
            {[["Property Address","property_address"],["City","property_city"],["State","property_state"],["ZIP","property_zip"]].map(([l,k])=>(<div key={k}><div style={{fontSize:7,color:DIM}}>{l}</div><input style={rInputS} value={txForm[k]} onChange={e=>setTxForm({...txForm,[k]:e.target.value})} /></div>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:6,marginBottom:6}}>
            {[["Buyer","buyer_name"],["Seller","seller_name"],["List Price","list_price"],["Contract Price","contract_price"]].map(([l,k])=>(<div key={k}><div style={{fontSize:7,color:DIM}}>{l}</div><input style={rInputS} value={txForm[k]} onChange={e=>setTxForm({...txForm,[k]:e.target.value})} /></div>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:8}}>
            <div><div style={{fontSize:7,color:DIM}}>Contract Date</div><input type="date" style={rInputS} value={txForm.contract_date} onChange={e=>setTxForm({...txForm,contract_date:e.target.value})} /></div>
            <div><div style={{fontSize:7,color:DIM}}>Closing Date</div><input type="date" style={rInputS} value={txForm.closing_date} onChange={e=>setTxForm({...txForm,closing_date:e.target.value})} /></div>
            <div><div style={{fontSize:7,color:DIM}}>Type</div><select style={rInputS} value={txForm.transaction_type} onChange={e=>setTxForm({...txForm,transaction_type:e.target.value})}><option value="purchase">Purchase</option><option value="listing">Listing</option><option value="lease">Lease</option></select></div>
          </div>
          <div style={{display:"flex",gap:6}}><button onClick={createTransaction} style={rBtnS}>Create</button><button onClick={()=>setShowNewTx(false)} style={{...rBtnOutS,borderColor:DIM,color:DIM}}>Cancel</button></div>
        </div>)}
        {transactions.length===0&&<div style={{...rCardS,textAlign:"center",color:DIM,fontSize:9,padding:30}}>No transactions yet. Click "+ New Transaction" to start.</div>}
        {transactions.map(tx=>(<div key={tx.id} onClick={()=>{setSelectedTx(tx);loadCompliance(tx.id);setSubTab(3);}} style={{...rCardS,marginBottom:8,cursor:"pointer",borderLeft:`3px solid ${stageColor(tx.stage)}`,transition:"all .2s"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><div style={{fontSize:10,color:BRIGHT,fontWeight:700}}>{tx.property_address}</div><div style={{fontSize:8,color:DIM}}>{tx.property_city}, {tx.property_state} {tx.property_zip}</div></div>
            <span style={{fontSize:7,padding:"2px 8px",borderRadius:3,background:stageColor(tx.stage)+"22",color:stageColor(tx.stage),fontWeight:700}}>{tx.stage}</span>
          </div>
          <div style={{display:"flex",gap:16,marginTop:6,fontSize:8,color:DIM}}>
            {tx.buyer_name&&<span>Buyer: <span style={{color:TXT}}>{tx.buyer_name}</span></span>}
            {tx.seller_name&&<span>Seller: <span style={{color:TXT}}>{tx.seller_name}</span></span>}
            {tx.contract_price&&<span>Price: <span style={{color:GOLD,fontWeight:700}}>${Number(tx.contract_price).toLocaleString()}</span></span>}
            {tx.closing_date&&<span>Closing: <span style={{color:TXT}}>{tx.closing_date}</span></span>}
          </div>
        </div>))}
      </div>)}

      {/* ═══ SUB-TAB 2: Contracts Library ═══ */}
      {subTab===2 && (<div>
        <div style={{fontSize:10,fontWeight:700,color:PURPLE,marginBottom:12,textTransform:"uppercase",letterSpacing:".06em"}}>Florida Real Estate Contract Library</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {FL_CONTRACTS.map((c,i)=>{
            const catColor = {Purchase:BLUE,Listing:PURPLE,Buyer:"#06b6d4",Addendum:YELLOW,Disclosure:"#f97316",Compensation:GOLD,Contract:GREEN}[c.category]||DIM;
            return (<div key={i} style={{...rCardS,borderLeft:`3px solid ${catColor}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div><div style={{fontSize:10,color:BRIGHT,fontWeight:600}}>{c.name}</div><div style={{fontSize:8,color:DIM,marginTop:2}}>Form: {c.form} | Updated: {c.updated}</div></div>
                <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:catColor+"22",color:catColor,fontWeight:600,whiteSpace:"nowrap"}}>{c.category}</span>
              </div>
              <div style={{display:"flex",gap:6,marginTop:8}}>
                <button style={{...rBtnOutS,fontSize:8,padding:"3px 10px"}}>Prepare</button>
                <button style={{...rBtnOutS,fontSize:8,padding:"3px 10px",borderColor:GOLD+"44",color:GOLD}}>DocuSign</button>
              </div>
            </div>);
          })}
        </div>
      </div>)}

      {/* ═══ SUB-TAB 3: Compliance ═══ */}
      {subTab===3 && (<div>
        <div style={{fontSize:10,fontWeight:700,color:PURPLE,marginBottom:4,textTransform:"uppercase",letterSpacing:".06em"}}>Transaction Compliance</div>
        {!selectedTx ? <div style={{...rCardS,textAlign:"center",color:DIM,fontSize:9,padding:30}}>Select a transaction from the Transactions tab to view compliance.</div> : (<>
          <div style={{fontSize:9,color:BRIGHT,marginBottom:12}}>Property: <strong>{selectedTx.property_address}</strong> | Stage: <span style={{color:stageColor(selectedTx.stage),fontWeight:700}}>{selectedTx.stage}</span></div>
          {(()=>{const done=complianceItems.filter(c=>c.is_completed).length;const total=complianceItems.length;const pct=total?Math.round(done/total*100):0;return(
            <div style={{...rCardS,marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:9,marginBottom:4}}><span style={{color:TXT}}>Compliance Progress</span><span style={{color:pct>=80?GREEN:pct>=50?YELLOW:RED,fontWeight:700}}>{pct}% ({done}/{total})</span></div>
              <div style={{height:6,background:BORDER,borderRadius:3,overflow:"hidden"}}><div style={{width:`${pct}%`,height:"100%",background:pct>=80?GREEN:pct>=50?YELLOW:RED,borderRadius:3,transition:"width .5s"}} /></div>
            </div>
          );})()}
          {[...new Set(complianceItems.map(c=>c.category))].map(cat=>(<div key={cat} style={{marginBottom:12}}>
            <div style={{fontSize:9,fontWeight:700,color:PURPLE,marginBottom:6,textTransform:"uppercase"}}>{cat}</div>
            {complianceItems.filter(c=>c.category===cat).map(item=>{
              const overdue = item.deadline && !item.is_completed && new Date(item.deadline) < new Date();
              const daysLeft = item.deadline && !item.is_completed ? Math.ceil((new Date(item.deadline)-new Date())/86400000) : null;
              return (<div key={item.id} style={{display:"flex",alignItems:"center",gap:8,padding:"4px 0",borderBottom:`1px solid ${BORDER}`}}>
                <input type="checkbox" checked={item.is_completed||false} onChange={async()=>{
                  const updated = !item.is_completed;
                  await sbUpdate("vault_re_compliance",item.id,{is_completed:updated,completed_at:updated?new Date().toISOString():null});
                  setComplianceItems(complianceItems.map(c=>c.id===item.id?{...c,is_completed:updated,completed_at:updated?new Date().toISOString():null}:c));
                }} style={{accentColor:GOLD}} />
                <div style={{flex:1}}><span style={{fontSize:9,color:item.is_completed?GREEN:overdue?RED:TXT,textDecoration:item.is_completed?"line-through":"none"}}>{item.item_name}</span></div>
                {item.deadline&&<span style={{fontSize:7,color:overdue?RED:daysLeft<=7?YELLOW:DIM}}>{overdue?"OVERDUE":daysLeft+"d left"}</span>}
                {item.is_completed&&item.completed_at&&<span style={{fontSize:7,color:GREEN}}>{new Date(item.completed_at).toLocaleDateString()}</span>}
              </div>);
            })}
          </div>))}
        </>)}
      </div>)}

      {/* ═══ SUB-TAB 4: Comp Analysis ═══ */}
      {subTab===4 && (
        <div>
          <div style={{ ...rCardS, marginBottom:16, borderColor:PURPLE+"33" }}>
            <div style={{ fontSize:10, fontWeight:700, color:PURPLE, marginBottom:10, textTransform:"uppercase", letterSpacing:".06em" }}>{"\uD83D\uDCCA"} Comparable Sales Analysis</div>
            <div style={{ display:"flex", gap:8, alignItems:"flex-end" }}>
              <div style={{ flex:1 }}>
                <div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Subject Property Address</div>
                <input style={rInputS} placeholder="Enter full address, e.g. 250 Ospreys Landing #1402, Naples FL 34104" value={compAddress} onChange={e=>setCompAddress(e.target.value)} />
              </div>
              <button onClick={runCompAnalysis} style={{ ...rBtnS, whiteSpace:"nowrap" }}>{"\uD83D\uDCCA"} Run Comp Analysis</button>
            </div>
          </div>

          {compRan && compResults.length>0 && (
            <>
              {/* Summary Stats */}
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr", gap:10, marginBottom:16 }}>
                {[
                  { label:"Avg Price", val:fmtMoney(compStats.avg), color:GOLD },
                  { label:"Median Price", val:fmtMoney(compStats.median), color:GREEN },
                  { label:"Price Range", val:`${fmtMoney(compStats.min)} — ${fmtMoney(compStats.max)}`, color:BLUE },
                  { label:"Avg $/SqFt", val:`$${compStats.avgPsf}`, color:PURPLE },
                  { label:"Comps Found", val:compResults.length, color:GOLD },
                ].map(s=>(
                  <div key={s.label} style={{ ...rCardS, textAlign:"center" }}>
                    <div style={{ fontSize:10, color:DIM, textTransform:"uppercase", letterSpacing:".08em" }}>{s.label}</div>
                    <div style={{ fontSize:13, fontWeight:700, color:s.color, marginTop:4 }}>{s.val}</div>
                  </div>
                ))}
              </div>

              {/* Comp Table */}
              <div style={{ ...rCardS }}>
                <div style={{ fontSize:10, fontWeight:700, color:GOLD, marginBottom:10, textTransform:"uppercase", letterSpacing:".06em" }}>Comparable Sales</div>
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
                    <thead>
                      <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                        {["Address","Sale Price","$/SqFt","Beds","Baths","Sale Date","Distance"].map(h=>(
                          <th key={h} style={{ textAlign:"left", padding:"6px 8px", color:DIM, fontWeight:600, fontSize:8, textTransform:"uppercase", letterSpacing:".05em" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {compResults.map((c,i)=>(
                        <tr key={i} style={{ borderBottom:`1px solid ${BORDER}22` }}>
                          <td style={{ padding:"6px 8px", color:BRIGHT, fontWeight:500 }}>{c.address}</td>
                          <td style={{ padding:"6px 8px", color:GOLD, fontWeight:700 }}>{fmtMoney(c.salePrice)}</td>
                          <td style={{ padding:"6px 8px", color:TXT }}>${c.priceSqft}</td>
                          <td style={{ padding:"6px 8px", color:TXT }}>{c.beds}</td>
                          <td style={{ padding:"6px 8px", color:TXT }}>{c.baths}</td>
                          <td style={{ padding:"6px 8px", color:DIM }}>{c.saleDate}</td>
                          <td style={{ padding:"6px 8px", color:DIM }}>{c.distance}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
          {compRan && compResults.length===0 && <div style={{ ...rCardS, textAlign:"center", color:DIM, fontSize:10, padding:30 }}>No comparable sales found. Try a different address.</div>}
          {!compRan && <div style={{ ...rCardS, textAlign:"center", color:DIM, fontSize:10, padding:30 }}>Enter a subject property address above and click "Run Comp Analysis" to see comparable sales.</div>}
        </div>
      )}

      {/* ═══ SUB-TAB 5: MLS Connections ═══ */}
      {subTab===5 && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:PURPLE, marginBottom:4, textTransform:"uppercase", letterSpacing:".06em" }}>{"\uD83D\uDD17"} MLS Connection Status</div>
          <div style={{ fontSize:8, color:DIM, marginBottom:16 }}>Connect to MLS feeds via Bridge API. When connected, property search will pull live data.</div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:14 }}>
            {[
              { key:"miami", name:"Miami MLS (MIAMI)", region:"Miami-Dade, Broward" },
              { key:"stellar", name:"Stellar MLS", region:"Central & SW Florida" },
              { key:"swfl", name:"SWFL MLS", region:"Lee, Collier, Charlotte" },
            ].map(mls=>{
              const cfg = mlsConfigs[mls.key];
              const sColor = cfg.status==="Connected"?GREEN:cfg.status==="Pending"?YELLOW:DIM;
              return (
                <div key={mls.key} style={{ ...rCardS, borderColor:sColor+"44" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:BRIGHT }}>{mls.name}</div>
                    <span style={{ fontSize:7, padding:"2px 8px", borderRadius:3, background:sColor+"22", color:sColor, fontWeight:700, letterSpacing:".04em", textTransform:"uppercase" }}>{cfg.status}</span>
                  </div>
                  <div style={{ fontSize:8, color:DIM, marginBottom:10 }}>Region: {mls.region}</div>

                  {editingMls===mls.key ? (
                    <div>
                      <div style={{ fontSize:8, color:DIM, marginBottom:3 }}>Bridge API Key</div>
                      <input style={{ ...rInputS, marginBottom:8 }} placeholder="Enter API key..." value={cfg.key} onChange={e=>setMlsConfigs({...mlsConfigs, [mls.key]:{...cfg, key:e.target.value}})} />
                      <div style={{ display:"flex", gap:6 }}>
                        <button onClick={()=>{setMlsConfigs({...mlsConfigs, [mls.key]:{...cfg, status:cfg.key?"Connected":"Not Connected"}}); setEditingMls(null); if(showToast) showToast(cfg.key?`${mls.name} connected`:`${mls.name} disconnected`);}} style={{ ...rBtnS, padding:"4px 10px", fontSize:9 }}>Save</button>
                        <button onClick={()=>setEditingMls(null)} style={{ ...rBtnOutS, padding:"4px 10px", fontSize:9, borderColor:DIM, color:DIM }}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={()=>setEditingMls(mls.key)} style={{ ...rBtnOutS, padding:"5px 12px", fontSize:9, width:"100%" }}>{"\u2699"} Configure</button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bridge API info */}
          <div style={{ ...rCardS, marginTop:16, borderColor:BLUE+"22" }}>
            <div style={{ fontSize:10, fontWeight:700, color:BLUE, marginBottom:6 }}>{"\uD83C\uDF10"} Bridge API Integration</div>
            <div style={{ fontSize:9, color:DIM, lineHeight:1.6 }}>
              When an MLS is connected with a valid Bridge API key, property searches will query live MLS data.
              Until connected, the platform displays demo listings for UI preview purposes.
              Bridge API supports property search, listing details, media, open houses, and agent rosters.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TITLE TAB
// ═══════════════════════════════════════════════════════════════════════════════

const TITLE_STAGES = ["New Order","Title Search","Exam/Review","Commitment Issued","Clearing Exceptions","Pre-Closing","Closing Scheduled","Closing Complete","Post-Closing","Recorded"];
const TITLE_STAGE_COLORS = {"New Order":BLUE,"Title Search":ORANGE,"Exam/Review":YELLOW,"Commitment Issued":"#06b6d4","Clearing Exceptions":RED,"Pre-Closing":PURPLE,"Closing Scheduled":"#14b8a6","Closing Complete":GREEN,"Post-Closing":"#64748b","Recorded":GOLD};
const TITLE_SEARCH_ITEMS = ["Ownership verified","Lien search complete","Judgment search","Tax search","HOA estoppel requested","Survey ordered","Municipal lien search"];

function TitleTab({ showToast }) {
  const [subTab, setSubTab] = useState(0);
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selOrder, setSelOrder] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [newForm, setNewForm] = useState({});

  // Filters
  const [fStage, setFStage] = useState("all");
  const [fCloser, setFCloser] = useState("all");
  const [fDateFrom, setFDateFrom] = useState("");
  const [fDateTo, setFDateTo] = useState("");

  // Wire form
  const [wireForm, setWireForm] = useState({ wire_type:"earnest money", amount:"", from_party:"", to_party:"", reference:"", status:"pending", date:"" });

  // Closing calc
  const [calc, setCalc] = useState({ purchase_price:"", loan_amount:"", seller_concessions:"", annual_taxes:"", hoa_annual:"", recording_fees:"200" });

  const loadOrders = useCallback(async () => {
    setLoading(true);
    const data = await sbFetch("vault_title_orders","?order=created_at.desc&limit=200");
    setOrders(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const saveOrder = async (id, patch) => {
    const updated = await sbUpdate("vault_title_orders", id, { ...patch, updated_at: new Date().toISOString() });
    if (updated) { setOrders(prev => prev.map(o => o.id === id ? { ...o, ...updated } : o)); if (selOrder && selOrder.id === id) setSelOrder({ ...selOrder, ...updated }); }
    return updated;
  };

  const createOrder = async () => {
    const body = { ...newForm, stage:"New Order", order_date: new Date().toISOString().slice(0,10) };
    const created = await sbInsert("vault_title_orders", body);
    if (created) { setOrders(prev => [created, ...prev]); setShowNew(false); setNewForm({}); if (showToast) showToast("Title order created"); }
  };

  // Filtered orders
  const filtered = useMemo(() => {
    let f = orders;
    if (fStage !== "all") f = f.filter(o => o.stage === fStage);
    if (fCloser !== "all") f = f.filter(o => o.assigned_closer === fCloser);
    if (fDateFrom) f = f.filter(o => o.order_date >= fDateFrom);
    if (fDateTo) f = f.filter(o => o.order_date <= fDateTo);
    return f;
  }, [orders, fStage, fCloser, fDateFrom, fDateTo]);

  const closers = useMemo(() => [...new Set(orders.map(o => o.assigned_closer).filter(Boolean))], [orders]);

  // Stats
  const stats = useMemo(() => {
    const now = new Date();
    const weekEnd = new Date(now); weekEnd.setDate(now.getDate() + (7 - now.getDay()));
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const open = orders.filter(o => !["Closing Complete","Post-Closing","Recorded"].includes(o.stage)).length;
    const closingThisWeek = orders.filter(o => { if (!o.closing_date) return false; const d = new Date(o.closing_date); return d >= now && d <= weekEnd; }).length;
    const revenueThisMonth = orders.filter(o => { if (!o.closing_date) return false; const d = new Date(o.closing_date); return d >= monthStart && d <= now; }).reduce((s, o) => s + (Number(o.closing_fee) || 0) + (Number(o.title_premium) || 0), 0);
    return { total: orders.length, open, closingThisWeek, revenueThisMonth };
  }, [orders]);

  const SUB_TABS = ["Order Tracker","Title Search","Closing Calculator","Wire Tracking","Closing Calendar"];

  // ── FL Closing Calculator Logic ──
  const calcResults = useMemo(() => {
    const pp = Number(calc.purchase_price) || 0;
    const la = Number(calc.loan_amount) || 0;
    const sc = Number(calc.seller_concessions) || 0;
    const annualTax = Number(calc.annual_taxes) || 0;
    const hoaAnnual = Number(calc.hoa_annual) || 0;
    const recFees = Number(calc.recording_fees) || 200;

    // FL title insurance: $5.75 per $1000 up to $100K, $5.00 per $1000 above
    const titleBase = pp <= 100000 ? pp * 5.75 / 1000 : (100000 * 5.75 / 1000) + ((pp - 100000) * 5.00 / 1000);
    const ownerPolicy = titleBase;
    const lenderPolicy = la <= 100000 ? la * 5.75 / 1000 : (100000 * 5.75 / 1000) + ((la - 100000) * 5.00 / 1000);
    // Simultaneous issue: lender policy at reduced rate when issued with owner's
    const lenderSimul = pp > 0 ? Math.max(0, lenderPolicy - ownerPolicy) + 25 : lenderPolicy;

    const docStampsDeed = Math.ceil(pp / 100) * 0.70;
    const docStampsMtg = Math.ceil(la / 100) * 0.35;
    const intangibleTax = Math.ceil(la / 100) * 0.20;

    const titleSearchFee = 200;
    const closingFee = 595;
    const wireFee = 50;
    const dailyTax = annualTax / 365;
    const dailyHoa = hoaAnnual / 365;

    const buyerTotal = lenderSimul + docStampsMtg + intangibleTax + recFees + titleSearchFee + closingFee + wireFee;
    const sellerTotal = ownerPolicy + docStampsDeed + sc;

    return { ownerPolicy, lenderPolicy: lenderSimul, docStampsDeed, docStampsMtg, intangibleTax, titleSearchFee, closingFee, wireFee, recFees, dailyTax, dailyHoa, buyerTotal, sellerTotal, pp, la };
  }, [calc]);

  return (
    <div>
      {/* Sub-tab nav */}
      <div style={{ display:"flex", gap:2, marginBottom:16, borderBottom:`1px solid ${BORDER}`, paddingBottom:8 }}>
        {SUB_TABS.map((t, i) => (
          <div key={i} onClick={() => setSubTab(i)} style={{
            padding:"14px 4px", cursor:"pointer", fontSize:11, fontWeight:subTab === i ? 600 : 500,
            color:subTab === i ? PURPLE : DIM, borderBottom:subTab === i ? `2px solid ${PURPLE}` : "2px solid transparent",
            letterSpacing:".08em", textTransform:"uppercase", transition:"all .2s", userSelect:"none"
          }}>{t}</div>
        ))}
      </div>

      {/* ═══ SUB-TAB 0: ORDER TRACKER ═══ */}
      {subTab === 0 && (
        <div>
          {/* Stats bar */}
          <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
            {[
              { label:"Total Orders", val:stats.total, color:PURPLE },
              { label:"Open", val:stats.open, color:BLUE },
              { label:"Closing This Week", val:stats.closingThisWeek, color:GREEN },
              { label:"Revenue This Month", val:fmtMoney(stats.revenueThisMonth), color:GOLD },
            ].map((s, i) => (
              <div key={i} style={{ ...cardS, flex:"1 1 160px", minWidth:140 }}>
                <div style={{ fontSize:8, color:DIM, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>{s.label}</div>
                <div style={{ fontSize:18, fontWeight:700, color:s.color }}>{s.val}</div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap", alignItems:"center" }}>
            <select value={fStage} onChange={e => setFStage(e.target.value)} style={{ ...selectS, width:"auto", minWidth:140 }}>
              <option value="all">All Stages</option>
              {TITLE_STAGES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={fCloser} onChange={e => setFCloser(e.target.value)} style={{ ...selectS, width:"auto", minWidth:140 }}>
              <option value="all">All Closers</option>
              {closers.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <input type="date" value={fDateFrom} onChange={e => setFDateFrom(e.target.value)} style={{ ...inputS, width:"auto" }} placeholder="From" />
            <input type="date" value={fDateTo} onChange={e => setFDateTo(e.target.value)} style={{ ...inputS, width:"auto" }} placeholder="To" />
            <button onClick={() => { setFStage("all"); setFCloser("all"); setFDateFrom(""); setFDateTo(""); }} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>Clear</button>
            <div style={{ flex:1 }} />
            <button onClick={() => setShowNew(true)} style={btnS}>+ New Order</button>
          </div>

          {loading && <div style={{ color:DIM, fontSize:10, padding:20, textAlign:"center" }}>Loading orders...</div>}

          {/* Order cards */}
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {filtered.map(o => (
              <div key={o.id} onClick={() => { setSelOrder(o); setSubTab(1); }} style={{ ...cardS, cursor:"pointer", display:"flex", gap:12, alignItems:"center", transition:"background .15s" }}
                onMouseEnter={e => e.currentTarget.style.background = CARD_HOVER} onMouseLeave={e => e.currentTarget.style.background = CARD}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:600, color:BRIGHT, marginBottom:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{o.property_address || "No Address"}</div>
                  <div style={{ fontSize:9, color:DIM }}>Buyer: {o.buyer_name || "—"} | Seller: {o.seller_name || "—"} | Lender: {o.lender || "—"}</div>
                </div>
                <div style={{ textAlign:"right", minWidth:100 }}>
                  <div style={{ fontSize:10, fontWeight:600, color:TXT }}>{fmtMoney(o.loan_amount)}</div>
                  <div style={{ fontSize:8, color:DIM }}>{o.order_date || "—"}</div>
                </div>
                <div style={{ textAlign:"right", minWidth:90 }}>
                  <div style={{ fontSize:8, color:DIM }}>Close: {o.closing_date || "TBD"}</div>
                  <div style={{ fontSize:8, color:DIM }}>{o.assigned_closer || "Unassigned"}</div>
                </div>
                <span style={badgeS(TITLE_STAGE_COLORS[o.stage] || PURPLE)}>{o.stage}</span>
              </div>
            ))}
            {!loading && filtered.length === 0 && (
              <div style={{ ...cardS, textAlign:"center", padding:32 }}>
                <div style={{ fontSize:24, marginBottom:8 }}>📜</div>
                <div style={{ fontSize:11, color:DIM }}>No title orders found. Click + New Order to create one.</div>
              </div>
            )}
          </div>

          {/* New Order Modal */}
          <Modal open={showNew} onClose={() => setShowNew(false)} title="New Title Order" width={560}>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10 }}>
              {[
                ["property_address","Property Address"],["buyer_name","Buyer Name"],["seller_name","Seller Name"],
                ["lender","Lender"],["loan_amount","Loan Amount"],["purchase_price","Purchase Price"],
                ["assigned_closer","Assigned Closer"],["closing_date","Closing Date"],
              ].map(([k, l]) => (
                <div key={k} style={k === "property_address" ? { gridColumn:"1/-1" } : {}}>
                  <label style={labelS}>{l}</label>
                  <input type={k === "closing_date" ? "date" : (k === "loan_amount" || k === "purchase_price") ? "number" : "text"}
                    value={newForm[k] || ""} onChange={e => setNewForm(p => ({ ...p, [k]: e.target.value }))}
                    style={inputS} />
                </div>
              ))}
              <div style={{ gridColumn:"1/-1" }}>
                <label style={labelS}>Service Type</label>
                <select value={newForm.service_type || ""} onChange={e => setNewForm(p => ({ ...p, service_type: e.target.value }))} style={selectS}>
                  <option value="">Select...</option>
                  {["Residential Purchase","Residential Refi","Commercial","Short Sale","REO/Foreclosure","Cash Deal","HELOC","Construction","1031 Exchange"].map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ gridColumn:"1/-1" }}>
                <label style={labelS}>Notes</label>
                <textarea value={newForm.notes || ""} onChange={e => setNewForm(p => ({ ...p, notes: e.target.value }))} style={{ ...inputS, height:50, resize:"vertical" }} />
              </div>
            </div>
            <div style={{ display:"flex", justifyContent:"flex-end", gap:8, marginTop:12 }}>
              <button onClick={() => setShowNew(false)} style={btnOutS}>Cancel</button>
              <button onClick={createOrder} style={btnS}>Create Order</button>
            </div>
          </Modal>
        </div>
      )}

      {/* ═══ SUB-TAB 1: TITLE SEARCH ═══ */}
      {subTab === 1 && (
        <div>
          {!selOrder ? (
            <div>
              <div style={{ fontSize:10, color:DIM, marginBottom:8 }}>Select an order to manage title search:</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {orders.map(o => (
                  <div key={o.id} onClick={() => setSelOrder(o)} style={{ ...cardS, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"background .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = CARD_HOVER} onMouseLeave={e => e.currentTarget.style.background = CARD}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600, color:BRIGHT }}>{o.property_address || "No Address"}</div>
                      <div style={{ fontSize:9, color:DIM }}>{o.buyer_name || "—"}</div>
                    </div>
                    <span style={badgeS(TITLE_STAGE_COLORS[o.stage] || PURPLE)}>{o.stage}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <TitleSearchSubTab order={selOrder} saveOrder={saveOrder} showToast={showToast} onBack={() => setSelOrder(null)} />
          )}
        </div>
      )}

      {/* ═══ SUB-TAB 2: CLOSING CALCULATOR ═══ */}
      {subTab === 2 && (
        <div>
          <div style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:12 }}>FL Closing Cost Calculator</div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:16 }}>
            {[
              ["purchase_price","Purchase Price"],["loan_amount","Loan Amount"],["seller_concessions","Seller Concessions"],
              ["annual_taxes","Annual Property Taxes"],["hoa_annual","Annual HOA"],["recording_fees","Recording Fees"],
            ].map(([k, l]) => (
              <div key={k}>
                <label style={labelS}>{l}</label>
                <input type="number" value={calc[k] || ""} onChange={e => setCalc(p => ({ ...p, [k]: e.target.value }))} style={inputS} placeholder="0" />
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
            {/* Buyer Side */}
            <div style={cardS}>
              <div style={{ fontSize:10, fontWeight:700, color:BLUE, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10, borderBottom:`1px solid ${BORDER}`, paddingBottom:6 }}>Buyer Side</div>
              {[
                ["Lender's Title Policy", calcResults.lenderPolicy],
                ["Doc Stamps on Mortgage", calcResults.docStampsMtg],
                ["Intangible Tax", calcResults.intangibleTax],
                ["Recording Fees", calcResults.recFees],
                ["Title Search Fee", calcResults.titleSearchFee],
                ["Closing Fee", calcResults.closingFee],
                ["Wire Fee", calcResults.wireFee],
              ].map(([label, val]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:TXT, padding:"3px 0", borderBottom:`1px solid ${BORDER}11` }}>
                  <span>{label}</span><span style={{ fontWeight:600 }}>{fmtMoney(val)}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontWeight:700, color:BLUE, marginTop:8, paddingTop:6, borderTop:`1px solid ${BORDER}` }}>
                <span>BUYER TOTAL</span><span>{fmtMoney(calcResults.buyerTotal)}</span>
              </div>
            </div>

            {/* Seller Side */}
            <div style={cardS}>
              <div style={{ fontSize:10, fontWeight:700, color:ORANGE, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10, borderBottom:`1px solid ${BORDER}`, paddingBottom:6 }}>Seller Side</div>
              {[
                ["Owner's Title Policy", calcResults.ownerPolicy],
                ["Doc Stamps on Deed", calcResults.docStampsDeed],
                ["Seller Concessions", Number(calc.seller_concessions) || 0],
              ].map(([label, val]) => (
                <div key={label} style={{ display:"flex", justifyContent:"space-between", fontSize:10, color:TXT, padding:"3px 0", borderBottom:`1px solid ${BORDER}11` }}>
                  <span>{label}</span><span style={{ fontWeight:600 }}>{fmtMoney(val)}</span>
                </div>
              ))}
              <div style={{ display:"flex", justifyContent:"space-between", fontSize:11, fontWeight:700, color:ORANGE, marginTop:8, paddingTop:6, borderTop:`1px solid ${BORDER}` }}>
                <span>SELLER TOTAL</span><span>{fmtMoney(calcResults.sellerTotal)}</span>
              </div>
            </div>
          </div>

          {/* Proration info */}
          <div style={{ ...cardS, marginTop:12 }}>
            <div style={{ fontSize:10, fontWeight:700, color:GOLD, textTransform:"uppercase", letterSpacing:".06em", marginBottom:8 }}>Daily Proration Rates</div>
            <div style={{ display:"flex", gap:24, fontSize:10, color:TXT }}>
              <span>Property Tax: <b style={{ color:BRIGHT }}>${calcResults.dailyTax.toFixed(2)}/day</b></span>
              <span>HOA: <b style={{ color:BRIGHT }}>${calcResults.dailyHoa.toFixed(2)}/day</b></span>
            </div>
          </div>

          <div style={{ display:"flex", gap:8, marginTop:12 }}>
            <button onClick={() => {
              const lines = [
                "=== SETTLEMENT STATEMENT ESTIMATE ===",
                `Purchase Price: ${fmtMoney(calcResults.pp)}`,
                `Loan Amount: ${fmtMoney(calcResults.la)}`,
                "",
                "--- BUYER COSTS ---",
                `Lender's Title Policy: ${fmtMoney(calcResults.lenderPolicy)}`,
                `Doc Stamps on Mortgage: ${fmtMoney(calcResults.docStampsMtg)}`,
                `Intangible Tax: ${fmtMoney(calcResults.intangibleTax)}`,
                `Recording Fees: ${fmtMoney(calcResults.recFees)}`,
                `Title Search Fee: ${fmtMoney(calcResults.titleSearchFee)}`,
                `Closing Fee: ${fmtMoney(calcResults.closingFee)}`,
                `Wire Fee: ${fmtMoney(calcResults.wireFee)}`,
                `BUYER TOTAL: ${fmtMoney(calcResults.buyerTotal)}`,
                "",
                "--- SELLER COSTS ---",
                `Owner's Title Policy: ${fmtMoney(calcResults.ownerPolicy)}`,
                `Doc Stamps on Deed: ${fmtMoney(calcResults.docStampsDeed)}`,
                `SELLER TOTAL: ${fmtMoney(calcResults.sellerTotal)}`,
                "",
                `Daily Tax Proration: $${calcResults.dailyTax.toFixed(2)}/day`,
                `Daily HOA Proration: $${calcResults.dailyHoa.toFixed(2)}/day`,
              ].join("\n");
              navigator.clipboard.writeText(lines);
              if (showToast) showToast("Settlement statement copied to clipboard");
            }} style={btnS}>Generate Settlement Statement</button>
            <button onClick={() => { if (showToast) showToast("Send to Client coming soon"); }} style={btnOutS}>Send to Client</button>
          </div>
        </div>
      )}

      {/* ═══ SUB-TAB 3: WIRE TRACKING ═══ */}
      {subTab === 3 && (
        <div>
          {!selOrder ? (
            <div>
              <div style={{ fontSize:10, color:DIM, marginBottom:8 }}>Select an order to track wires:</div>
              <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                {orders.map(o => (
                  <div key={o.id} onClick={() => setSelOrder(o)} style={{ ...cardS, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center", transition:"background .15s" }}
                    onMouseEnter={e => e.currentTarget.style.background = CARD_HOVER} onMouseLeave={e => e.currentTarget.style.background = CARD}>
                    <div>
                      <div style={{ fontSize:11, fontWeight:600, color:BRIGHT }}>{o.property_address || "No Address"}</div>
                      <div style={{ fontSize:9, color:DIM }}>{o.buyer_name} | {fmtMoney(o.loan_amount)}</div>
                    </div>
                    <span style={badgeS(TITLE_STAGE_COLORS[o.stage] || PURPLE)}>{o.stage}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <WireTrackingSubTab order={selOrder} saveOrder={saveOrder} showToast={showToast} onBack={() => setSelOrder(null)} />
          )}
        </div>
      )}

      {/* ═══ SUB-TAB 4: CLOSING CALENDAR ═══ */}
      {subTab === 4 && <ClosingCalendarSubTab orders={orders} onSelect={o => { setSelOrder(o); setSubTab(1); }} />}
    </div>
  );
}

// ── Title Search Sub-Tab Component ──
function TitleSearchSubTab({ order, saveOrder, showToast, onBack }) {
  const search = order.title_search || {};
  const exceptions = Array.isArray(order.exceptions) ? order.exceptions : [];
  const [newException, setNewException] = useState({ description:"", severity:"minor", resolution_plan:"" });

  const toggleItem = async (item, field, value) => {
    const updated = { ...search, [item]: { ...(search[item] || {}), [field]: value } };
    await saveOrder(order.id, { title_search: updated });
  };

  const addException = async () => {
    if (!newException.description) return;
    const exc = [...exceptions, { ...newException, id: Date.now(), created_at: new Date().toISOString() }];
    await saveOrder(order.id, { exceptions: exc });
    setNewException({ description:"", severity:"minor", resolution_plan:"" });
  };

  const resolveException = async (excId) => {
    const exc = exceptions.map(e => e.id === excId ? { ...e, resolved_date: new Date().toISOString().slice(0,10) } : e);
    await saveOrder(order.id, { exceptions: exc });
  };

  const markAllClear = async () => {
    const updated = {};
    TITLE_SEARCH_ITEMS.forEach(item => { updated[item] = { checked: true, status: "clear", date: new Date().toISOString().slice(0,10) }; });
    await saveOrder(order.id, { title_search: updated, stage: "Commitment Issued" });
    if (showToast) showToast("All items cleared - moved to Commitment Issued");
  };

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <button onClick={onBack} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>← Back</button>
        <div style={{ fontSize:11, fontWeight:700, color:BRIGHT }}>{order.property_address || "No Address"}</div>
        <span style={badgeS(TITLE_STAGE_COLORS[order.stage] || PURPLE)}>{order.stage}</span>
      </div>

      {/* Checklist */}
      <div style={{ ...cardS, marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Title Search Checklist</div>
        {TITLE_SEARCH_ITEMS.map(item => {
          const s = search[item] || {};
          return (
            <div key={item} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 0", borderBottom:`1px solid ${BORDER}22` }}>
              <input type="checkbox" checked={!!s.checked} onChange={e => toggleItem(item, "checked", e.target.checked)} style={{ accentColor:GOLD }} />
              <div style={{ flex:1, fontSize:10, color:s.checked ? GREEN : TXT }}>{item}</div>
              <select value={s.status || "pending"} onChange={e => toggleItem(item, "status", e.target.value)} style={{ ...selectS, width:90, fontSize:9, padding:"3px 6px" }}>
                <option value="pending">Pending</option>
                <option value="clear">Clear</option>
                <option value="exception">Exception</option>
              </select>
              <input type="date" value={s.date || ""} onChange={e => toggleItem(item, "date", e.target.value)} style={{ ...inputS, width:120, fontSize:9, padding:"3px 6px" }} />
              <input type="text" placeholder="Notes" value={s.notes || ""} onChange={e => toggleItem(item, "notes", e.target.value)} style={{ ...inputS, width:140, fontSize:9, padding:"3px 6px" }} />
            </div>
          );
        })}
        <div style={{ marginTop:10 }}>
          <button onClick={markAllClear} style={btnS}>All Clear → Commitment Issued</button>
        </div>
      </div>

      {/* Exception Log */}
      <div style={cardS}>
        <div style={{ fontSize:10, fontWeight:700, color:RED, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Exception Log</div>
        {exceptions.length === 0 && <div style={{ fontSize:9, color:DIM, padding:8 }}>No exceptions found.</div>}
        {exceptions.map(ex => (
          <div key={ex.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}22` }}>
            <span style={badgeS(ex.severity === "fatal" ? RED : ex.severity === "major" ? ORANGE : YELLOW)}>{ex.severity}</span>
            <div style={{ flex:1, fontSize:10, color:TXT }}>{ex.description}</div>
            <div style={{ fontSize:9, color:DIM, maxWidth:160 }}>{ex.resolution_plan}</div>
            {ex.resolved_date ? (
              <span style={badgeS(GREEN)}>Resolved {ex.resolved_date}</span>
            ) : (
              <button onClick={() => resolveException(ex.id)} style={{ ...btnSmS, fontSize:8 }}>Resolve</button>
            )}
          </div>
        ))}
        <div style={{ display:"flex", gap:6, marginTop:10, alignItems:"flex-end" }}>
          <div style={{ flex:1 }}>
            <label style={labelS}>Description</label>
            <input value={newException.description} onChange={e => setNewException(p => ({ ...p, description: e.target.value }))} style={inputS} />
          </div>
          <div style={{ width:100 }}>
            <label style={labelS}>Severity</label>
            <select value={newException.severity} onChange={e => setNewException(p => ({ ...p, severity: e.target.value }))} style={selectS}>
              <option value="minor">Minor</option>
              <option value="major">Major</option>
              <option value="fatal">Fatal</option>
            </select>
          </div>
          <div style={{ flex:1 }}>
            <label style={labelS}>Resolution Plan</label>
            <input value={newException.resolution_plan} onChange={e => setNewException(p => ({ ...p, resolution_plan: e.target.value }))} style={inputS} />
          </div>
          <button onClick={addException} style={btnSmS}>+ Add</button>
        </div>
      </div>
    </div>
  );
}

// ── Wire Tracking Sub-Tab Component ──
function WireTrackingSubTab({ order, saveOrder, showToast, onBack }) {
  const wires = Array.isArray(order.wire_tracking) ? order.wire_tracking : [];
  const [wireForm, setWireForm] = useState({ wire_type:"earnest money", amount:"", from_party:"", to_party:"", reference:"", status:"pending", date:"" });

  const addWire = async () => {
    if (!wireForm.amount) return;
    const updated = [...wires, { ...wireForm, id: Date.now(), amount: Number(wireForm.amount) }];
    await saveOrder(order.id, { wire_tracking: updated });
    setWireForm({ wire_type:"earnest money", amount:"", from_party:"", to_party:"", reference:"", status:"pending", date:"" });
    if (showToast) showToast("Wire added");
  };

  const updateWireStatus = async (wireId, status) => {
    const updated = wires.map(w => w.id === wireId ? { ...w, status } : w);
    await saveOrder(order.id, { wire_tracking: updated });
  };

  const incoming = wires.filter(w => ["earnest money","closing funds"].includes(w.wire_type));
  const outgoing = wires.filter(w => ["payoff","disbursement"].includes(w.wire_type));
  const totalIn = incoming.reduce((s, w) => s + (Number(w.amount) || 0), 0);
  const totalOut = outgoing.reduce((s, w) => s + (Number(w.amount) || 0), 0);
  const escrowBalance = totalIn - totalOut;
  const overdue = wires.filter(w => w.status === "pending" && w.date && new Date(w.date) < new Date());

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12 }}>
        <button onClick={onBack} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>← Back</button>
        <div style={{ fontSize:11, fontWeight:700, color:BRIGHT }}>{order.property_address || "No Address"}</div>
        <span style={badgeS(TITLE_STAGE_COLORS[order.stage] || PURPLE)}>{order.stage}</span>
      </div>

      {/* Escrow summary */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        <div style={{ ...cardS, flex:"1 1 140px" }}>
          <div style={{ fontSize:8, color:DIM, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Total Incoming</div>
          <div style={{ fontSize:16, fontWeight:700, color:GREEN }}>{fmtMoney(totalIn)}</div>
        </div>
        <div style={{ ...cardS, flex:"1 1 140px" }}>
          <div style={{ fontSize:8, color:DIM, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Total Outgoing</div>
          <div style={{ fontSize:16, fontWeight:700, color:RED }}>{fmtMoney(totalOut)}</div>
        </div>
        <div style={{ ...cardS, flex:"1 1 140px" }}>
          <div style={{ fontSize:8, color:DIM, textTransform:"uppercase", letterSpacing:".08em", marginBottom:4 }}>Escrow Balance</div>
          <div style={{ fontSize:16, fontWeight:700, color:escrowBalance >= 0 ? GREEN : RED }}>{fmtMoney(escrowBalance)}</div>
        </div>
      </div>

      {escrowBalance < 0 && (
        <div style={{ background:RED+"22", border:`1px solid ${RED}`, borderRadius:6, padding:10, marginBottom:12, fontSize:10, color:RED, fontWeight:600 }}>
          ⚠ Warning: Outgoing funds exceed incoming. Escrow balance is negative.
        </div>
      )}

      {overdue.length > 0 && (
        <div style={{ background:ORANGE+"22", border:`1px solid ${ORANGE}`, borderRadius:6, padding:10, marginBottom:12, fontSize:10, color:ORANGE, fontWeight:600 }}>
          ⚠ {overdue.length} overdue wire(s) — expected but not received.
        </div>
      )}

      {/* Wire list */}
      <div style={{ ...cardS, marginBottom:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Wire Log</div>
        {wires.length === 0 && <div style={{ fontSize:9, color:DIM, padding:8 }}>No wires logged.</div>}
        {wires.map(w => (
          <div key={w.id} style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 0", borderBottom:`1px solid ${BORDER}22` }}>
            <span style={badgeS(["earnest money","closing funds"].includes(w.wire_type) ? GREEN : RED)}>{w.wire_type}</span>
            <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, minWidth:80 }}>{fmtMoney(w.amount)}</div>
            <div style={{ flex:1, fontSize:9, color:DIM }}>{w.from_party} → {w.to_party}</div>
            <div style={{ fontSize:9, color:DIM }}>{w.reference || "—"}</div>
            <div style={{ fontSize:9, color:DIM }}>{w.date || "—"}</div>
            <select value={w.status} onChange={e => updateWireStatus(w.id, e.target.value)} style={{ ...selectS, width:90, fontSize:9, padding:"3px 6px" }}>
              <option value="pending">Pending</option>
              <option value="received">Received</option>
              <option value="sent">Sent</option>
              <option value="confirmed">Confirmed</option>
            </select>
          </div>
        ))}
      </div>

      {/* Add wire */}
      <div style={cardS}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, textTransform:"uppercase", letterSpacing:".06em", marginBottom:10 }}>Add Wire</div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8 }}>
          <div>
            <label style={labelS}>Type</label>
            <select value={wireForm.wire_type} onChange={e => setWireForm(p => ({ ...p, wire_type: e.target.value }))} style={selectS}>
              <option value="earnest money">Earnest Money</option>
              <option value="closing funds">Closing Funds</option>
              <option value="payoff">Payoff</option>
              <option value="disbursement">Disbursement</option>
            </select>
          </div>
          <div>
            <label style={labelS}>Amount</label>
            <input type="number" value={wireForm.amount} onChange={e => setWireForm(p => ({ ...p, amount: e.target.value }))} style={inputS} />
          </div>
          <div>
            <label style={labelS}>Date</label>
            <input type="date" value={wireForm.date} onChange={e => setWireForm(p => ({ ...p, date: e.target.value }))} style={inputS} />
          </div>
          <div>
            <label style={labelS}>From</label>
            <input value={wireForm.from_party} onChange={e => setWireForm(p => ({ ...p, from_party: e.target.value }))} style={inputS} />
          </div>
          <div>
            <label style={labelS}>To</label>
            <input value={wireForm.to_party} onChange={e => setWireForm(p => ({ ...p, to_party: e.target.value }))} style={inputS} />
          </div>
          <div>
            <label style={labelS}>Reference #</label>
            <input value={wireForm.reference} onChange={e => setWireForm(p => ({ ...p, reference: e.target.value }))} style={inputS} />
          </div>
        </div>
        <div style={{ marginTop:10 }}>
          <button onClick={addWire} style={btnS}>+ Add Wire</button>
        </div>
      </div>
    </div>
  );
}

// ── Closing Calendar Sub-Tab Component ──
function ClosingCalendarSubTab({ orders, onSelect }) {
  const [viewDate, setViewDate] = useState(new Date());
  const year = viewDate.getFullYear();
  const month = viewDate.getMonth();
  const today = new Date();
  const todayStr = today.toISOString().slice(0,10);

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = viewDate.toLocaleDateString("en-US", { month:"long", year:"numeric" });

  // Get current week bounds (Sun-Sat)
  const curWeekStart = new Date(today); curWeekStart.setDate(today.getDate() - today.getDay());
  const curWeekEnd = new Date(curWeekStart); curWeekEnd.setDate(curWeekStart.getDate() + 6);

  const closings = useMemo(() => {
    const map = {};
    orders.forEach(o => {
      if (!o.closing_date) return;
      const d = o.closing_date.slice(0,10);
      if (!map[d]) map[d] = [];
      map[d].push(o);
    });
    return map;
  }, [orders]);

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1));
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1));

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12 }}>
        <button onClick={prevMonth} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>←</button>
        <div style={{ fontSize:13, fontWeight:700, color:BRIGHT, minWidth:160, textAlign:"center" }}>{monthLabel}</div>
        <button onClick={nextMonth} style={{ ...btnSmS, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>→</button>
        <button onClick={() => setViewDate(new Date())} style={{ ...btnSmS, background:"transparent", border:`1px solid ${GOLD}`, color:GOLD }}>Today</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(7, 1fr)", gap:2 }}>
        {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(d => (
          <div key={d} style={{ fontSize:9, color:DIM, textAlign:"center", padding:"6px 0", fontWeight:600, textTransform:"uppercase", letterSpacing:".06em" }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`e${i}`} style={{ background:CARD, border:`1px solid ${BORDER}22`, borderRadius:4, minHeight:80 }} />;
          const dateStr = `${year}-${String(month + 1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
          const dayClosings = closings[dateStr] || [];
          const isToday = dateStr === todayStr;
          const cellDate = new Date(year, month, day);
          const isCurrentWeek = cellDate >= curWeekStart && cellDate <= curWeekEnd;

          return (
            <div key={day} style={{
              background:isToday ? PURPLE + "22" : isCurrentWeek ? CARD_HOVER : CARD,
              border:`1px solid ${isToday ? PURPLE : BORDER}`,
              borderRadius:4, minHeight:80, padding:4, position:"relative"
            }}>
              <div style={{ fontSize:9, fontWeight:isToday ? 700 : 500, color:isToday ? PURPLE : DIM, marginBottom:2 }}>{day}</div>
              {dayClosings.map(o => {
                const status = o.stage === "Closing Complete" || o.stage === "Recorded" ? "confirmed" : o.stage === "Closing Scheduled" ? "confirmed" : "tentative";
                const color = status === "confirmed" ? GREEN : status === "tentative" ? YELLOW : RED;
                return (
                  <div key={o.id} onClick={() => onSelect(o)} style={{
                    background:color + "22", border:`1px solid ${color}44`, borderRadius:3,
                    padding:"2px 4px", marginBottom:2, cursor:"pointer", fontSize:8, color, lineHeight:1.3
                  }}>
                    <div style={{ fontWeight:600, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{o.buyer_name || "—"}</div>
                    <div style={{ opacity:.8, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{o.property_address || ""}</div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// TAB 8: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ loans }) {
  const [referralLeaderboard, setReferralLeaderboard] = useState([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  useEffect(() => {
    setLeaderboardLoading(true);
    edgeFn("follow-up-engine/referral/leaderboard", null, "GET")
      .then(res => { if (Array.isArray(res)) setReferralLeaderboard(res); else setReferralLeaderboard([]); })
      .catch(() => setReferralLeaderboard([]))
      .finally(() => setLeaderboardLoading(false));
  }, []);

  // Loans by stage
  const byStage = useMemo(() => {
    const m = {};
    STAGES.forEach(s => m[s]=0);
    loans.forEach(l => { const s=l.stage||"Lead"; if (m[s]!==undefined) m[s]++; });
    return Object.entries(m).map(([stage,count]) => ({ stage, count }));
  }, [loans]);

  const maxStageCount = Math.max(1, ...byStage.map(s=>s.count));

  // Monthly volume (last 6 months)
  const monthlyVolume = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i=5; i>=0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const label = d.toLocaleDateString("en-US",{month:"short",year:"2-digit"});
      const count = loans.filter(l => {
        const c = new Date(l.created_at);
        return c.getMonth()===d.getMonth() && c.getFullYear()===d.getFullYear();
      }).length;
      const volume = loans.filter(l => {
        const c = new Date(l.created_at);
        return c.getMonth()===d.getMonth() && c.getFullYear()===d.getFullYear();
      }).reduce((s,l)=>s+(l.loan_amount||0),0);
      months.push({ label, count, volume });
    }
    return months;
  }, [loans]);

  const maxVol = Math.max(1, ...monthlyVolume.map(m=>m.volume));

  // Top lenders
  const topLenders = useMemo(() => {
    const m = {};
    loans.forEach(l => {
      if (!l.lender) return;
      if (!m[l.lender]) m[l.lender]={ name:l.lender, count:0, volume:0 };
      m[l.lender].count++;
      m[l.lender].volume += l.loan_amount||0;
    });
    return Object.values(m).sort((a,b)=>b.volume-a.volume).slice(0,8);
  }, [loans]);

  const maxLenderVol = Math.max(1, ...topLenders.map(l=>l.volume));

  // Avg days to close (funded only)
  const fundedLoans = loans.filter(l => l.stage==="Funded" && l.funded_at);
  const avgDays = fundedLoans.length ? Math.round(fundedLoans.reduce((s,l)=>s+daysBetween(l.created_at,l.funded_at),0)/fundedLoans.length) : 0;

  // Pull-through rate
  const appLoans = loans.filter(l => !["Lead","Pre-Qual"].includes(l.stage));
  const funded = loans.filter(l => l.stage==="Funded");
  const pullThrough = appLoans.length ? Math.round((funded.length/appLoans.length)*100) : 0;

  // Revenue
  const monthlyRevenue = useMemo(() => {
    const months = [];
    const now = new Date();
    for (let i=5; i>=0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
      const label = d.toLocaleDateString("en-US",{month:"short",year:"2-digit"});
      const rev = loans.filter(l => {
        if (l.stage!=="Funded"||!l.funded_at) return false;
        const c = new Date(l.funded_at);
        return c.getMonth()===d.getMonth() && c.getFullYear()===d.getFullYear();
      }).reduce((s,l)=>s+(l.commission||0),0);
      months.push({ label, rev });
    }
    return months;
  }, [loans]);
  const maxRev = Math.max(1, ...monthlyRevenue.map(m=>m.rev));

  const BarChart_ = ({ data, labelKey, valueKey, maxVal, color, formatVal }) => (
    <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
      {data.map((item,i) => (
        <div key={i} style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:80, fontSize:8, color:DIM, textAlign:"right", flexShrink:0, letterSpacing:".04em" }}>{item[labelKey]}</div>
          <div style={{ flex:1, background:BORDER, borderRadius:2, height:14, position:"relative", overflow:"hidden" }}>
            <div style={{ background:color, height:14, borderRadius:2, width:`${Math.max(1,(item[valueKey]/maxVal)*100)}%`, transition:"width .4s" }} />
            <span style={{ position:"absolute", left:6, top:1, fontSize:8, color:BRIGHT, fontWeight:600 }}>{formatVal?formatVal(item[valueKey]):item[valueKey]}</span>
          </div>
        </div>
      ))}
    </div>
  );

  return (
    <div>
      {/* Top stat cards */}
      <div style={{ display:"flex", gap:12, marginBottom:16, flexWrap:"wrap" }}>
        {[
          { label:"Total Loans", val:loans.length, color:BLUE },
          { label:"Active Pipeline", val:loans.filter(l=>!["Funded","Denied"].includes(l.stage)).length, color:GOLD },
          { label:"Avg Days to Close", val:avgDays+"d", color:GREEN },
          { label:"Pull-Through Rate", val:pullThrough+"%", color:pullThrough>=60?GREEN:pullThrough>=40?YELLOW:RED },
          { label:"Total Funded", val:funded.length, color:GREEN },
          { label:"Total Volume", val:fmtMoney(loans.reduce((s,l)=>s+(l.loan_amount||0),0)), color:GOLD },
        ].map((s,i) => (
          <div key={i} style={{ ...cardS, flex:"1 1 170px", minWidth:150, borderLeft:`3px solid ${s.color}` }}>
            <div style={{ fontSize:10, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>{s.label}</div>
            <div style={{ fontSize:28, fontWeight:700, color:s.color, marginTop:6 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Loans by Stage */}
        <div style={cardS}>
          <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Loans by Stage</div>
          <BarChart_ data={byStage} labelKey="stage" valueKey="count" maxVal={maxStageCount} color={BLUE} />
        </div>

        {/* Monthly Volume */}
        <div style={cardS}>
          <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Monthly Volume</div>
          <BarChart_ data={monthlyVolume} labelKey="label" valueKey="volume" maxVal={maxVol} color={GREEN} formatVal={fmtMoney} />
        </div>

        {/* Top Lenders */}
        <div style={cardS}>
          <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Top Lenders</div>
          {topLenders.length===0 && <div style={{ fontSize:9, color:DIM }}>No lender data yet.</div>}
          <BarChart_ data={topLenders} labelKey="name" valueKey="volume" maxVal={maxLenderVol} color={GOLD} formatVal={fmtMoney} />
        </div>

        {/* Monthly Revenue */}
        <div style={cardS}>
          <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Monthly Revenue (Commissions)</div>
          <BarChart_ data={monthlyRevenue} labelKey="label" valueKey="rev" maxVal={maxRev} color={GOLD} formatVal={fmtMoney} />
        </div>
      </div>

      {/* Pipeline Funnel */}
      <div style={{ ...cardS, marginTop:12 }}>
        <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Pipeline Funnel</div>
        <div style={{ display:"flex", alignItems:"flex-end", gap:2, height:120 }}>
          {STAGES.filter(s=>s!=="Denied").map((stage,i) => {
            const count = byStage.find(b=>b.stage===stage)?.count||0;
            const maxC = Math.max(1,...byStage.map(b=>b.count));
            const h = Math.max(8, (count/maxC)*100);
            const stageColors = [BLUE, BLUE, GOLD, GOLD, GOLD, GREEN, GREEN, GREEN];
            return (
              <div key={stage} style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", gap:4 }}>
                <div style={{ fontSize:10, fontWeight:700, color:stageColors[i]||BLUE }}>{count}</div>
                <div style={{ width:"80%", height:h, background:stageColors[i]||BLUE, borderRadius:"3px 3px 0 0", transition:"height .4s", minHeight:4 }} />
                <div style={{ fontSize:7, color:DIM, textAlign:"center", letterSpacing:".04em", lineHeight:1.2 }}>{stage}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Activity */}
      <div style={{ ...cardS, marginTop:12 }}>
        <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Recent Activity</div>
        {loans.slice(0,10).map((l,i) => (
          <div key={i} style={{ display:"flex", gap:8, alignItems:"center", padding:"5px 0", borderBottom:`1px solid ${BORDER}11` }}>
            <div style={{ width:6, height:6, borderRadius:3, background:l.stage==="Funded"?GREEN:l.stage==="Denied"?RED:BLUE, flexShrink:0 }} />
            <div style={{ flex:1, fontSize:9, color:TXT }}>
              <span style={{ color:BRIGHT, fontWeight:600 }}>{l.first_name} {l.last_name}</span>
              <span style={{ color:DIM }}> — </span>
              <span style={badgeS(l.stage==="Funded"?GREEN:l.stage==="Denied"?RED:BLUE)}>{l.stage}</span>
              <span style={{ color:DIM }}> — {fmtMoney(l.loan_amount)}</span>
            </div>
            <div style={{ fontSize:8, color:DIM }}>{l.updated_at ? new Date(l.updated_at).toLocaleDateString() : ""}</div>
          </div>
        ))}
        {loans.length===0 && <div style={{ fontSize:9, color:DIM }}>No activity yet.</div>}
      </div>

      {/* Loan Officer Performance (if multiple LOs) */}
      {(() => {
        const loMap = {};
        loans.forEach(l => {
          const lo = l.loan_officer || "Unassigned";
          if (!loMap[lo]) loMap[lo] = { name:lo, total:0, funded:0, volume:0 };
          loMap[lo].total++;
          if (l.stage==="Funded") { loMap[lo].funded++; loMap[lo].volume += l.loan_amount||0; }
        });
        const loData = Object.values(loMap).sort((a,b)=>b.volume-a.volume);
        if (loData.length<=1) return null;
        const maxLoVol = Math.max(1,...loData.map(l=>l.volume));
        return (
          <div style={{ ...cardS, marginTop:12 }}>
            <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16 }}>Loan Officer Performance</div>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
              <thead>
                <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                  {["Loan Officer","Total Loans","Funded","Volume","Conv %"].map(h=>(
                    <th key={h} style={{ padding:"4px 6px", textAlign:"left", fontSize:8, color:DIM, letterSpacing:".06em", fontWeight:600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loData.map((lo,i) => (
                  <tr key={i} style={{ borderBottom:`1px solid ${BORDER}11` }}>
                    <td style={{ padding:"4px 6px", color:BRIGHT }}>{lo.name}</td>
                    <td style={{ padding:"4px 6px" }}>{lo.total}</td>
                    <td style={{ padding:"4px 6px", color:GREEN }}>{lo.funded}</td>
                    <td style={{ padding:"4px 6px", color:GOLD }}>{fmtMoney(lo.volume)}</td>
                    <td style={{ padding:"4px 6px" }}>{lo.total?Math.round((lo.funded/lo.total)*100):0}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })()}

      {/* ─── Referral Leaderboard ─────────────────────────────────────── */}
      <div style={{ ...cardS, marginTop:12 }}>
        <div style={{ fontSize:11, fontWeight:600, color:GOLD, letterSpacing:".1em", textTransform:"uppercase", marginBottom:16, display:"flex", alignItems:"center", gap:6 }}>
          {"\uD83C\uDFC6"} Referral Leaderboard
          {leaderboardLoading && <span style={{ fontSize:8, color:DIM, fontWeight:400 }}>Loading...</span>}
        </div>
        {referralLeaderboard.length > 0 ? (
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:9 }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                {["#","Referral Partner","Company","Referrals","Total Fees"].map(h=>(
                  <th key={h} style={{ padding:"4px 6px", textAlign:"left", fontSize:8, color:DIM, letterSpacing:".06em", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {referralLeaderboard.slice(0,5).map((r,i) => (
                <tr key={i} style={{ borderBottom:`1px solid ${BORDER}11` }}>
                  <td style={{ padding:"4px 6px", color:i===0?GOLD:i===1?"#c0c0c0":i===2?"#cd7f32":TXT, fontWeight:700 }}>{i+1}</td>
                  <td style={{ padding:"4px 6px", color:BRIGHT }}>{r.referrer_name || r.name || "—"}</td>
                  <td style={{ padding:"4px 6px", color:DIM }}>{r.referrer_company || r.company || "—"}</td>
                  <td style={{ padding:"4px 6px", color:BLUE }}>{r.referral_count || r.count || 0}</td>
                  <td style={{ padding:"4px 6px", color:GREEN, fontWeight:700 }}>{fmtMoney(r.total_fees || r.fees || 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ fontSize:9, color:DIM, textAlign:"center", padding:16 }}>
            {leaderboardLoading ? "Loading referral data..." : "No referral data yet. Log referrals from the Pipeline tab."}
          </div>
        )}
      </div>

      {/* No data message */}
      {loans.length===0 && (
        <div style={{ ...cardS, textAlign:"center", padding:32, marginTop:16 }}>
          <div style={{ fontSize:24, marginBottom:8 }}>📊</div>
          <div style={{ fontSize:11, color:DIM }}>No loan data yet. Create loans in the Pipeline or Application tab to see analytics.</div>
        </div>
      )}
    </div>
  );
}
