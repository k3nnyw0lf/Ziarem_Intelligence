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
const BG = "#0a0a12";
const CARD = "#111118";
const BORDER = "#1a1a24";
const INPUT_BG = "#08080f";
const INPUT_BD = "#1e1e28";
const TXT = "#ccc";
const DIM = "#777";
const BRIGHT = "#eee";
const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#6366f1";
const YELLOW = "#eab308";
const ORANGE = "#f97316";
const PURPLE = "#8b5cf6";
const CARD_HOVER = "#161620";

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
const inputS = { background:INPUT_BG, border:`1px solid ${INPUT_BD}`, color:TXT, padding:"6px 10px", fontSize:10, borderRadius:4, outline:"none", width:"100%", boxSizing:"border-box", letterSpacing:".05em" };
const selectS = { ...inputS, appearance:"none", cursor:"pointer" };
const labelS = { fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase", marginBottom:2, display:"block" };
const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:6, padding:12 };
const btnS = { background:GOLD, color:"#000", border:"none", borderRadius:4, padding:"6px 14px", fontSize:10, fontWeight:600, cursor:"pointer", letterSpacing:".05em" };
const btnOutS = { ...btnS, background:"transparent", border:`1px solid ${GOLD}`, color:GOLD };
const btnSmS = { ...btnS, padding:"4px 10px", fontSize:9 };
const badgeS = (bg) => ({ background:bg+"22", color:bg, padding:"2px 6px", borderRadius:3, fontSize:8, fontWeight:600, letterSpacing:".04em" });

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
];

const DEFAULT_STAGES = ["Lead","Contacted","Proposal","In Progress","Review","Closing","Completed","Lost"];

export default function MortgagePOSView({ user, contacts, showToast }) {
  const [tab, setTab] = useState(0);
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
  ];

  return (
    <div style={{ background:BG, minHeight:"100vh", color:TXT, fontFamily:"'Inter','Segoe UI',system-ui,sans-serif" }}>
      {/* ── BUSINESS SELECTOR BAR ────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:4, background:"#0a0a0f", padding:"8px 16px", borderBottom:`1px solid ${BORDER}`, overflowX:"auto" }}>
        {BUSINESSES.map(b=>(
          <div key={b.id} onClick={()=>{ setActiveBiz(b.id); }} style={{
            padding:"6px 14px", cursor:"pointer", fontSize:11, fontWeight:activeBiz===b.id?700:500,
            color:activeBiz===b.id?"#fff":DIM, background:activeBiz===b.id?b.color+"22":"transparent",
            border:`1px solid ${activeBiz===b.id?b.color:BORDER}`, borderRadius:20,
            display:"flex", alignItems:"center", gap:6, whiteSpace:"nowrap", transition:"all .2s",
            userSelect:"none"
          }}>
            <span style={{ fontSize:13 }}>{b.icon}</span>
            <span>{b.label}</span>
            {bizStats[b.id]>0 && <span style={{ background:b.color+"33", color:b.color, fontSize:10, padding:"1px 6px", borderRadius:8, fontWeight:700 }}>{bizStats[b.id]}</span>}
          </div>
        ))}
      </div>
      {/* ── TAB NAV ─────────────────────────────────────────────────────── */}
      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${BORDER}`, background:CARD, padding:"0 16px", position:"sticky", top:0, zIndex:50, alignItems:"center" }}>
        <div style={{ display:"flex", flex:1 }}>
          {TABS.map((t,i)=>(
            <div key={i} onClick={()=>setTab(i)} style={{
              padding:"10px 18px", cursor:"pointer", fontSize:10, fontWeight:tab===i?700:500,
              color:tab===i?(activeBizConfig.color||GOLD):DIM, borderBottom:tab===i?`2px solid ${activeBizConfig.color||GOLD}`:"2px solid transparent",
              letterSpacing:".06em", transition:"all .2s", display:"flex", alignItems:"center", gap:6,
              userSelect:"none"
            }}>
              <span style={{ fontSize:13 }}>{t.icon}</span>
              <span style={{ textTransform:"uppercase" }}>{t.label}</span>
            </div>
          ))}
        </div>
        {/* Notification Bell */}
        <div style={{ position:"relative" }}>
          <div onClick={()=>setShowNotifications(!showNotifications)} style={{
            cursor:"pointer", fontSize:16, padding:"6px 10px", borderRadius:6, transition:"all .2s",
            background:showNotifications?GOLD+"22":"transparent", position:"relative"
          }}>
            {"\uD83D\uDD14"}
            {notifications.length>0 && (
              <span style={{ position:"absolute", top:2, right:4, background:RED, color:"#fff", fontSize:7, fontWeight:700,
                width:14, height:14, borderRadius:7, display:"flex", alignItems:"center", justifyContent:"center" }}>
                {notifications.length > 9 ? "9+" : notifications.length}
              </span>
            )}
          </div>
          {showNotifications && (
            <div style={{ position:"absolute", right:0, top:"100%", marginTop:4, width:320, maxHeight:360, overflowY:"auto",
              background:CARD, border:`1px solid ${BORDER}`, borderRadius:8, padding:8, zIndex:100,
              boxShadow:"0 8px 32px rgba(0,0,0,.6)" }}>
              <div style={{ fontSize:9, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:8, padding:"4px 4px 6px", borderBottom:`1px solid ${BORDER}` }}>
                Notifications ({notifications.length})
              </div>
              {notifications.length===0 && <div style={{ fontSize:9, color:DIM, padding:12, textAlign:"center" }}>All caught up!</div>}
              {notifications.map((n,i)=>(
                <div key={i} onClick={()=>{const loan=loans.find(l=>l.id===n.loanId);if(loan){openLoanDetail(loan);setShowNotifications(false);}}}
                  style={{ display:"flex", gap:8, alignItems:"center", padding:"6px 4px", borderBottom:`1px solid ${BORDER}22`, cursor:"pointer",
                    borderRadius:4, transition:"background .15s" }}
                  onMouseEnter={e=>e.currentTarget.style.background=BORDER+"44"}
                  onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                  <span style={{ fontSize:12 }}>{n.icon}</span>
                  <span style={{ fontSize:9, color:n.color, flex:1 }}>{n.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── TAB CONTENT ─────────────────────────────────────────────────── */}
      <div style={{ padding:16 }}>
        {tab===0 && <LoanPricingView user={user} contacts={contacts} showToast={showToast} />}
        {tab===1 && <PipelineTab loans={loans} allLoans={loans} loading={loading} reload={loadLoans} openNewApp={openNewApp} openLoanDetail={openLoanDetail} showToast={showToast} activeBiz={activeBiz} activeBizConfig={activeBizConfig} activeStages={activeStages} activeServices={activeServices} />}
        {tab===2 && <ApplicationTab prefill={appForm} user={user} showToast={showToast} reload={loadLoans} setTab={setTab} selectedLoan={selectedLoan} setSelectedLoan={setSelectedLoan} />}
        {tab===3 && <DocumentCenterTab loans={loans} loanDocs={loanDocs} loadDocs={loadDocs} showToast={showToast} />}
        {tab===4 && <InsuranceTab loans={loans} showToast={showToast} />}
        {tab===5 && <CreditRepairTab loans={loans} contacts={contacts} showToast={showToast} />}
        {tab===6 && <RealtyTab loans={loans} contacts={contacts} showToast={showToast} />}
        {tab===7 && <AnalyticsTab loans={loans} />}
      </div>

      {/* ── QUICK ACTIONS FLOATING BAR ────────────────────────────────── */}
      <div style={{ position:"fixed", bottom:20, right:20, display:"flex", gap:8, zIndex:80 }}>
        <button onClick={()=>openNewApp(null)} style={{ ...btnS, borderRadius:24, padding:"10px 18px", fontSize:10, boxShadow:"0 4px 20px rgba(212,175,55,.35)", display:"flex", alignItems:"center", gap:6, transition:"transform .15s, box-shadow .15s" }}
          onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow="0 6px 28px rgba(212,175,55,.5)";}}
          onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="0 4px 20px rgba(212,175,55,.35)";}}>
          + New Deal
        </button>
        <button onClick={()=>setTab(0)} style={{ ...btnOutS, borderRadius:24, padding:"10px 14px", fontSize:10, boxShadow:"0 4px 16px rgba(0,0,0,.4)", background:"#111118", display:"flex", alignItems:"center", gap:6 }}
          onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
          onMouseLeave={e=>e.currentTarget.style.background="#111118"}>
          {"\u26A1"} Quick Quote
        </button>
        <button onClick={()=>exportLoansCSV(loans)} style={{ ...btnOutS, borderRadius:24, padding:"10px 14px", fontSize:10, boxShadow:"0 4px 16px rgba(0,0,0,.4)", background:"#111118", display:"flex", alignItems:"center", gap:6 }}
          onMouseEnter={e=>e.currentTarget.style.background=CARD_HOVER}
          onMouseLeave={e=>e.currentTarget.style.background="#111118"}>
          {"\uD83D\uDCE5"} Export CSV
        </button>
      </div>
    </div>
  );
}


// ─── MODAL OVERLAY ────────────────────────────────────────────────────────────
function Modal({ open, onClose, title, children, width=520 }) {
  if (!open) return null;
  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={onClose}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:8, width, maxWidth:"95vw", maxHeight:"85vh", overflow:"auto", padding:20 }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
          <div style={{ fontSize:11, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase" }}>{title}</div>
          <div onClick={onClose} style={{ cursor:"pointer", fontSize:14, color:DIM, lineHeight:1 }}>✕</div>
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
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,.7)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}
      onClick={onClose}>
      <div style={{ background:CARD, border:`1px solid ${BORDER}`, borderRadius:8, width:360, padding:20 }}
        onClick={e=>e.stopPropagation()}>
        <div style={{ fontSize:11, fontWeight:700, color:RED, marginBottom:8, letterSpacing:".06em" }}>{title||"Confirm"}</div>
        <div style={{ fontSize:10, color:TXT, marginBottom:16 }}>{message}</div>
        <div style={{ display:"flex", gap:8, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={btnOutS}>Cancel</button>
          <button onClick={onConfirm} style={{ ...btnS, background:RED }}>Confirm</button>
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
      <div style={{ display:"flex", gap:8, marginBottom:12, flexWrap:"wrap" }}>
        <span style={badgeS(loan.stage==="Funded"?GREEN:loan.stage==="Denied"?RED:BLUE)}>{loan.stage}</span>
        <span style={badgeS(GOLD)}>{fmtMoney(loan.loan_amount)}</span>
        {loan.fico && <span style={badgeS(loan.fico>=740?GREEN:loan.fico>=680?YELLOW:RED)}>FICO {loan.fico}</span>}
        {loan.ltv && <span style={badgeS(BLUE)}>LTV {fmtPct(loan.ltv)}</span>}
        <span style={badgeS(dayColor)}>{days}d in stage</span>
      </div>

      {/* Info grid */}
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:6, marginBottom:12 }}>
        {[
          ["Property", loan.property_address||"—"],
          ["Lender", loan.lender||"—"],
          ["Program", loan.loan_program||"—"],
          ["Purpose", loan.loan_purpose||"—"],
          ["Rate", loan.rate ? loan.rate+"%" : "—"],
          ["LO", loan.loan_officer||"—"],
          ["Phone", loan.phone||"—"],
          ["Email", loan.email||"—"],
          ["Monthly Income", fmtMoney(totalIncome)],
          ["Docs Complete", (loan.doc_completion_pct||0)+"%"],
          ["Created", loan.created_at ? new Date(loan.created_at).toLocaleDateString() : "—"],
          ["Purchase Price", fmtMoney(loan.purchase_price)],
        ].map(([k,v],i) => (
          <div key={i} style={{ fontSize:9 }}>
            <span style={{ color:DIM }}>{k}: </span>
            <span style={{ color:BRIGHT }}>{v}</span>
          </div>
        ))}
      </div>

      {/* Stage quick-change */}
      <div style={{ marginBottom:12 }}>
        <label style={labelS}>Move to Stage</label>
        <div style={{ display:"flex", gap:4, flexWrap:"wrap", marginTop:4 }}>
          {(loanBizStages || STAGES).map(s => (
            <button key={s} onClick={()=>onStageChange(loan.id,s)}
              style={{ ...btnSmS, fontSize:7, background:loan.stage===s?GOLD+"44":"transparent", border:`1px solid ${loan.stage===s?GOLD:BORDER}`, color:loan.stage===s?GOLD:DIM, padding:"3px 8px" }}>
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

      {/* Quick Stats Dashboard */}
      <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
        {[
          { label:"Total Active Deals", val:activeLoans.length, sub:fmtMoney(totalVolume)+" volume", color:bizColor, icon:"\uD83D\uDCCA" },
          { label:"This Month Revenue", val:fmtMoney(thisMonthRevenue), sub:fundedThisMonth.length+" deals funded", color:GREEN, icon:"\uD83D\uDCB0" },
          { label:"Avg Days to Close", val:avgDays+"d", sub:fundedLoans.length+" funded total", color:BLUE, icon:"\u23F1\uFE0F" },
          { label:"Conversion Rate", val:conversionRate+"%", sub:fundedLoans.length+"/"+appAndBeyond.length+" converted", color:conversionRate>=50?GREEN:conversionRate>=30?YELLOW:RED, icon:"\uD83C\uDFAF" },
        ].map((s,i)=>(
          <div key={i} style={{ ...cardS, flex:"1 1 200px", minWidth:170, borderLeft:`3px solid ${s.color}`, transition:"transform .2s, box-shadow .2s", cursor:"default" }}
            onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-2px)";e.currentTarget.style.boxShadow=`0 4px 16px ${s.color}22`;}}
            onMouseLeave={e=>{e.currentTarget.style.transform="translateY(0)";e.currentTarget.style.boxShadow="none";}}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>{s.label}</div>
                <div style={{ fontSize:22, fontWeight:700, color:s.color, marginTop:4 }}>{s.val}</div>
                <div style={{ fontSize:8, color:DIM, marginTop:2 }}>{s.sub}</div>
              </div>
              <span style={{ fontSize:18, opacity:.6 }}>{s.icon}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Search & Filter Bar */}
      <div style={{ ...cardS, marginBottom:12, padding:10 }}>
        <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
          <button onClick={()=>openNewApp(null)} style={{ ...btnS, display:"flex", alignItems:"center", gap:4 }}>+ New Deal</button>
          <div style={{ display:"flex", gap:0, borderRadius:4, overflow:"hidden", border:`1px solid ${BORDER}` }}>
            <button onClick={()=>setViewMode("kanban")} style={{ ...btnSmS, background:viewMode==="kanban"?bizColor+"33":"transparent", color:viewMode==="kanban"?bizColor:DIM, border:"none" }}>Kanban</button>
            <button onClick={()=>setViewMode("table")} style={{ ...btnSmS, background:viewMode==="table"?bizColor+"33":"transparent", color:viewMode==="table"?bizColor:DIM, border:"none" }}>Table</button>
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
          <button onClick={reload} style={{ ...btnOutS, padding:"4px 10px", fontSize:9 }}>{"\u21BB"} Refresh</button>
          {loading && <span style={{ fontSize:9, color:DIM }}>Loading...</span>}
          <span style={{ fontSize:8, color:DIM, marginLeft:"auto" }}>{filtered.length} deal{filtered.length!==1?"s":""}</span>
        </div>
      </div>

      {/* Kanban View */}
      {viewMode==="kanban" && (
        <div style={{ display:"flex", gap:8, overflowX:"auto", paddingBottom:12 }}>
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
                  minWidth:200, maxWidth:220, flex:"0 0 210px", background:isDragOver?bizColor+"11":CARD,
                  border:`1px solid ${isDragOver?bizColor:BORDER}`, borderRadius:6, padding:8,
                  transition:"border-color .2s, background .2s", boxShadow:isDragOver?`0 0 12px ${bizColor}22`:"none"
                }}
              >
                <div style={{ fontSize:9, fontWeight:700, color:stageColor, letterSpacing:".06em", textTransform:"uppercase", marginBottom:8, display:"flex", justifyContent:"space-between" }}>
                  <span>{stage}</span>
                  <span style={{ ...badgeS(bizColor), fontSize:8 }}>{byStage[stage]?.length||0}</span>
                </div>
                <div style={{ display:"flex", flexDirection:"column", gap:6, maxHeight:"60vh", overflowY:"auto" }}>
                  {(byStage[stage]||[]).map(loan => (
                    <LoanCard key={loan.id} loan={loan} allLoans={allLoans||loans} bizColor={bizColor}
                      onDragStart={()=>setDragLoan(loan)} onClick={()=>setQuickViewLoan(loan)} onDoubleClick={()=>openLoanDetail(loan)} />
                  ))}
                  {(byStage[stage]||[]).length===0 && <div style={{ fontSize:8, color:DIM, textAlign:"center", padding:16, border:`1px dashed ${BORDER}`, borderRadius:4 }}>Drop here</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table View */}
      {viewMode==="table" && (
        <div style={{ overflowX:"auto" }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:10, color:TXT }}>
            <thead>
              <tr style={{ borderBottom:`1px solid ${BORDER}` }}>
                {["Borrower","Amount","Program","Stage","Lender","LO","Days","Docs %","Actions"].map(h=>(
                  <th key={h} style={{ padding:"8px 6px", textAlign:"left", fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase", fontWeight:600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(l => {
                const days = daysBetween(l.stage_entered_at || l.created_at);
                const dayColor = days<3?GREEN:days<7?YELLOW:RED;
                return (
                  <tr key={l.id} style={{ borderBottom:`1px solid ${BORDER}11`, cursor:"pointer" }} onClick={()=>openLoanDetail(l)}>
                    <td style={{ padding:"6px" }}>{l.first_name} {l.last_name}</td>
                    <td style={{ padding:"6px", color:GOLD }}>{fmtMoney(l.loan_amount)}</td>
                    <td style={{ padding:"6px" }}>{l.loan_program||"—"}</td>
                    <td style={{ padding:"6px" }}><span style={badgeS(l.stage==="Funded"?GREEN:l.stage==="Denied"?RED:BLUE)}>{l.stage}</span></td>
                    <td style={{ padding:"6px" }}>{l.lender||"—"}</td>
                    <td style={{ padding:"6px" }}>{l.loan_officer||"—"}</td>
                    <td style={{ padding:"6px" }}><span style={{ color:dayColor, fontWeight:600 }}>{days}d</span></td>
                    <td style={{ padding:"6px" }}>
                      <div style={{ background:BORDER, borderRadius:3, height:6, width:60 }}>
                        <div style={{ background:GREEN, height:6, borderRadius:3, width:`${l.doc_completion_pct||0}%` }} />
                      </div>
                      <span style={{ fontSize:8, color:DIM }}>{l.doc_completion_pct||0}%</span>
                    </td>
                    <td style={{ padding:"6px", display:"flex", gap:4 }}>
                      <button onClick={e=>{e.stopPropagation();setQuickViewLoan(l);}} style={{ ...btnSmS, fontSize:8 }}>View</button>
                      <button onClick={e=>{e.stopPropagation();openLoanDetail(l);}} style={{ ...btnSmS, fontSize:8, background:"transparent", border:`1px solid ${BORDER}`, color:DIM }}>Edit</button>
                      <button onClick={e=>{e.stopPropagation();setDeleteConfirm(l);}} style={{ ...btnSmS, fontSize:8, background:RED+"22", color:RED, border:"none" }}>✕</button>
                    </td>
                  </tr>
                );
              })}
              {filtered.length===0 && (
                <tr><td colSpan={9} style={{ padding:24, textAlign:"center", color:DIM, fontSize:10 }}>No loans found. Click "+ New Loan" to create one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}


// ─── LOAN CARD (Kanban) ───────────────────────────────────────────────────────
function LoanCard({ loan, allLoans, bizColor, onDragStart, onClick, onDoubleClick }) {
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
        background:hovered ? CARD_HOVER : BG, border:`1px solid ${hovered ? bc : BORDER}`, borderRadius:6, padding:10,
        cursor:"grab", transition:"all .2s ease", borderLeft:`3px solid ${pColor}`,
        boxShadow:hovered ? `0 4px 16px rgba(0,0,0,.4)` : "none",
        transform:hovered ? "translateY(-1px)" : "none"
      }}
    >
      {/* Header: Name + Priority */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
        <div style={{ fontSize:10, fontWeight:600, color:BRIGHT, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", flex:1 }}>
          {loan.first_name||"\u2014"} {loan.last_name||""}
        </div>
        <span title={priority} style={{ fontSize:11, cursor:"default" }}>{pIcon}</span>
      </div>

      {/* Loan amount */}
      <div style={{ fontSize:12, color:bc, fontWeight:700, marginBottom:4 }}>
        {fmtMoney(loan.loan_amount)}
      </div>

      {/* Service type badge */}
      {loan.service_type && (
        <div style={{ marginBottom:4 }}>
          <span style={{ fontSize:7, padding:"2px 6px", borderRadius:3, background:serviceColor+"18", color:serviceColor, border:`1px solid ${serviceColor}33`, fontWeight:600, letterSpacing:".04em" }}>
            {loan.service_type}
          </span>
        </div>
      )}

      {loan.property_address && <div style={{ fontSize:8, color:DIM, marginBottom:3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{loan.property_address}</div>}
      {loan.lender && <div style={{ fontSize:8, color:DIM, marginBottom:4 }}>{loan.lender} {loan.loan_program ? `\u00B7 ${loan.loan_program}`:""}</div>}

      {/* Badges row */}
      <div style={{ display:"flex", gap:3, flexWrap:"wrap", marginBottom:4 }}>
        <span style={{ ...badgeS(dayColor), display:"flex", alignItems:"center", gap:2 }}>{days}d in stage</span>
        {loan.fico && <span style={badgeS(loan.fico>=740?GREEN:loan.fico>=680?YELLOW:RED)}>FICO {loan.fico}</span>}
        {loan.ltv && <span style={badgeS(BLUE)}>LTV {fmtPct(loan.ltv)}</span>}
      </div>

      {/* Doc completion bar */}
      <div style={{ background:BORDER, borderRadius:3, height:4, width:"100%", marginBottom:2 }}>
        <div style={{ background:GREEN, height:4, borderRadius:3, width:`${loan.doc_completion_pct||0}%`, transition:"width .3s" }} />
      </div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <span style={{ fontSize:7, color:DIM }}>Docs: {loan.doc_completion_pct||0}%</span>
        <span style={{ fontSize:7, color:DIM }}>{timeAgo(loan.updated_at||loan.created_at)}</span>
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
  const STEPS = ["Borrower Info","Employment & Income","Assets & Liabilities","Property & Loan","Declarations","Review & Submit"];

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
      {/* Progress bar */}
      <div style={{ display:"flex", gap:0, marginBottom:16 }}>
        {STEPS.map((s,i)=>(
          <div key={i} onClick={()=>setStep(i)} style={{
            flex:1, textAlign:"center", padding:"8px 4px", cursor:"pointer",
            background:i===step?GOLD+"22":i<step?GREEN+"11":"transparent",
            borderBottom:i===step?`2px solid ${GOLD}`:i<step?`2px solid ${GREEN}33`:`2px solid ${BORDER}`,
            transition:"all .2s"
          }}>
            <div style={{ fontSize:8, fontWeight:i===step?700:500, color:i===step?GOLD:i<step?GREEN:DIM, letterSpacing:".06em" }}>
              STEP {i+1}
            </div>
            <div style={{ fontSize:9, color:i===step?BRIGHT:DIM, marginTop:2 }}>{s}</div>
          </div>
        ))}
      </div>

      {/* Step Content */}
      <div style={cardS}>
        {step===0 && (
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>BORROWER INFORMATION</div>
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
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>EMPLOYMENT & INCOME</div>
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
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>PROPERTY & LOAN DETAILS</div>
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
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>DECLARATIONS</div>
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
            <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>REVIEW & SUBMIT</div>
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

            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button onClick={submitApp} disabled={saving} style={{ ...btnS, fontSize:11, padding:"8px 24px" }}>
                {saving?"Submitting...": isEdit ? "Update Loan" : "Submit Application"}
              </button>
              {isEdit && (
                <button onClick={saveDraft} disabled={saving} style={{ ...btnOutS, fontSize:11, padding:"8px 24px" }}>
                  {saving?"Saving...":"Save Changes"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:12 }}>
        <button onClick={()=>setStep(Math.max(0,step-1))} disabled={step===0} style={{ ...btnOutS, opacity:step===0?.4:1 }}>← Previous</button>
        <button onClick={saveDraft} disabled={saving} style={btnOutS}>{saving?"Saving...":"💾 Save Draft"}</button>
        <button onClick={()=>setStep(Math.min(STEPS.length-1,step+1))} disabled={step===STEPS.length-1} style={{ ...btnOutS, opacity:step===STEPS.length-1?.4:1 }}>Next →</button>
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
      <div style={{ fontSize:11, fontWeight:700, color:GOLD, marginBottom:10, letterSpacing:".06em" }}>ASSETS & LIABILITIES</div>

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
        <div style={{ ...cardS, textAlign:"center", padding:40 }}>
          <div style={{ fontSize:24, marginBottom:8 }}>📁</div>
          <div style={{ fontSize:11, color:DIM }}>Select a loan above to view and manage documents.</div>
        </div>
      )}

      {selLoanId && (
        <>
          {/* Stats */}
          <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
            <div style={{ ...cardS, flex:"1 1 180px" }}>
              <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Documents Collected</div>
              <div style={{ fontSize:16, fontWeight:700, color:GOLD, marginTop:4 }}>{receivedDocs} / {totalDocs}</div>
              <div style={{ background:BORDER, borderRadius:3, height:6, marginTop:6 }}>
                <div style={{ background:GREEN, height:6, borderRadius:3, width:`${pct}%`, transition:"width .3s" }} />
              </div>
            </div>
            <div style={{ ...cardS, flex:"1 1 120px" }}>
              <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Missing</div>
              <div style={{ fontSize:16, fontWeight:700, color:RED, marginTop:4 }}>{missingDocs}</div>
            </div>
            <div style={{ ...cardS, flex:"1 1 120px" }}>
              <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Completion</div>
              <div style={{ fontSize:16, fontWeight:700, color:pct>=80?GREEN:pct>=50?YELLOW:RED, marginTop:4 }}>{pct}%</div>
            </div>
            <div style={{ ...cardS, flex:"1 1 180px" }}>
              <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>Last Upload</div>
              <div style={{ fontSize:11, fontWeight:600, color:BRIGHT, marginTop:4 }}>
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
  const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:6, padding:14 };

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
          <div key={s.label} style={{ ...cardS, flex:1, minWidth:140, textAlign:"center" }}>
            <div style={{ fontSize:7, color:DIM, textTransform:"uppercase", letterSpacing:".06em" }}>{s.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:s.color, marginTop:4 }}>{s.val}</div>
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
        <div style={{ maxHeight:300, overflowY:"auto" }}>
          {loading && <div style={{ fontSize:9, color:DIM, textAlign:"center", padding:20 }}>Loading...</div>}
          {!loading && policies.map(p => (
            <div key={p.id} style={{ display:"flex", justifyContent:"space-between", padding:"5px 0", borderBottom:`1px solid ${BORDER}`, fontSize:9 }}>
              <span style={{ color:BRIGHT }}>{p.client_name}</span>
              <span style={{ color:DIM }}>{p.carrier}</span>
              <span style={{ color:DIM }}>{p.line_of_business}</span>
              <span style={{ color:GOLD }}>{fmtMoney(p.premium)}</span>
              <span style={{ color: p.status==="active"?GREEN:DIM }}>{p.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// TAB 6: CREDIT REPAIR (Dispute Inc Integration)
// ═══════════════════════════════════════════════════════════════════════════════
function CreditRepairTab({ loans, contacts, showToast }) {
  const [clients, setClients] = useState([]);
  const [rounds, setRounds] = useState([]);
  const [subTab, setSubTab] = useState(0);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name:"",email:"",phone:"",ssn_last4:"",score_tu:0,score_exp:0,score_eqf:0,goal_score:700,monthly_fee:99,notes:"" });
  const [selectedClient, setSelectedClient] = useState(null);
  const [disputeForm, setDisputeForm] = useState({ creditor:"",account_num:"",bureau:"TransUnion",reason:"Not Mine",explanation:"" });
  const [generatedLetter, setGeneratedLetter] = useState("");
  const cardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:6, padding:14 };
  const inputS = { background:BG, border:`1px solid ${BORDER}`, color:TXT, padding:"6px 10px", fontSize:10, borderRadius:4, width:"100%", fontFamily:"inherit", boxSizing:"border-box" };
  const lowFicoLoans = loans.filter(l => l.fico && l.fico < 680);

  useEffect(() => {
    sbFetch("vault_credit_repair_clients","?order=created_at.desc").then(d => setClients(d||[]));
  }, []);

  useEffect(() => {
    if (selectedClient) sbFetch("vault_credit_repair_rounds",`?client_id=eq.${selectedClient.id}&order=round_number.asc`).then(d => setRounds(d||[]));
  }, [selectedClient]);

  const addClient = async () => {
    if (!form.name) return;
    const r = await sbInsert("vault_credit_repair_clients", form);
    if (r) { setClients([r,...clients]); setShowNew(false); setForm({ name:"",email:"",phone:"",ssn_last4:"",score_tu:0,score_exp:0,score_eqf:0,goal_score:700,monthly_fee:99,notes:"" }); if(showToast) showToast("Client enrolled"); }
  };

  const enrollFromLoan = (loan) => {
    setForm({ name:`${loan.first_name||""} ${loan.last_name||""}`.trim(), email:loan.email||"", phone:loan.phone||"", ssn_last4:"", score_tu:loan.fico||0, score_exp:loan.fico||0, score_eqf:loan.fico||0, goal_score:700, monthly_fee:99, notes:`From loan ${fmtMoney(loan.loan_amount)}` });
    setShowNew(true);
  };

  const addRound = async () => {
    if (!selectedClient) return;
    const num = rounds.length + 1;
    const r = await sbInsert("vault_credit_repair_rounds", { client_id:selectedClient.id, round_number:num, status:"pending" });
    if (r) setRounds([...rounds, r]);
  };

  const BUREAU_ADDRS = {
    TransUnion: "TransUnion LLC\nConsumer Dispute Center\nP.O. Box 2000\nChester, PA 19016",
    Experian: "Experian\nP.O. Box 4500\nAllen, TX 75013",
    Equifax: "Equifax Information Services LLC\nP.O. Box 740256\nAtlanta, GA 30374"
  };

  const generateLetter = () => {
    const d = disputeForm;
    const c = selectedClient;
    if (!c || !d.creditor) return;
    const today = new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"});
    const letter = `${today}\n\n${BUREAU_ADDRS[d.bureau]||d.bureau}\n\nRe: Dispute of Inaccurate Information — FCRA Section 609/611\n\nTo Whom It May Concern:\n\nI am writing to formally dispute the following item on my credit report, as it is ${d.reason.toLowerCase()}.\n\nCreditor/Company: ${d.creditor}\nAccount Number: ${d.account_num||"[See attached]"}\nReason for Dispute: ${d.reason}\n${d.explanation ? "Details: "+d.explanation+"\n" : ""}\nPursuant to the Fair Credit Reporting Act, Section 609(a)(1)(A) and Section 611, I am requesting that you verify and validate this account. If you cannot provide proper documentation and verification within 30 days, this item must be removed from my credit report immediately.\n\nPlease send me an updated copy of my credit report reflecting the corrections once the investigation is complete.\n\nSincerely,\n\n${c.name}\nSSN: XXX-XX-${c.ssn_last4||"XXXX"}\n${c.email||""}\n${c.phone||""}`;
    setGeneratedLetter(letter);
  };

  const statusColors = { active:GREEN, enrolled:"#6366f1", graduated:GOLD, cancelled:RED, pending:DIM };
  const SUBTABS = ["Dashboard","Dispute Letters","Rounds","Score Tracker"];

  return (
    <div>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:BRIGHT }}>⚡ Credit Repair Center</div>
          <div style={{ fontSize:9, color:DIM }}>Dispute letters, round tracking, score improvement</div>
        </div>
        <button onClick={()=>setShowNew(!showNew)} style={{ background:GOLD, border:"none", color:"#000", fontSize:9, fontWeight:700, padding:"6px 14px", borderRadius:4, cursor:"pointer", fontFamily:"inherit" }}>+ Enroll Client</button>
      </div>

      <div style={{ display:"flex", gap:0, borderBottom:`1px solid ${BORDER}`, marginBottom:12 }}>
        {SUBTABS.map((t,i)=>(<div key={t} onClick={()=>setSubTab(i)} style={{ padding:"6px 14px", cursor:"pointer", fontSize:9, fontWeight:subTab===i?700:400, color:subTab===i?GOLD:DIM, borderBottom:subTab===i?`2px solid ${GOLD}`:"2px solid transparent" }}>{t}</div>))}
      </div>

      {/* ─── DASHBOARD ─── */}
      {subTab===0 && (<>
        <div style={{ display:"flex", gap:10, marginBottom:14, flexWrap:"wrap" }}>
          {[{l:"Enrolled",v:clients.length,c:"#6366f1"},{l:"Active",v:clients.filter(c=>c.status==="active").length,c:GREEN},{l:"Low FICO Loans",v:lowFicoLoans.length,c:YELLOW},{l:"Graduated",v:clients.filter(c=>c.status==="graduated").length,c:GOLD}].map(s=>(
            <div key={s.l} style={{...cardS,flex:1,minWidth:130,textAlign:"center"}}><div style={{fontSize:7,color:DIM,textTransform:"uppercase",letterSpacing:".06em"}}>{s.l}</div><div style={{fontSize:18,fontWeight:700,color:s.c,marginTop:4}}>{s.v}</div></div>
          ))}
        </div>

        {showNew && (<div style={{...cardS,marginBottom:12,borderColor:GOLD+"44"}}>
          <div style={{fontSize:10,fontWeight:700,color:GOLD,marginBottom:8}}>Enroll New Client</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["Name","name"],["Email","email"],["Phone","phone"],["SSN Last 4","ssn_last4"]].map(([l,k])=>(<div key={k}><div style={{fontSize:8,color:DIM,marginBottom:2}}>{l}</div><input style={inputS} value={form[k]} onChange={e=>setForm({...form,[k]:e.target.value})} /></div>))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:8,marginBottom:8}}>
            {[["TU Score","score_tu"],["EXP Score","score_exp"],["EQF Score","score_eqf"],["Goal","goal_score"],["Fee/mo","monthly_fee"]].map(([l,k])=>(<div key={k}><div style={{fontSize:8,color:DIM,marginBottom:2}}>{l}</div><input type="number" style={inputS} value={form[k]} onChange={e=>setForm({...form,[k]:Number(e.target.value)})} /></div>))}
          </div>
          <div style={{marginBottom:8}}><div style={{fontSize:8,color:DIM,marginBottom:2}}>Notes</div><input style={inputS} value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})} /></div>
          <div style={{display:"flex",gap:6}}><button onClick={addClient} style={{background:GOLD,border:"none",color:"#000",fontSize:9,fontWeight:700,padding:"5px 14px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Enroll</button><button onClick={()=>setShowNew(false)} style={{background:"none",border:`1px solid ${BORDER}`,color:DIM,fontSize:9,padding:"5px 14px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Cancel</button></div>
        </div>)}

        {lowFicoLoans.length>0 && (<div style={{...cardS,marginBottom:12}}><div style={{fontSize:10,fontWeight:700,color:YELLOW,marginBottom:6}}>🎯 Loan Borrowers Needing Credit Repair</div>
          {lowFicoLoans.slice(0,5).map(l=>(<div key={l.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0",borderBottom:`1px solid ${BORDER}`}}>
            <div><div style={{fontSize:9,color:BRIGHT,fontWeight:600}}>{l.first_name} {l.last_name}</div><div style={{fontSize:8,color:DIM}}>FICO: <span style={{color:l.fico<620?RED:YELLOW,fontWeight:700}}>{l.fico}</span></div></div>
            <button onClick={()=>enrollFromLoan(l)} style={{background:"rgba(139,92,246,.15)",border:"1px solid rgba(139,92,246,.3)",color:"#a78bfa",fontSize:8,fontWeight:600,padding:"3px 8px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>⚡ Enroll</button>
          </div>))}
        </div>)}

        <div style={cardS}><div style={{fontSize:10,fontWeight:700,color:GOLD,marginBottom:8}}>All Clients ({clients.length})</div>
          {clients.length===0&&<div style={{fontSize:9,color:DIM,textAlign:"center",padding:20}}>No clients enrolled yet.</div>}
          {clients.map(c=>(<div key={c.id} onClick={()=>setSelectedClient(c)} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 0",borderBottom:`1px solid ${BORDER}`,cursor:"pointer"}}>
            <div><div style={{fontSize:10,color:BRIGHT,fontWeight:600}}>{c.name}</div><div style={{fontSize:8,color:DIM}}>{c.email} · TU:{c.score_tu} EXP:{c.score_exp} EQF:{c.score_eqf}</div></div>
            <div style={{display:"flex",gap:8,alignItems:"center"}}>
              <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:`${statusColors[c.status]||DIM}18`,color:statusColors[c.status]||DIM,border:`1px solid ${statusColors[c.status]||DIM}33`}}>{c.status}</span>
              <span style={{fontSize:8,color:GOLD}}>→</span>
            </div>
          </div>))}
        </div>
      </>)}

      {/* ─── DISPUTE LETTERS ─── */}
      {subTab===1 && (<>
        <div style={{...cardS,marginBottom:12}}>
          <div style={{fontSize:10,fontWeight:700,color:GOLD,marginBottom:8}}>Generate Dispute Letter (FCRA 609/611)</div>
          {!selectedClient ? <div style={{fontSize:9,color:DIM}}>Select a client from the Dashboard tab first.</div> : (<>
            <div style={{fontSize:9,color:BRIGHT,marginBottom:8}}>Client: <strong>{selectedClient.name}</strong></div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
              <div><div style={{fontSize:8,color:DIM,marginBottom:2}}>Creditor Name</div><input style={inputS} value={disputeForm.creditor} onChange={e=>setDisputeForm({...disputeForm,creditor:e.target.value})} /></div>
              <div><div style={{fontSize:8,color:DIM,marginBottom:2}}>Account #</div><input style={inputS} value={disputeForm.account_num} onChange={e=>setDisputeForm({...disputeForm,account_num:e.target.value})} /></div>
              <div><div style={{fontSize:8,color:DIM,marginBottom:2}}>Bureau</div><select style={inputS} value={disputeForm.bureau} onChange={e=>setDisputeForm({...disputeForm,bureau:e.target.value})}><option>TransUnion</option><option>Experian</option><option>Equifax</option></select></div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:8,marginBottom:8}}>
              <div><div style={{fontSize:8,color:DIM,marginBottom:2}}>Reason</div><select style={inputS} value={disputeForm.reason} onChange={e=>setDisputeForm({...disputeForm,reason:e.target.value})}><option>Not Mine</option><option>Inaccurate</option><option>Outdated</option><option>Duplicate</option><option>Paid/Settled</option><option>Identity Theft</option></select></div>
              <div><div style={{fontSize:8,color:DIM,marginBottom:2}}>Additional Explanation</div><input style={inputS} value={disputeForm.explanation} onChange={e=>setDisputeForm({...disputeForm,explanation:e.target.value})} /></div>
            </div>
            <button onClick={generateLetter} style={{background:GOLD,border:"none",color:"#000",fontSize:9,fontWeight:700,padding:"6px 16px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Generate Letter</button>
          </>)}
        </div>
        {generatedLetter && (<div style={{...cardS}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:10,fontWeight:700,color:GREEN}}>Generated Letter</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>{navigator.clipboard.writeText(generatedLetter);if(showToast)showToast("Copied to clipboard")}} style={{background:"none",border:`1px solid ${BORDER}`,color:TXT,fontSize:8,padding:"3px 10px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Copy</button>
              <button onClick={()=>{const b=new Blob([generatedLetter],{type:"text/plain"});const u=URL.createObjectURL(b);const a=document.createElement("a");a.href=u;a.download=`dispute_${disputeForm.bureau}_${Date.now()}.txt`;a.click()}} style={{background:"none",border:`1px solid ${BORDER}`,color:TXT,fontSize:8,padding:"3px 10px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>Download</button>
            </div>
          </div>
          <textarea value={generatedLetter} onChange={e=>setGeneratedLetter(e.target.value)} style={{...inputS,height:300,whiteSpace:"pre-wrap",lineHeight:1.6,fontSize:10}} />
        </div>)}
      </>)}

      {/* ─── ROUNDS ─── */}
      {subTab===2 && (<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div style={{fontSize:10,color:selectedClient?BRIGHT:DIM}}>{selectedClient?`Rounds for ${selectedClient.name}`:"Select a client from Dashboard"}</div>
          {selectedClient && <button onClick={addRound} style={{background:GOLD,border:"none",color:"#000",fontSize:9,fontWeight:700,padding:"5px 12px",borderRadius:3,cursor:"pointer",fontFamily:"inherit"}}>+ New Round</button>}
        </div>
        {rounds.map(r=>(<div key={r.id} style={{...cardS,marginBottom:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <div style={{fontSize:11,fontWeight:700,color:GOLD}}>Round {r.round_number}</div>
            <span style={{fontSize:7,padding:"2px 6px",borderRadius:3,background:`${r.status==="completed"?GREEN:r.status==="pending"?DIM:YELLOW}18`,color:r.status==="completed"?GREEN:r.status==="pending"?DIM:YELLOW}}>{r.status}</span>
          </div>
          <div style={{display:"flex",gap:16,fontSize:8,color:DIM}}>
            <span>Items disputed: {Array.isArray(r.items_disputed)?r.items_disputed.length:0}</span>
            <span>Items removed: {r.items_removed||0}</span>
            <span>Sent: {r.letters_sent_at?new Date(r.letters_sent_at).toLocaleDateString():"Not sent"}</span>
          </div>
          {(r.score_tu_after||r.score_exp_after||r.score_eqf_after)&&<div style={{display:"flex",gap:12,marginTop:4,fontSize:8}}>
            <span style={{color:TXT}}>After — TU:<span style={{color:GREEN,fontWeight:700}}>{r.score_tu_after}</span></span>
            <span style={{color:TXT}}>EXP:<span style={{color:GREEN,fontWeight:700}}>{r.score_exp_after}</span></span>
            <span style={{color:TXT}}>EQF:<span style={{color:GREEN,fontWeight:700}}>{r.score_eqf_after}</span></span>
          </div>}
        </div>))}
        {rounds.length===0&&<div style={{...cardS,textAlign:"center",color:DIM,fontSize:9}}>No rounds yet. {selectedClient?"Click '+ New Round' to start.":"Select a client first."}</div>}
      </>)}

      {/* ─── SCORE TRACKER ─── */}
      {subTab===3 && (<>
        <div style={{fontSize:10,color:selectedClient?BRIGHT:DIM,marginBottom:12}}>{selectedClient?`Score History for ${selectedClient.name}`:"Select a client from Dashboard"}</div>
        {selectedClient && (<div style={cardS}>
          <div style={{display:"flex",gap:16,marginBottom:16}}>
            {[["TransUnion",selectedClient.score_tu,"#0088cc"],["Experian",selectedClient.score_exp,"#3b82f6"],["Equifax",selectedClient.score_eqf,GREEN]].map(([b,s,c])=>(<div key={b} style={{flex:1,textAlign:"center"}}>
              <div style={{fontSize:8,color:DIM}}>{b}</div>
              <div style={{fontSize:22,fontWeight:700,color:c}}>{s||"—"}</div>
              <div style={{fontSize:8,color:DIM}}>Start</div>
            </div>))}
            <div style={{flex:1,textAlign:"center",borderLeft:`1px solid ${BORDER}`,paddingLeft:16}}>
              <div style={{fontSize:8,color:DIM}}>Goal</div>
              <div style={{fontSize:22,fontWeight:700,color:GOLD}}>{selectedClient.goal_score}</div>
              <div style={{fontSize:8,color:DIM}}>Target</div>
            </div>
          </div>
          {rounds.filter(r=>r.score_tu_after).length>0 && (<>
            <div style={{fontSize:9,fontWeight:700,color:GOLD,marginBottom:8}}>Progress by Round</div>
            <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120}}>
              {[{label:"Start",tu:selectedClient.score_tu,exp:selectedClient.score_exp,eqf:selectedClient.score_eqf},...rounds.filter(r=>r.score_tu_after).map(r=>({label:`R${r.round_number}`,tu:r.score_tu_after,exp:r.score_exp_after,eqf:r.score_eqf_after}))].map((pt,i)=>{
                const mid = Math.round(([pt.tu,pt.exp,pt.eqf].sort((a,b)=>a-b))[1]||0);
                const pct = Math.max(10,Math.min(100,((mid-500)/(850-500))*100));
                return (<div key={i} style={{flex:1,textAlign:"center"}}>
                  <div style={{fontSize:8,color:BRIGHT,fontWeight:700,marginBottom:2}}>{mid}</div>
                  <div style={{height:`${pct}%`,background:mid>=selectedClient.goal_score?GREEN:GOLD,borderRadius:"3px 3px 0 0",minHeight:8,transition:"height .3s"}} />
                  <div style={{fontSize:7,color:DIM,marginTop:2}}>{pt.label}</div>
                </div>);
              })}
            </div>
          </>)}
        </div>)}
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
  const rCardS = { background:CARD, border:`1px solid ${BORDER}`, borderRadius:6, padding:14 };
  const rInputS = { background:INPUT_BG, border:`1px solid ${INPUT_BD}`, color:TXT, padding:"6px 10px", fontSize:10, borderRadius:4, width:"100%", fontFamily:"inherit", boxSizing:"border-box", letterSpacing:".05em", outline:"none" };
  const rSelectS = { ...rInputS, appearance:"none", cursor:"pointer" };
  const rBtnS = { background:GOLD, color:"#000", border:"none", borderRadius:4, padding:"6px 14px", fontSize:10, fontWeight:600, cursor:"pointer", letterSpacing:".05em", fontFamily:"inherit" };
  const rBtnOutS = { ...rBtnS, background:"transparent", border:`1px solid ${GOLD}`, color:GOLD };
  const statusColors = { Active:GREEN, Pending:YELLOW, "Under Contract":GOLD, Sold:PURPLE, Withdrawn:DIM, Expired:RED };

  const persistFavorites = (f) => { setFavorites(f); localStorage.setItem("re4lty_favorites", JSON.stringify(f)); };
  const persistSavedSearches = (s) => { setSavedSearches(s); localStorage.setItem("re4lty_saved_searches", JSON.stringify(s)); };

  const toggleFavorite = (listing) => {
    const exists = favorites.find(f=>f.id===listing.id);
    if (exists) { persistFavorites(favorites.filter(f=>f.id!==listing.id)); if(showToast) showToast("Removed from favorites"); }
    else { persistFavorites([...favorites, listing]); if(showToast) showToast("Added to favorites"); }
  };
  const isFav = (id) => favorites.some(f=>f.id===id);

  const runSearch = () => {
    const f = searchFilters;
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
    { icon:"\uD83D\uDD0D", label:"Property Search" },
    { icon:"\uD83D\uDCBE", label:"Saved Searches" },
    { icon:"\u2B50", label:"Favorites" },
    { icon:"\uD83D\uDCCA", label:"Comp Analysis" },
    { icon:"\uD83D\uDD17", label:"MLS Connections" },
  ];

  return (
    <div>
      {/* Header */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:16 }}>
        <div>
          <div style={{ fontSize:14, fontWeight:700, color:BRIGHT }}>{"\uD83C\uDFE0"} Re4lty Inc — Real Estate Platform</div>
          <div style={{ fontSize:9, color:DIM }}>Property search, comps analysis, MLS integration, favorites & saved searches</div>
        </div>
      </div>

      {/* Sub-tab navigation */}
      <div style={{ display:"flex", gap:0, marginBottom:16, borderBottom:`1px solid ${BORDER}` }}>
        {SUB_TABS.map((st,i)=>(
          <div key={i} onClick={()=>setSubTab(i)} style={{
            padding:"8px 16px", cursor:"pointer", fontSize:9, fontWeight:subTab===i?700:500,
            color:subTab===i?PURPLE:DIM, borderBottom:subTab===i?`2px solid ${PURPLE}`:"2px solid transparent",
            letterSpacing:".05em", transition:"all .2s", display:"flex", alignItems:"center", gap:5, userSelect:"none"
          }}>
            <span style={{ fontSize:12 }}>{st.icon}</span>
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
              </div>
            ))}
          </div>
          {searchResults.length===0 && <div style={{ textAlign:"center", padding:40, color:DIM, fontSize:10 }}>No properties match your filters. Try broadening your search.</div>}
        </div>
      )}

      {/* ═══ SUB-TAB 1: Saved Searches ═══ */}
      {subTab===1 && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:PURPLE, marginBottom:12, textTransform:"uppercase", letterSpacing:".06em" }}>{"\uD83D\uDCBE"} Saved Searches ({savedSearches.length})</div>
          {savedSearches.length===0 && <div style={{ ...rCardS, textAlign:"center", color:DIM, fontSize:10, padding:30 }}>No saved searches yet. Use the Property Search tab to search and save criteria.</div>}
          <div style={{ display:"grid", gap:10 }}>
            {savedSearches.map(s=>(
              <div key={s.id} style={{ ...rCardS, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                <div>
                  <div style={{ fontSize:10, fontWeight:600, color:BRIGHT }}>{s.name}</div>
                  <div style={{ fontSize:8, color:DIM, marginTop:2 }}>
                    {[s.filters.city, s.filters.state, s.filters.zip, s.filters.minPrice?`$${Number(s.filters.minPrice).toLocaleString()}+`:"", s.filters.maxPrice?`Up to $${Number(s.filters.maxPrice).toLocaleString()}`:"", s.filters.beds?`${s.filters.beds}+ beds`:"", s.filters.type, s.filters.status].filter(Boolean).join(" · ") || "All properties"}
                  </div>
                  <div style={{ fontSize:7, color:DIM, marginTop:2 }}>Saved: {new Date(s.savedAt).toLocaleDateString()}</div>
                </div>
                <div style={{ display:"flex", gap:6 }}>
                  <button onClick={()=>loadSavedSearch(s)} style={{ ...rBtnS, padding:"4px 10px", fontSize:9 }}>{"\u25B6"} Run</button>
                  <button onClick={()=>{persistSavedSearches(savedSearches.filter(x=>x.id!==s.id)); if(showToast) showToast("Search deleted");}} style={{ ...rBtnOutS, padding:"4px 10px", fontSize:9, borderColor:RED, color:RED }}>{"\u2715"}</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SUB-TAB 2: Favorites / Watchlist ═══ */}
      {subTab===2 && (
        <div>
          <div style={{ fontSize:10, fontWeight:700, color:PURPLE, marginBottom:12, textTransform:"uppercase", letterSpacing:".06em" }}>{"\u2B50"} Favorites / Watchlist ({favorites.length})</div>
          {favorites.length===0 && <div style={{ ...rCardS, textAlign:"center", color:DIM, fontSize:10, padding:30 }}>No favorites yet. Star properties from the search results to track them here.</div>}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(260px, 1fr))", gap:12 }}>
            {favorites.map(p=>(
              <div key={p.id} style={{ ...rCardS, position:"relative" }}>
                <div style={{ background:BORDER, height:90, borderRadius:4, marginBottom:8, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:28, opacity:.3 }}>{"\uD83C\uDFE0"}</span>
                </div>
                <div onClick={()=>toggleFavorite(p)} style={{ position:"absolute", top:16, right:18, cursor:"pointer", fontSize:16, filter:"drop-shadow(0 0 4px #d4af37)" }}>{"\u2B50"}</div>
                <span style={{ position:"absolute", top:16, left:18, fontSize:7, padding:"2px 7px", borderRadius:3, background:`${statusColors[p.status]||DIM}22`, color:statusColors[p.status]||DIM, fontWeight:700, letterSpacing:".04em", textTransform:"uppercase" }}>{p.status}</span>
                <div style={{ fontSize:13, fontWeight:700, color:GOLD, marginBottom:2 }}>{fmtMoney(p.price)}</div>
                <div style={{ fontSize:10, color:BRIGHT, fontWeight:600 }}>{p.address}</div>
                <div style={{ fontSize:9, color:DIM, marginBottom:4 }}>{p.city}, {p.state} {p.zip}</div>
                <div style={{ display:"flex", gap:10, fontSize:9, color:TXT }}>
                  <span>{p.beds} bd</span><span style={{ color:BORDER }}>|</span>
                  <span>{p.baths} ba</span><span style={{ color:BORDER }}>|</span>
                  <span>{Number(p.sqft).toLocaleString()} sqft</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ SUB-TAB 3: Comp Analysis ═══ */}
      {subTab===3 && (
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
                    <div style={{ fontSize:7, color:DIM, textTransform:"uppercase", letterSpacing:".06em" }}>{s.label}</div>
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

      {/* ═══ SUB-TAB 4: MLS Connections ═══ */}
      {subTab===4 && (
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
// TAB 8: ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════════
function AnalyticsTab({ loans }) {
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
          <div key={i} style={{ ...cardS, flex:"1 1 150px", minWidth:130 }}>
            <div style={{ fontSize:8, color:DIM, letterSpacing:".08em", textTransform:"uppercase" }}>{s.label}</div>
            <div style={{ fontSize:18, fontWeight:700, color:s.color, marginTop:4 }}>{s.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
        {/* Loans by Stage */}
        <div style={cardS}>
          <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Loans by Stage</div>
          <BarChart_ data={byStage} labelKey="stage" valueKey="count" maxVal={maxStageCount} color={BLUE} />
        </div>

        {/* Monthly Volume */}
        <div style={cardS}>
          <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Monthly Volume</div>
          <BarChart_ data={monthlyVolume} labelKey="label" valueKey="volume" maxVal={maxVol} color={GREEN} formatVal={fmtMoney} />
        </div>

        {/* Top Lenders */}
        <div style={cardS}>
          <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Top Lenders</div>
          {topLenders.length===0 && <div style={{ fontSize:9, color:DIM }}>No lender data yet.</div>}
          <BarChart_ data={topLenders} labelKey="name" valueKey="volume" maxVal={maxLenderVol} color={GOLD} formatVal={fmtMoney} />
        </div>

        {/* Monthly Revenue */}
        <div style={cardS}>
          <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Monthly Revenue (Commissions)</div>
          <BarChart_ data={monthlyRevenue} labelKey="label" valueKey="rev" maxVal={maxRev} color={GOLD} formatVal={fmtMoney} />
        </div>
      </div>

      {/* Pipeline Funnel */}
      <div style={{ ...cardS, marginTop:12 }}>
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Pipeline Funnel</div>
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
        <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Recent Activity</div>
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
            <div style={{ fontSize:10, fontWeight:700, color:GOLD, letterSpacing:".06em", textTransform:"uppercase", marginBottom:10 }}>Loan Officer Performance</div>
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
