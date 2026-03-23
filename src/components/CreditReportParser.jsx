import { useState, useCallback } from "react";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────
const GOLD = "#d4af37";
const CARD_BG = "#111118";
const CARD_BORDER = "#1a1a24";
const INPUT_BG = "#08080f";
const TXT = "#ccc";
const TXT_DIM = "#777";
const TXT_BRIGHT = "#eee";
const GREEN = "#22c55e";
const RED = "#ef4444";
const BLUE = "#6366f1";
const YELLOW = "#f59e0b";

// ─── VANTAGESCORE → MORTGAGE FICO CONVERSION ────────────────────────────────
// MyScoreIQ uses VantageScore 3.0. Mortgage uses FICO 2 (Experian), 4 (TransUnion), 5 (Equifax)
// VantageScore tends to run 20-40 points higher than mortgage FICO
// This is an approximation — real FICO pull needed for accuracy
function vantageToMortgageFICO(vantage) {
  if (!vantage || vantage < 300) return null;
  // Tiered conversion (VantageScore → estimated mortgage FICO)
  if (vantage >= 780) return vantage - 15; // High scores: less delta
  if (vantage >= 740) return vantage - 20;
  if (vantage >= 700) return vantage - 25;
  if (vantage >= 660) return vantage - 30;
  if (vantage >= 620) return vantage - 35;
  if (vantage >= 580) return vantage - 40;
  return vantage - 45; // Low scores: bigger delta
}

// ─── HTML PARSER (MyScoreIQ Angular-rendered format) ────────────────────────
function parseMyScoreIQHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const result = { scores: {}, liabilities: [], inquiries: [], collections: [], summary: {}, personal: {} };
  const parseMoney = s => { const m = (s||"").replace(/[,$\s]/g,"").match(/[\d.]+/); return m ? parseFloat(m[0]) : 0; };

  // ── Extract Personal Info ──
  const allText = html;
  // Name: rendered in ng-scope as FIRST LAST
  const nameMatches = allText.match(/class="[^"]*ng-binding[^"]*"[^>]*>\s*([A-Z]+)&nbsp;\s*</g) || [];
  const lastNames = allText.match(/last_name[^>]*>([^<]+)</g) || [];
  const renderedFirsts = nameMatches.map(m => m.match(/>([A-Z]+)/)?.[1]).filter(Boolean);
  const renderedLasts = [...allText.matchAll(/class="[^"]*ng-binding[^"]*"[^>]*>\s*([A-Z]{2,})\s*</g)].map(m=>m[1]).filter(n=>n!=="FICO"&&n!=="REVOLVING"&&n!=="INSTALLMENT"&&n!=="PO");
  if (renderedFirsts[0]) result.personal.firstName = renderedFirsts[0];
  // Find last name - look for MENDEZ pattern
  const lastMatch = allText.match(/last_name[\s\S]{0,100}?class="[^"]*ng-binding[^"]*"[^>]*>\s*([A-Z]{2,})\s*</);
  if (lastMatch) result.personal.lastName = lastMatch[1];
  // Address
  const addrMatch = allText.match(/class="info[^"]*"[^>]*>\s*(\d+[A-Z0-9 ]+(?:ST|AVE|RD|DR|LN|BLVD|CT|PL|WAY|LNDG|CIR|TER|PKWY)[A-Z0-9 ]*)\s*</i);
  if (addrMatch) result.personal.address = addrMatch[1].trim();
  const cityStateZip = allText.match(/([A-Z]{2,}),\s*&nbsp;\s*([A-Z]{2})\s*[\s\S]{0,50}?(\d{5})/);
  if (cityStateZip) { result.personal.city = cityStateZip[1]; result.personal.state = cityStateZip[2]; result.personal.zip = cityStateZip[3]; }

  // ── Extract Scores (ng-binding 3-digit numbers 300-850) ──
  const scoreNums = [...allText.matchAll(/class="[^"]*ng-binding[^"]*"[^>]*>\s*(\d{3})\s*</g)]
    .map(m => parseInt(m[1])).filter(n => n >= 300 && n <= 850);
  // First 3 unique scores = TU, EXP, EQF (order in the HTML)
  const uniqueScores = [...new Set(scoreNums)].slice(0, 3);
  const bureauOrder = ["TransUnion", "Experian", "Equifax"];
  uniqueScores.forEach((vs, i) => {
    result.scores[bureauOrder[i]] = { vantage: vs, mortgageFICO: vantageToMortgageFICO(vs) };
  });

  // ── Extract Tradelines/Liabilities from ng-binding dollar values ──
  // MyScoreIQ renders dollar amounts in ng-binding spans as $XX,XXX.XX
  // Each tradeline has fields in 3-bureau triplets (TU, EXP, EQF)
  const dollarVals = [...allText.matchAll(/class="[^"]*ng-binding[^"]*"[^>]*>\s*\$([\d,.]+)\s*</g)].map(m => parseMoney(m[1]));

  // Extract creditor names from info class spans
  const creditorNames = [...allText.matchAll(/class="info[^"]*"[^>]*>\s*([A-Z][A-Z0-9 /&'.\-]{3,})\s*</g)]
    .map(m => m[1].trim()).filter(n => !/^PO BOX|DISPUTE|CREDIT BUREAU/.test(n) && n.length > 3);

  // Extract account statuses
  const statusVals = [...allText.matchAll(/class="[^"]*ng-binding[^"]*"[^>]*>\s*(Open|Closed|Paid|Collection|Delinquent)\s*</gi)].map(m => m[1]);

  // Extract account types
  const typeVals = [...allText.matchAll(/class="[^"]*ng-binding[^"]*"[^>]*>\s*(Revolving|Installment|Mortgage|Open|Collection|REVOLVING|INSTALLMENT)\s*</gi)].map(m => m[1]);

  // The detail tradeline section has structured data per account
  // Each tradeline shows: Monthly Payment(x3), Date Opened, Balance(x3), High Credit(x3), Credit Limit(x3)
  // That's 4 triplets = 12 dollar values per tradeline
  // But some fields may be missing. Use the creditor names as anchors.

  // Deduplicate creditors (same account appears in summary + detail)
  const seen = new Set();
  const uniqueCreditors = creditorNames.filter(c => { if (seen.has(c)) return false; seen.add(c); return true; });

  // Build tradelines from the structured data
  // The dollar values come in groups per tradeline
  // Each tradeline contributes: monthly_payment(3) + balance(3) + high_credit(3) + credit_limit(3) = 12 vals
  // But some have fewer. Let's use a simpler approach: assign dollar triplets to tradelines sequentially

  const triplets = [];
  for (let i = 0; i < dollarVals.length - 2; i += 3) {
    triplets.push({ tu: dollarVals[i], exp: dollarVals[i+1], eqf: dollarVals[i+2] });
  }

  // The first tradeline's data starts at triplet 0
  // Each tradeline has ~4 triplets: balance, high_credit, credit_limit, monthly_payment (order may vary)
  // Let's use 4 triplets per tradeline
  const FIELDS_PER_TRADELINE = 4;
  const numTradelines = Math.min(uniqueCreditors.length, Math.floor(triplets.length / FIELDS_PER_TRADELINE));

  for (let t = 0; t < numTradelines; t++) {
    const base = t * FIELDS_PER_TRADELINE;
    const creditor = uniqueCreditors[t] || `Account ${t+1}`;
    // Take the max of the 3 bureaus for each field (most accurate/recent)
    const maxOf = tri => Math.max(tri.tu || 0, tri.exp || 0, tri.eqf || 0);
    const balance = maxOf(triplets[base] || {});
    const highCredit = maxOf(triplets[base+1] || {});
    const creditLimit = maxOf(triplets[base+2] || {});
    const payment = maxOf(triplets[base+3] || {});
    // Get status and type from sequential lists (3 per tradeline for 3 bureaus)
    const statusIdx = t * 3;
    const typeIdx = t * 3;
    const status = statusVals[statusIdx] || "Open";
    const acctType = typeVals[typeIdx] || guessAccountType(creditor);

    result.liabilities.push({
      creditor,
      accountType: acctType.charAt(0).toUpperCase() + acctType.slice(1).toLowerCase(),
      balance,
      monthlyPayment: payment,
      highCredit,
      creditLimit,
      status: status.charAt(0).toUpperCase() + status.slice(1).toLowerCase(),
    });
  }

  // If structured parsing found nothing, try text-based fallback
  if (result.liabilities.length === 0) {
    const text = doc.body?.innerText || "";
    const accountBlocks = text.split(/\n{2,}/);
    accountBlocks.forEach(block => {
      const balMatch = block.match(/balance[:\s$]*\$?([\d,]+\.?\d*)/i);
      const pmtMatch = block.match(/(?:monthly\s*)?payment[:\s$]*\$?([\d,]+\.?\d*)/i);
      const nameMatch = block.match(/^([A-Z][A-Z\s&'.-]+)/m);
      if (balMatch && nameMatch) {
        const name = nameMatch[1].trim();
        if (name.length > 2 && name.length < 60) {
          result.liabilities.push({
            creditor: name, accountType: guessAccountType(name + " " + block),
            balance: parseFloat(balMatch[1].replace(/,/g, "")),
            monthlyPayment: pmtMatch ? parseFloat(pmtMatch[1].replace(/,/g, "")) : 0,
            status: /closed|paid|settled/i.test(block) ? "Closed" : "Open", creditLimit: 0,
          });
        }
      }
    });
  }

  // ── Extract Collections ──
  result.liabilities.filter(l => /collection/i.test(l.status) || /collection/i.test(l.accountType))
    .forEach(l => result.collections.push({ creditor: l.creditor, amount: l.balance }));

  // ── Summary Stats ──
  const allFICOs = Object.values(result.scores).map(s => s.mortgageFICO).filter(Boolean);
  if (allFICOs.length >= 2) {
    allFICOs.sort((a, b) => a - b);
    result.summary.midScore = allFICOs.length === 3 ? allFICOs[1] : Math.min(...allFICOs);
  } else if (allFICOs.length === 1) {
    result.summary.midScore = allFICOs[0];
  }

  const openLiabs = result.liabilities.filter(l => !/closed|paid/i.test(l.status));
  result.summary.totalMonthlyDebt = openLiabs.reduce((s, l) => s + l.monthlyPayment, 0);
  result.summary.totalBalance = openLiabs.reduce((s, l) => s + l.balance, 0);
  result.summary.totalAccounts = result.liabilities.length;
  result.summary.openAccounts = openLiabs.length;

  return result;
}

function guessAccountType(text) {
  const t = text.toLowerCase();
  if (/mortgage|home\s*loan|fannie|freddie|hud/i.test(t)) return "Mortgage";
  if (/auto|car|vehicle|motor/i.test(t)) return "Auto Loan";
  if (/student|edu|sallie|navient|nelnet|mohela/i.test(t)) return "Student Loan";
  if (/visa|mastercard|amex|discover|credit\s*card|revolving/i.test(t)) return "Credit Card";
  if (/heloc|home\s*equity/i.test(t)) return "HELOC";
  if (/personal|unsecured/i.test(t)) return "Personal Loan";
  if (/medical|hospital|doctor|health/i.test(t)) return "Medical";
  if (/collection/i.test(t)) return "Collection";
  return "Other";
}

// ─── COMPONENT ──────────────────────────────────────────────────────────────
export default function CreditReportParser({ onApplyToScenario, showToast }) {
  const [isDragging, setIsDragging] = useState(false);
  const [parsed, setParsed] = useState(null);
  const [editLiabs, setEditLiabs] = useState([]);
  const [showDetails, setShowDetails] = useState(false);
  const [rawFileName, setRawFileName] = useState("");

  const handleFile = useCallback((file) => {
    if (!file) return;
    setRawFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const html = e.target.result;
        const data = parseMyScoreIQHTML(html);
        setParsed(data);
        setEditLiabs(data.liabilities.map(l => ({ ...l, include: true })));
        if (showToast) showToast("Credit report parsed successfully");
      } catch (err) {
        console.error("Parse error:", err);
        if (showToast) showToast("Error parsing credit report");
      }
    };
    reader.readAsText(file);
  }, [showToast]);

  const onDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith(".html") || file.name.endsWith(".htm") || file.type === "text/html")) {
      handleFile(file);
    } else {
      if (showToast) showToast("Please drop an HTML credit report file");
    }
  }, [handleFile, showToast]);

  const onFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  };

  const applyToScenario = () => {
    if (!parsed || !onApplyToScenario) return;
    const includedLiabs = editLiabs.filter(l => l.include);
    const totalMonthly = includedLiabs.reduce((s, l) => s + l.monthlyPayment, 0);
    onApplyToScenario({
      fico: parsed.summary.midScore || 0,
      monthlyDebt: totalMonthly,
      liabilities: includedLiabs,
      scores: parsed.scores,
    });
    if (showToast) showToast("Applied to pricing scenario");
  };

  const toggleLiab = (idx) => {
    setEditLiabs(prev => prev.map((l, i) => i === idx ? { ...l, include: !l.include } : l));
  };

  const updateLiab = (idx, field, value) => {
    setEditLiabs(prev => prev.map((l, i) => i === idx ? { ...l, [field]: value } : l));
  };

  const fmt$ = (n) => "$" + Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const includedLiabs = editLiabs.filter(l => l.include);
  const totalMonthly = includedLiabs.reduce((s, l) => s + l.monthlyPayment, 0);
  const totalBalance = includedLiabs.reduce((s, l) => s + l.balance, 0);

  const typeColor = (t) => {
    const colors = { Mortgage: "#6366f1", "Auto Loan": "#3b82f6", "Student Loan": "#8b5cf6", "Credit Card": GOLD, HELOC: "#14b8a6", "Personal Loan": "#f97316", Medical: RED, Collection: RED };
    return colors[t] || TXT_DIM;
  };

  // ── Drop Zone (no parsed data yet) ──
  if (!parsed) {
    return (
      <div
        onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        style={{
          border: `2px dashed ${isDragging ? GOLD : CARD_BORDER}`,
          borderRadius: 8,
          padding: "30px 20px",
          textAlign: "center",
          background: isDragging ? "rgba(212,175,55,.05)" : CARD_BG,
          transition: "all .2s",
          cursor: "pointer",
        }}
        onClick={() => document.getElementById("credit-file-input")?.click()}
      >
        <input id="credit-file-input" type="file" accept=".html,.htm" style={{ display: "none" }} onChange={onFileSelect} />
        <div style={{ fontSize: 28, marginBottom: 8 }}>📊</div>
        <div style={{ fontSize: 11, color: TXT_BRIGHT, fontWeight: 600, marginBottom: 4 }}>
          Drop MyScore IQ Credit Report
        </div>
        <div style={{ fontSize: 9, color: TXT_DIM }}>
          Drop .html file here or click to browse
        </div>
        <div style={{ fontSize: 8, color: TXT_DIM, marginTop: 8 }}>
          Extracts scores, converts VantageScore → Mortgage FICO, pulls all liabilities
        </div>
      </div>
    );
  }

  // ── Parsed Results ──
  const scores = parsed.scores || {};
  const bureaus = ["Experian", "TransUnion", "Equifax"];

  return (
    <div style={{ background: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 8, overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 14px", borderBottom: `1px solid ${CARD_BORDER}`, background: "rgba(212,175,55,.04)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 14 }}>📊</span>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: TXT_BRIGHT }}>Credit Report Analysis</div>
            <div style={{ fontSize: 8, color: TXT_DIM }}>{rawFileName}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={() => { setParsed(null); setEditLiabs([]); }} style={{ background: "none", border: `1px solid ${CARD_BORDER}`, color: TXT_DIM, fontSize: 8, padding: "4px 10px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>
            ✕ Clear
          </button>
          <button onClick={applyToScenario} style={{ background: GOLD, border: "none", color: "#000", fontSize: 8, fontWeight: 700, padding: "4px 12px", borderRadius: 3, cursor: "pointer", fontFamily: "inherit" }}>
            ✓ Apply to Pricing
          </button>
        </div>
      </div>

      {/* Score Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, padding: "10px 14px" }}>
        {bureaus.map(b => {
          const s = scores[b];
          const fico = s?.mortgageFICO;
          const ficoColor = !fico ? TXT_DIM : fico >= 740 ? GREEN : fico >= 680 ? GOLD : fico >= 620 ? YELLOW : RED;
          return (
            <div key={b} style={{ background: INPUT_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: 6, padding: "10px 12px", textAlign: "center" }}>
              <div style={{ fontSize: 7, color: TXT_DIM, textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>{b}</div>
              {s ? (
                <>
                  <div style={{ fontSize: 8, color: TXT_DIM, marginBottom: 2 }}>VantageScore</div>
                  <div style={{ fontSize: 16, fontWeight: 800, color: TXT }}>{s.vantage}</div>
                  <div style={{ fontSize: 6, color: TXT_DIM, margin: "4px 0 2px" }}>Est. Mortgage FICO</div>
                  <div style={{ fontSize: 20, fontWeight: 900, color: ficoColor }}>{fico}</div>
                </>
              ) : (
                <div style={{ fontSize: 10, color: TXT_DIM, padding: "10px 0" }}>—</div>
              )}
            </div>
          );
        })}
      </div>

      {/* Mid Score / Qualifying Score */}
      {parsed.summary.midScore && (
        <div style={{ margin: "0 14px 8px", padding: "8px 12px", background: "rgba(212,175,55,.08)", border: `1px solid rgba(212,175,55,.2)`, borderRadius: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 8, color: GOLD, fontWeight: 600 }}>QUALIFYING MORTGAGE FICO (MID SCORE)</div>
            <div style={{ fontSize: 7, color: TXT_DIM }}>Used for pricing — middle of 3 bureau scores</div>
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, color: GOLD }}>{parsed.summary.midScore}</div>
        </div>
      )}

      {/* Liabilities Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, padding: "0 14px 8px" }}>
        {[
          { label: "MONTHLY DEBT", value: fmt$(totalMonthly), color: RED },
          { label: "TOTAL BALANCE", value: fmt$(totalBalance), color: TXT },
          { label: "ACCOUNTS", value: `${includedLiabs.length} / ${editLiabs.length}`, color: BLUE },
          { label: "COLLECTIONS", value: parsed.collections?.length || 0, color: parsed.collections?.length ? RED : GREEN },
        ].map(s => (
          <div key={s.label} style={{ background: INPUT_BG, borderRadius: 4, padding: "6px 8px", textAlign: "center" }}>
            <div style={{ fontSize: 6, color: TXT_DIM, textTransform: "uppercase", letterSpacing: ".06em" }}>{s.label}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Liabilities Table */}
      <div style={{ padding: "0 14px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: TXT_BRIGHT }}>Liabilities ({editLiabs.length})</div>
          <button onClick={() => setShowDetails(!showDetails)} style={{ background: "none", border: "none", color: GOLD, fontSize: 8, cursor: "pointer", fontFamily: "inherit" }}>
            {showDetails ? "▲ Collapse" : "▼ Expand All"}
          </button>
        </div>

        <div style={{ maxHeight: 300, overflowY: "auto", marginBottom: 10 }}>
          {editLiabs.map((l, i) => (
            <div key={i} style={{
              display: "flex", alignItems: "center", gap: 6, padding: "5px 8px", marginBottom: 2,
              background: l.include ? "rgba(34,197,94,.03)" : "rgba(239,68,68,.03)",
              border: `1px solid ${l.include ? "rgba(34,197,94,.15)" : "rgba(239,68,68,.15)"}`,
              borderRadius: 4, opacity: l.include ? 1 : 0.5,
            }}>
              {/* Include toggle */}
              <div onClick={() => toggleLiab(i)} style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${l.include ? GREEN : RED}`, background: l.include ? GREEN : "transparent", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, color: "#fff", flexShrink: 0 }}>
                {l.include && "✓"}
              </div>

              {/* Creditor */}
              <div style={{ flex: 2, minWidth: 0 }}>
                <div style={{ fontSize: 9, color: TXT_BRIGHT, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{l.creditor}</div>
                <div style={{ fontSize: 7, color: typeColor(l.accountType) }}>{l.accountType}</div>
              </div>

              {/* Balance */}
              <div style={{ flex: 1, textAlign: "right" }}>
                <div style={{ fontSize: 8, color: TXT_DIM }}>Balance</div>
                {showDetails ? (
                  <input value={l.balance} onChange={e => updateLiab(i, "balance", parseFloat(e.target.value) || 0)} style={{ width: 60, background: INPUT_BG, border: `1px solid ${CARD_BORDER}`, color: TXT, fontSize: 9, padding: "2px 4px", borderRadius: 2, textAlign: "right", fontFamily: "inherit" }} />
                ) : (
                  <div style={{ fontSize: 9, color: TXT, fontWeight: 600 }}>{fmt$(l.balance)}</div>
                )}
              </div>

              {/* Monthly Payment */}
              <div style={{ flex: 1, textAlign: "right" }}>
                <div style={{ fontSize: 8, color: TXT_DIM }}>Monthly</div>
                {showDetails ? (
                  <input value={l.monthlyPayment} onChange={e => updateLiab(i, "monthlyPayment", parseFloat(e.target.value) || 0)} style={{ width: 60, background: INPUT_BG, border: `1px solid ${CARD_BORDER}`, color: TXT, fontSize: 9, padding: "2px 4px", borderRadius: 2, textAlign: "right", fontFamily: "inherit" }} />
                ) : (
                  <div style={{ fontSize: 9, color: RED, fontWeight: 600 }}>{fmt$(l.monthlyPayment)}/mo</div>
                )}
              </div>

              {/* Status */}
              <div style={{ width: 50, textAlign: "center" }}>
                <span style={{ fontSize: 7, padding: "2px 5px", borderRadius: 3, background: /closed|paid/i.test(l.status) ? "rgba(119,119,119,.15)" : "rgba(34,197,94,.15)", color: /closed|paid/i.test(l.status) ? TXT_DIM : GREEN }}>
                  {l.status}
                </span>
              </div>
            </div>
          ))}

          {editLiabs.length === 0 && (
            <div style={{ padding: "20px 0", textAlign: "center", color: TXT_DIM, fontSize: 9 }}>
              No liabilities detected. You can add them manually below.
            </div>
          )}
        </div>
      </div>

      {/* Add Manual Liability */}
      <div style={{ padding: "0 14px 10px" }}>
        <button
          onClick={() => setEditLiabs(prev => [...prev, { creditor: "New Account", accountType: "Other", balance: 0, monthlyPayment: 0, status: "Open", creditLimit: 0, include: true }])}
          style={{ background: "none", border: `1px dashed ${CARD_BORDER}`, color: TXT_DIM, fontSize: 8, padding: "5px 0", width: "100%", borderRadius: 4, cursor: "pointer", fontFamily: "inherit" }}
        >
          + Add Liability Manually
        </button>
      </div>

      {/* DTI Preview */}
      <div style={{ padding: "8px 14px", borderTop: `1px solid ${CARD_BORDER}`, background: "rgba(99,102,241,.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 8, color: TXT_DIM }}>
          Total monthly obligations: <span style={{ color: RED, fontWeight: 700 }}>{fmt$(totalMonthly)}/mo</span>
          {" · "}
          {includedLiabs.length} active accounts
        </div>
        <div style={{ fontSize: 7, color: TXT_DIM }}>
          ⚠️ VantageScore→FICO conversion is estimated. Pull tri-merge for exact scores.
        </div>
      </div>
    </div>
  );
}
