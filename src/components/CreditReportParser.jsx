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

// ─── HTML PARSER ────────────────────────────────────────────────────────────
function parseMyScoreIQHTML(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  const text = doc.body?.innerText || doc.body?.textContent || "";
  const result = { scores: {}, liabilities: [], inquiries: [], collections: [], summary: {} };

  // ── Extract Scores ──
  // MyScoreIQ shows scores like "TransUnion: 720", "Equifax: 715", "Experian: 730"
  const scorePatterns = [
    { bureau: "TransUnion", patterns: [/TransUnion[:\s]*(\d{3})/i, /TU[:\s]*(\d{3})/i] },
    { bureau: "Equifax", patterns: [/Equifax[:\s]*(\d{3})/i, /EQ[:\s]*(\d{3})/i] },
    { bureau: "Experian", patterns: [/Experian[:\s]*(\d{3})/i, /EX[:\s]*(\d{3})/i] },
  ];

  for (const { bureau, patterns } of scorePatterns) {
    for (const pat of patterns) {
      const m = text.match(pat);
      if (m) {
        const vs = parseInt(m[1]);
        result.scores[bureau] = { vantage: vs, mortgageFICO: vantageToMortgageFICO(vs) };
        break;
      }
    }
  }

  // Also try to find scores from HTML elements (score circles, score displays)
  const scoreElements = doc.querySelectorAll('[class*="score"], [class*="Score"], [id*="score"]');
  scoreElements.forEach(el => {
    const t = (el.textContent || "").trim();
    const m = t.match(/(\d{3})/);
    if (m && parseInt(m[1]) >= 300 && parseInt(m[1]) <= 850) {
      // Try to determine which bureau
      const parent = el.parentElement?.textContent || "";
      if (/transunion/i.test(parent) && !result.scores.TransUnion) {
        const vs = parseInt(m[1]);
        result.scores.TransUnion = { vantage: vs, mortgageFICO: vantageToMortgageFICO(vs) };
      } else if (/equifax/i.test(parent) && !result.scores.Equifax) {
        const vs = parseInt(m[1]);
        result.scores.Equifax = { vantage: vs, mortgageFICO: vantageToMortgageFICO(vs) };
      } else if (/experian/i.test(parent) && !result.scores.Experian) {
        const vs = parseInt(m[1]);
        result.scores.Experian = { vantage: vs, mortgageFICO: vantageToMortgageFICO(vs) };
      }
    }
  });

  // Fallback: find any 3-digit numbers near bureau names
  if (Object.keys(result.scores).length === 0) {
    const allScores = [];
    const scoreRegex = /(?:score|rating)[:\s]*(\d{3})/gi;
    let sm;
    while ((sm = scoreRegex.exec(text)) !== null) {
      const v = parseInt(sm[1]);
      if (v >= 300 && v <= 850) allScores.push(v);
    }
    // Also look for standalone 3-digit numbers between 300-850 near "credit"
    const creditScoreRegex = /\b(\d{3})\b/g;
    const nearCredit = text.match(/(?:credit|score|vantage|fico)[\s\S]{0,50}?(\d{3})/gi) || [];
    nearCredit.forEach(match => {
      const n = match.match(/(\d{3})/);
      if (n) {
        const v = parseInt(n[1]);
        if (v >= 300 && v <= 850) allScores.push(v);
      }
    });
    if (allScores.length >= 3) {
      const sorted = [...new Set(allScores)].sort((a,b) => b-a);
      const bureaus = ["Experian", "TransUnion", "Equifax"];
      sorted.slice(0, 3).forEach((s, i) => {
        if (!result.scores[bureaus[i]]) {
          result.scores[bureaus[i]] = { vantage: s, mortgageFICO: vantageToMortgageFICO(s) };
        }
      });
    }
  }

  // ── Extract Liabilities ──
  // Look for tables with account data
  const tables = doc.querySelectorAll("table");
  tables.forEach(table => {
    const rows = table.querySelectorAll("tr");
    const headers = [];
    const firstRow = rows[0];
    if (firstRow) {
      firstRow.querySelectorAll("th, td").forEach(cell => {
        headers.push((cell.textContent || "").trim().toLowerCase());
      });
    }

    // Check if this looks like an accounts/tradelines table
    const isAccountTable = headers.some(h =>
      /creditor|account|lender|company|name/i.test(h)
    ) && headers.some(h =>
      /balance|amount|payment|monthly/i.test(h)
    );

    if (isAccountTable) {
      const nameIdx = headers.findIndex(h => /creditor|account|lender|company|name/i.test(h));
      const typeIdx = headers.findIndex(h => /type|kind|category/i.test(h));
      const balIdx = headers.findIndex(h => /balance|amount|owed/i.test(h));
      const pmtIdx = headers.findIndex(h => /payment|monthly|min/i.test(h));
      const statusIdx = headers.findIndex(h => /status|condition|standing/i.test(h));
      const limitIdx = headers.findIndex(h => /limit|credit.?limit|high/i.test(h));

      for (let i = 1; i < rows.length; i++) {
        const cells = rows[i].querySelectorAll("td");
        if (cells.length < 2) continue;
        const getCell = idx => idx >= 0 && idx < cells.length ? (cells[idx].textContent || "").trim() : "";
        const parseMoney = s => {
          const m = (s || "").replace(/[,$\s]/g, "").match(/[\d.]+/);
          return m ? parseFloat(m[0]) : 0;
        };

        const name = getCell(nameIdx);
        if (!name || name.length < 2) continue;

        result.liabilities.push({
          creditor: name,
          accountType: getCell(typeIdx) || guessAccountType(name),
          balance: parseMoney(getCell(balIdx)),
          monthlyPayment: parseMoney(getCell(pmtIdx)),
          status: getCell(statusIdx) || "Open",
          creditLimit: parseMoney(getCell(limitIdx)),
        });
      }
    }
  });

  // Fallback: parse liabilities from text patterns
  if (result.liabilities.length === 0) {
    // Look for patterns like "CHASE VISA  Balance: $5,432  Payment: $125"
    const accountBlocks = text.split(/\n{2,}|\r\n{2,}/);
    accountBlocks.forEach(block => {
      const balMatch = block.match(/balance[:\s$]*\$?([\d,]+\.?\d*)/i);
      const pmtMatch = block.match(/(?:monthly\s*)?payment[:\s$]*\$?([\d,]+\.?\d*)/i);
      const nameMatch = block.match(/^([A-Z][A-Z\s&'.-]+)/m);

      if (balMatch && nameMatch) {
        const name = nameMatch[1].trim();
        if (name.length > 2 && name.length < 60) {
          result.liabilities.push({
            creditor: name,
            accountType: guessAccountType(name + " " + block),
            balance: parseFloat(balMatch[1].replace(/,/g, "")),
            monthlyPayment: pmtMatch ? parseFloat(pmtMatch[1].replace(/,/g, "")) : 0,
            status: /closed|paid|settled/i.test(block) ? "Closed" : "Open",
            creditLimit: 0,
          });
        }
      }
    });
  }

  // ── Extract Collections ──
  const collectionsRegex = /collection[s]?[\s\S]{0,200}?\$?([\d,]+\.?\d*)/gi;
  let cm;
  while ((cm = collectionsRegex.exec(text)) !== null) {
    if (!result.collections.some(c => c.amount === parseFloat(cm[1].replace(/,/g, "")))) {
      result.collections.push({ amount: parseFloat(cm[1].replace(/,/g, "")) });
    }
  }

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
