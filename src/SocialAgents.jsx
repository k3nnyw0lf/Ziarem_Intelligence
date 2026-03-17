import { useState, useEffect, useCallback } from "react";

// ─── LOCAL HELPERS ───────────────────────────────────────────────────────────

const BRANDS_DEFAULT = [
  { id:"wolf-surety",       name:"Wolf Surety",       type:"Surety Bonds",    color:"#f59e0b" },
  { id:"re4lty",            name:"Re4lty",            type:"Real Estate",     color:"#6366f1" },
  { id:"closed-by-whom",    name:"Closed By Whom",    type:"Real Estate Tech",color:"#10b981" },
  { id:"dispute-llc",       name:"Dispute LLC",       type:"Credit Repair",   color:"#ef4444" },
  { id:"mansion-signature", name:"Mansion Signature",  type:"Luxury RE",       color:"#a855f7" },
  { id:"tax",               name:"Tax",               type:"Tax Services",    color:"#3b82f6" },
];

const STATUS_COLORS = {
  DRAFT:           { bg:"#33333850", border:"#555", text:"#999",    label:"Draft" },
  READY_TO_RENDER: { bg:"#3b82f618", border:"#3b82f640", text:"#3b82f6", label:"Ready to Render" },
  RENDERING:       { bg:"#f59e0b18", border:"#f59e0b40", text:"#f59e0b", label:"Rendering" },
  READY_TO_POST:   { bg:"#10b98118", border:"#10b98140", text:"#10b981", label:"Ready to Post" },
  SCHEDULED:       { bg:"#a855f718", border:"#a855f740", text:"#a855f7", label:"Scheduled" },
  POSTED:          { bg:"#05966918", border:"#05966940", text:"#059669", label:"Posted" },
  FAILED:          { bg:"#ef444418", border:"#ef444440", text:"#ef4444", label:"Failed" },
};

const PLATFORM_ICONS = {
  instagram: "IG", youtube: "YT", tiktok: "TT", facebook: "FB",
  twitter: "X", linkedin: "LI", threads: "TH",
};

const GUARDRAILS = {
  disallowLegalAdvice: true,
  disallowDefamation: true,
  requireDisclaimer: true,
  neverNameCompetitors: true,
};

// ─── MINI COMPONENTS ─────────────────────────────────────────────────────────

function Bd({ label, color="#555", bg }) {
  return <span style={{ display:"inline-block",padding:"1px 7px",borderRadius:2,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",background:bg||`${color}18`,color,border:`1px solid ${color}30`,whiteSpace:"nowrap" }}>{label}</span>;
}

function Btn({ onClick, children, variant="default", disabled, style={} }) {
  const V = {
    default:  { background:"#1a1a2e",border:"1px solid #2a2a40",color:"#aaa" },
    gold:     { background:"linear-gradient(135deg,#f59e0b,#d97706)",border:"none",color:"#000",fontWeight:700 },
    danger:   { background:"#ef444418",border:"1px solid #ef444440",color:"#ef4444" },
    success:  { background:"#10b98118",border:"1px solid #10b98140",color:"#10b981" },
    ghost:    { background:"transparent",border:"1px solid rgba(255,255,255,.08)",color:"#888" },
  };
  return <button onClick={onClick} disabled={disabled} style={{ fontFamily:"inherit",fontSize:10,letterSpacing:".08em",padding:"6px 14px",borderRadius:3,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,...(V[variant]||V.default),...style }}>{children}</button>;
}

function Inp({ value, onChange, placeholder, type="text", style={} }) {
  return <input type={type} value={value||""} onChange={e=>onChange(e.target.value)} placeholder={placeholder} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,boxSizing:"border-box",...style }} />;
}

function Sel({ value, onChange, options, children, style={} }) {
  return <select value={value||""} onChange={e=>onChange(e.target.value)} style={{ width:"100%",background:"#0f0f1a",border:"1px solid #1e1e2e",color:"#e8e4d9",fontFamily:"inherit",fontSize:12,padding:"8px 12px",borderRadius:3,boxSizing:"border-box",...style }}>
    {options ? options.map(o=><option key={o.value} value={o.value}>{o.label}</option>) : children}
  </select>;
}

function Fld({ label, children }) {
  return <div style={{ marginBottom:12 }}><div style={{ fontSize:9,color:"#555",letterSpacing:".1em",marginBottom:4 }}>{label}</div>{children}</div>;
}

function Modal({ onClose, title, width="500px", children }) {
  return (
    <div onClick={e=>e.target===e.currentTarget&&onClose()} style={{ position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:16 }}>
      <div style={{ width:`min(${width},96vw)`,maxHeight:"92vh",background:"#0b0b16",border:"1px solid #2a2a48",borderRadius:8,display:"flex",flexDirection:"column",overflow:"hidden",boxShadow:"0 0 100px rgba(0,0,0,0.7)" }}>
        <div style={{ display:"flex",alignItems:"center",padding:"12px 18px",borderBottom:"1px solid #181828",flexShrink:0 }}>
          <span style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:17,letterSpacing:".2em",color:"#d4af37" }}>{title}</span>
          <div style={{ flex:1 }} />
          <button onClick={onClose} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:18 }}>&#10005;</button>
        </div>
        <div style={{ overflowY:"auto",flex:1,padding:20 }}>{children}</div>
      </div>
    </div>
  );
}

function Toggle({ on, onToggle, label }) {
  return (
    <div onClick={onToggle} style={{ display:"inline-flex",alignItems:"center",gap:8,cursor:"pointer",userSelect:"none" }}>
      <div style={{ width:36,height:20,borderRadius:10,background:on?"#f59e0b":"#1e1e2e",border:`1px solid ${on?"#f59e0b":"#333"}`,position:"relative",transition:"all .2s" }}>
        <div style={{ width:16,height:16,borderRadius:"50%",background:on?"#000":"#555",position:"absolute",top:1,left:on?17:1,transition:"all .2s" }} />
      </div>
      {label && <span style={{ fontSize:10,color:on?"#f59e0b":"#666",letterSpacing:".06em" }}>{label}</span>}
    </div>
  );
}

function StatusBadge({ status }) {
  const s = STATUS_COLORS[status] || STATUS_COLORS.DRAFT;
  return (
    <span style={{ display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:3,fontSize:8,letterSpacing:".06em",textTransform:"uppercase",background:s.bg,color:s.text,border:`1px solid ${s.border}` }}>
      {status==="RENDERING" && <span style={{ display:"inline-block",width:8,height:8,border:"2px solid",borderColor:`${s.text} transparent ${s.text} transparent`,borderRadius:"50%",animation:"spin 1s linear infinite" }} />}
      {s.label}
    </span>
  );
}

function LangBadge({ lang }) {
  const c = lang==="es" ? "#ef4444" : "#3b82f6";
  return <span style={{ fontSize:8,padding:"1px 5px",borderRadius:2,background:`${c}18`,color:c,border:`1px solid ${c}30`,letterSpacing:".04em" }}>{lang==="es"?"ES":"EN"}</span>;
}

function PlatformBadge({ platform }) {
  const colors = { instagram:"#E1306C", youtube:"#FF0000", tiktok:"#00f2ea", facebook:"#1877F2", twitter:"#1DA1F2", linkedin:"#0077B5", threads:"#999" };
  const c = colors[platform] || "#666";
  return <span style={{ fontSize:8,padding:"1px 6px",borderRadius:2,background:`${c}18`,color:c,border:`1px solid ${c}30`,letterSpacing:".04em",textTransform:"uppercase" }}>{PLATFORM_ICONS[platform]||platform}</span>;
}

function Toast({ message, type="info" }) {
  const c = type==="error"?"#ef4444":type==="success"?"#10b981":"#f59e0b";
  const icon = type==="error"?"\u26a0":type==="success"?"\u2713":"\u26a1";
  return (
    <div style={{ position:"fixed",top:20,right:20,zIndex:999,background:"#0b0b16",border:`1px solid ${c}40`,borderRadius:6,padding:"10px 18px",color:c,fontSize:11,letterSpacing:".04em",boxShadow:`0 4px 20px ${c}20`,display:"flex",alignItems:"center",gap:8,animation:"fadeIn .3s" }}>
      <span style={{ fontSize:13 }}>{icon}</span>
      {message}
    </div>
  );
}

// Spinner for loading states
function Spin({ size=10, color="#f59e0b" }) {
  return <span style={{ display:"inline-block",width:size,height:size,border:`2px solid ${color}40`,borderTopColor:color,borderRadius:"50%",animation:"spin 1s linear infinite",flexShrink:0 }} />;
}

// ─── SPIN KEYFRAMES (injected once) ─────────────────────────────────────────
const STYLE_TAG_ID = "social-agents-styles";
function ensureStyles() {
  if (document.getElementById(STYLE_TAG_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_TAG_ID;
  s.textContent = `
    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
  `;
  document.head.appendChild(s);
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── MAIN COMPONENT ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

export default function SocialAgentsView({ sb, n8nPost, user, KEN_ID }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [tab, setTab] = useState("brands");
  const [brands, setBrands] = useState([]);
  const [configs, setConfigs] = useState({});
  const [posts, setPosts] = useState([]);
  const [apiKeys, setApiKeys] = useState({});
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [editBrand, setEditBrand] = useState(null);
  const [expandedPost, setExpandedPost] = useState(null);
  const [generating, setGenerating] = useState({});

  // Filters for content queue
  const [filterBrand, setFilterBrand] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPlatform, setFilterPlatform] = useState("all");

  // Settings state
  const [keysDirty, setKeysDirty] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [testResults, setTestResults] = useState({});

  useEffect(() => { ensureStyles(); }, []);

  // ── Toast helper ───────────────────────────────────────────────────────────
  const showToast = useCallback((message, type="info") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  // ── Data Loading ───────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [brandsRes, configsRes, postsRes, keysRes] = await Promise.all([
        sb("vault_social_brands", "GET", null, "?order=name"),
        sb("vault_social_agent_config", "GET", null, ""),
        sb("vault_social_posts", "GET", null, "?order=created_at.desc&limit=50"),
        sb("vault_social_api_keys", "GET", null, `?user_id=eq.${user.id}&limit=1`),
      ]);

      // If no brands in DB, seed with defaults
      if (brandsRes && brandsRes.length > 0) {
        setBrands(brandsRes);
      } else {
        setBrands(BRANDS_DEFAULT);
      }

      // Index configs by brand_id
      const cfgMap = {};
      (configsRes || []).forEach(c => { cfgMap[c.brand_id] = c; });
      setConfigs(cfgMap);

      setPosts(postsRes || []);
      setApiKeys(keysRes?.[0] || {});
    } catch (e) {
      console.error("Social load error:", e);
      showToast("Failed to load social data", "error");
    }
    setLoading(false);
  }, [sb, user.id, showToast]);

  useEffect(() => { loadData(); }, [loadData]);

  // ── Config helpers ─────────────────────────────────────────────────────────
  function getConfig(brandId) {
    return configs[brandId] || {
      enabled: false,
      language_en_pct: 70,
      language_es_pct: 30,
      daily_video_limit: 3,
      daily_post_limit: 5,
      critique_mode: false,
      critique_pct: 10,
      post_hour_start: 9,
      post_hour_end: 21,
      auto_approve: false,
      platforms: ["instagram","tiktok"],
    };
  }

  async function saveConfig(brandId, patch) {
    const existing = configs[brandId];
    if (existing?.id) {
      await sb("vault_social_agent_config", "PATCH", patch, `?id=eq.${existing.id}`);
    } else {
      await sb("vault_social_agent_config", "POST", { brand_id: brandId, user_id: user.id, ...patch });
    }
    // Refresh
    const cfgRes = await sb("vault_social_agent_config", "GET", null, "");
    const cfgMap = {};
    (cfgRes || []).forEach(c => { cfgMap[c.brand_id] = c; });
    setConfigs(cfgMap);
  }

  // ── Generate Content ──────────────────────────────────────────────────────
  async function handleGenerate(brand) {
    const cfg = getConfig(brand.id);
    const todayPosts = posts.filter(p => p.brand_id === brand.id && p.created_at?.startsWith(new Date().toISOString().slice(0,10)));
    const todayVideos = todayPosts.filter(p => p.content_type === "video").length;
    const todayTextPosts = todayPosts.filter(p => p.content_type !== "video").length;

    if (todayVideos >= (cfg.daily_video_limit || 3)) {
      showToast(`Daily video limit reached for ${brand.name}`, "error");
      return;
    }
    if (todayTextPosts >= (cfg.daily_post_limit || 5)) {
      showToast(`Daily post limit reached for ${brand.name}`, "error");
      return;
    }

    setGenerating(prev => ({ ...prev, [brand.id]: true }));

    const payload = {
      brandId: brand.id,
      brandName: brand.name,
      languageMix: { en: cfg.language_en_pct || 70, es: cfg.language_es_pct || 30 },
      critiquePercent: cfg.critique_mode ? (cfg.critique_pct || 10) : 0,
      dailyCaps: { videos: cfg.daily_video_limit || 3, posts: cfg.daily_post_limit || 5 },
      guardrails: GUARDRAILS,
      platforms: cfg.platforms || ["instagram","tiktok"],
      userId: user.id,
    };

    try {
      const res = await n8nPost("social-generate", payload);
      if (res) {
        // Create draft records
        const drafts = (res.posts || [{ hook: "Content generation triggered", script: "Pending...", platform: "instagram", language: "en" }]);
        for (const d of drafts) {
          await sb("vault_social_posts", "POST", {
            brand_id: brand.id,
            user_id: user.id,
            status: "DRAFT",
            hook: d.hook || "Untitled",
            script: d.script || "",
            caption: d.caption || "",
            hashtags: d.hashtags || "",
            platform: d.platform || "instagram",
            language: d.language || "en",
            content_type: d.content_type || "post",
          });
        }
        showToast(`Content generation triggered for ${brand.name}`, "success");
        // Reload posts
        const postsRes = await sb("vault_social_posts", "GET", null, "?order=created_at.desc&limit=50");
        setPosts(postsRes || []);
      } else {
        showToast("Generation request sent (webhook may be processing)", "info");
      }
    } catch (e) {
      console.error("Generate error:", e);
      showToast("Failed to trigger generation", "error");
    }

    setGenerating(prev => ({ ...prev, [brand.id]: false }));
  }

  // ── Post actions ───────────────────────────────────────────────────────────
  async function updatePostStatus(postId, status) {
    await sb("vault_social_posts", "PATCH", { status }, `?id=eq.${postId}`);
    setPosts(prev => prev.map(p => p.id === postId ? { ...p, status } : p));
    showToast(`Post ${status === "READY_TO_POST" ? "approved" : "updated to " + status}`, "success");
  }

  async function deletePost(postId) {
    await sb("vault_social_posts", "DELETE", null, `?id=eq.${postId}`);
    setPosts(prev => prev.filter(p => p.id !== postId));
    showToast("Post deleted", "info");
  }

  // ── API Keys save ─────────────────────────────────────────────────────────
  async function saveApiKeys() {
    setSavingKeys(true);
    try {
      const payload = {
        user_id: user.id,
        anthropic_key: apiKeys.anthropic_key || "",
        elevenlabs_key: apiKeys.elevenlabs_key || "",
        heygen_key: apiKeys.heygen_key || "",
        eclincher_key: apiKeys.eclincher_key || "",
        n8n_webhook_url: apiKeys.n8n_webhook_url || "",
        n8n_webhook_secret: apiKeys.n8n_webhook_secret || "",
        ghl_key: apiKeys.ghl_key || "",
      };
      if (apiKeys.id) {
        await sb("vault_social_api_keys", "PATCH", payload, `?id=eq.${apiKeys.id}`);
      } else {
        const res = await sb("vault_social_api_keys", "POST", payload);
        if (res?.[0]) setApiKeys(res[0]);
      }
      setKeysDirty(false);
      showToast("API keys saved", "success");
    } catch (e) {
      showToast("Failed to save keys", "error");
    }
    setSavingKeys(false);
  }

  async function testConnection(service) {
    setTestResults(prev => ({ ...prev, [service]: "testing" }));
    try {
      const res = await n8nPost("social-test-connection", { service, userId: user.id });
      setTestResults(prev => ({ ...prev, [service]: res?.ok ? "ok" : "fail" }));
    } catch {
      setTestResults(prev => ({ ...prev, [service]: "fail" }));
    }
  }

  // ── Filter posts ──────────────────────────────────────────────────────────
  const filteredPosts = posts.filter(p => {
    if (filterBrand !== "all" && p.brand_id !== filterBrand) return false;
    if (filterStatus !== "all" && p.status !== filterStatus) return false;
    if (filterPlatform !== "all" && p.platform !== filterPlatform) return false;
    return true;
  });

  // ── Brand today stats ─────────────────────────────────────────────────────
  function brandTodayStats(brandId) {
    const today = new Date().toISOString().slice(0,10);
    const todayPosts = posts.filter(p => p.brand_id === brandId && p.created_at?.startsWith(today));
    return {
      posts: todayPosts.filter(p => p.content_type !== "video").length,
      videos: todayPosts.filter(p => p.content_type === "video").length,
    };
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ─── RENDER ──────────────────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════

  if (loading) {
    return (
      <div style={{ display:"flex",alignItems:"center",justifyContent:"center",height:400,color:"#555",gap:8 }}>
        <Spin size={14} color="#f59e0b" />
        <span style={{ fontSize:11,letterSpacing:".1em" }}>LOADING SOCIAL AI...</span>
      </div>
    );
  }

  return (
    <div style={{ padding:0 }}>
      {toast && <Toast message={toast.message} type={toast.type} />}

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={{ display:"flex",alignItems:"center",gap:12,marginBottom:20 }}>
        <span style={{ fontSize:18 }}>🤖</span>
        <span style={{ fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:".2em",color:"#d4af37" }}>SOCIAL AI AGENTS</span>
        <div style={{ flex:1 }} />
        <Btn onClick={loadData} variant="ghost" style={{ display:"flex",alignItems:"center",gap:4 }}>
          🔄 REFRESH
        </Btn>
      </div>

      {/* ── Tabs ──────────────────────────────────────────────────────────── */}
      <div style={{ display:"flex",gap:2,marginBottom:20,borderBottom:"1px solid rgba(255,255,255,.06)",paddingBottom:0 }}>
        {[
          { key:"brands", icon:"🤖", label:"BRANDS & AGENTS" },
          { key:"queue",  icon:"📋", label:"CONTENT QUEUE" },
          { key:"settings", icon:"⚙", label:"SETTINGS" },
        ].map(t => (
          <button key={t.key} onClick={()=>setTab(t.key)} style={{
            display:"flex",alignItems:"center",gap:6,padding:"8px 16px",fontSize:10,letterSpacing:".08em",
            fontFamily:"inherit",cursor:"pointer",border:"none",borderBottom:tab===t.key?"2px solid #f59e0b":"2px solid transparent",
            background:"transparent",color:tab===t.key?"#f59e0b":"#555",transition:"all .2s",
          }}>
            <span style={{ fontSize:11 }}>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab Content ───────────────────────────────────────────────────── */}
      {tab === "brands"   && renderBrandsTab()}
      {tab === "queue"    && renderQueueTab()}
      {tab === "settings" && renderSettingsTab()}

      {/* ── Brand Edit Modal ──────────────────────────────────────────────── */}
      {editBrand && renderBrandModal()}
    </div>
  );

  // ═════════════════════════════════════════════════════════════════════════════
  // ─── TAB 1: BRANDS & AGENTS ──────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════

  function renderBrandsTab() {
    return (
      <div style={{ display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16 }}>
        {brands.map(brand => {
          const cfg = getConfig(brand.id);
          const stats = brandTodayStats(brand.id);
          const isGen = generating[brand.id];
          return (
            <div key={brand.id} style={{
              background:"#0f0f23",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:18,
              position:"relative",transition:"border-color .2s",
            }}>
              {/* Top row: name + type + gear */}
              <div style={{ display:"flex",alignItems:"center",gap:8,marginBottom:12 }}>
                <div style={{ width:36,height:36,borderRadius:8,background:`${brand.color}18`,border:`1px solid ${brand.color}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:700,color:brand.color }}>
                  {brand.name.charAt(0)}
                </div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13,fontWeight:600,color:"#fff",letterSpacing:".02em" }}>{brand.name}</div>
                  <Bd label={brand.type} color={brand.color} />
                </div>
                <button onClick={()=>setEditBrand(brand)} style={{ background:"none",border:"none",color:"#444",cursor:"pointer",fontSize:14,padding:4 }}>
                  ⚙
                </button>
              </div>

              {/* Toggle */}
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12 }}>
                <Toggle on={cfg.enabled} onToggle={()=>saveConfig(brand.id, { enabled: !cfg.enabled })} label={cfg.enabled ? "AGENT ON" : "AGENT OFF"} />
              </div>

              {/* Language mix */}
              <div style={{ marginBottom:10 }}>
                <div style={{ fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:4 }}>LANGUAGE MIX</div>
                <div style={{ display:"flex",alignItems:"center",gap:6 }}>
                  <div style={{ flex:1,height:6,borderRadius:3,background:"#1a1a2e",overflow:"hidden" }}>
                    <div style={{ width:`${cfg.language_en_pct||70}%`,height:"100%",background:"#3b82f6",borderRadius:3 }} />
                  </div>
                  <span style={{ fontSize:9,color:"#888",whiteSpace:"nowrap" }}>{cfg.language_en_pct||70}% EN / {cfg.language_es_pct||30}% ES</span>
                </div>
              </div>

              {/* Daily limits */}
              <div style={{ display:"flex",gap:12,marginBottom:14 }}>
                <div style={{ flex:1,background:"#0a0a1a",borderRadius:6,padding:"6px 10px",border:"1px solid rgba(255,255,255,.04)" }}>
                  <div style={{ fontSize:8,color:"#555",letterSpacing:".08em" }}>VIDEOS/DAY</div>
                  <div style={{ fontSize:16,fontWeight:700,color:"#fff" }}>{cfg.daily_video_limit||3}</div>
                </div>
                <div style={{ flex:1,background:"#0a0a1a",borderRadius:6,padding:"6px 10px",border:"1px solid rgba(255,255,255,.04)" }}>
                  <div style={{ fontSize:8,color:"#555",letterSpacing:".08em" }}>POSTS/DAY</div>
                  <div style={{ fontSize:16,fontWeight:700,color:"#fff" }}>{cfg.daily_post_limit||5}</div>
                </div>
              </div>

              {/* Generate button */}
              <Btn onClick={()=>handleGenerate(brand)} variant="gold" disabled={isGen || !cfg.enabled} style={{ width:"100%",padding:"8px 0",fontSize:11,marginBottom:10,display:"flex",alignItems:"center",justifyContent:"center",gap:6 }}>
                {isGen ? <><Spin size={10} color="#000" /> GENERATING...</> : <>✨ GENERATE TODAY'S CONTENT</>}
              </Btn>

              {/* Today stats */}
              <div style={{ display:"flex",gap:12,justifyContent:"center" }}>
                <span style={{ fontSize:9,color:"#555" }}>🎬 {stats.videos} videos today</span>
                <span style={{ fontSize:9,color:"#555" }}>📝 {stats.posts} posts today</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ─── TAB 2: CONTENT QUEUE ────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════

  function renderQueueTab() {
    return (
      <div>
        {/* Filters */}
        <div style={{ display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center" }}>
          <span style={{ fontSize:11,color:"#555" }}>🔍</span>
          <Sel value={filterBrand} onChange={setFilterBrand} style={{ width:160 }}>
            <option value="all">All Brands</option>
            {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Sel>
          <Sel value={filterStatus} onChange={setFilterStatus} style={{ width:160 }}>
            <option value="all">All Statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{STATUS_COLORS[s].label}</option>)}
          </Sel>
          <Sel value={filterPlatform} onChange={setFilterPlatform} style={{ width:140 }}>
            <option value="all">All Platforms</option>
            {Object.keys(PLATFORM_ICONS).map(p => <option key={p} value={p}>{PLATFORM_ICONS[p]} - {p}</option>)}
          </Sel>
          <span style={{ fontSize:9,color:"#444",marginLeft:"auto" }}>{filteredPosts.length} posts</span>
        </div>

        {/* Empty state */}
        {filteredPosts.length === 0 && (
          <div style={{ textAlign:"center",padding:60,color:"#1e1e2e" }}>
            <div style={{ fontSize:28,marginBottom:8,opacity:.4 }}>📋</div>
            <div style={{ fontSize:11,color:"#555" }}>No posts found. Generate content from the Brands tab.</div>
          </div>
        )}

        {/* Posts list */}
        <div style={{ display:"flex",flexDirection:"column",gap:8 }}>
          {filteredPosts.map(post => {
            const isExpanded = expandedPost === post.id;
            const brandInfo = brands.find(b => b.id === post.brand_id) || { name: post.brand_id, color: "#555" };
            return (
              <div key={post.id} style={{
                background:"#0f0f23",border:"1px solid rgba(255,255,255,.06)",borderRadius:8,overflow:"hidden",
                transition:"border-color .2s",
              }}>
                {/* Summary row */}
                <div onClick={()=>setExpandedPost(isExpanded ? null : post.id)} style={{
                  display:"flex",alignItems:"center",gap:10,padding:"12px 16px",cursor:"pointer",
                }}>
                  <div style={{ width:4,height:28,borderRadius:2,background:brandInfo.color,flexShrink:0 }} />
                  <div style={{ flex:1,minWidth:0 }}>
                    <div style={{ fontSize:12,fontWeight:600,color:"#fff",marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                      {post.hook || "Untitled Post"}
                    </div>
                    <div style={{ fontSize:10,color:"rgba(255,255,255,.4)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>
                      {post.script ? post.script.slice(0, 80) + (post.script.length > 80 ? "..." : "") : "No script"}
                    </div>
                  </div>
                  <div style={{ display:"flex",alignItems:"center",gap:6,flexShrink:0 }}>
                    <PlatformBadge platform={post.platform} />
                    <LangBadge lang={post.language} />
                    <StatusBadge status={post.status} />
                    {post.scheduled_at && (
                      <span style={{ fontSize:8,color:"#555",display:"flex",alignItems:"center",gap:3 }}>
                        🕐 {new Date(post.scheduled_at).toLocaleString(undefined,{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"})}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize:10,color:"#555" }}>{isExpanded ? "▼" : "▶"}</span>
                </div>

                {/* Expanded details */}
                {isExpanded && (
                  <div style={{ padding:"0 16px 16px",borderTop:"1px solid rgba(255,255,255,.04)" }}>
                    <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginTop:12 }}>
                      {/* Script */}
                      <div>
                        <div style={{ fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:4 }}>SCRIPT</div>
                        <div style={{ fontSize:11,color:"rgba(255,255,255,.7)",lineHeight:1.5,background:"#0a0a1a",borderRadius:6,padding:10,border:"1px solid rgba(255,255,255,.04)",maxHeight:200,overflowY:"auto",whiteSpace:"pre-wrap" }}>
                          {post.script || "No script yet."}
                        </div>
                      </div>
                      {/* Caption & Hashtags */}
                      <div>
                        <div style={{ fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:4 }}>CAPTION</div>
                        <div style={{ fontSize:11,color:"rgba(255,255,255,.7)",lineHeight:1.5,background:"#0a0a1a",borderRadius:6,padding:10,border:"1px solid rgba(255,255,255,.04)",marginBottom:8,whiteSpace:"pre-wrap" }}>
                          {post.caption || "No caption."}
                        </div>
                        {post.hashtags && (
                          <>
                            <div style={{ fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:4 }}>HASHTAGS</div>
                            <div style={{ fontSize:10,color:"#3b82f6",lineHeight:1.6 }}>{post.hashtags}</div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Video preview if available */}
                    {post.video_url && (
                      <div style={{ marginTop:12 }}>
                        <div style={{ fontSize:9,color:"#555",letterSpacing:".08em",marginBottom:4 }}>VIDEO PREVIEW</div>
                        <video src={post.video_url} controls style={{ width:"100%",maxHeight:240,borderRadius:6,background:"#000" }} />
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display:"flex",gap:8,marginTop:14,justifyContent:"flex-end" }}>
                      {(post.status === "DRAFT" || post.status === "READY_TO_RENDER") && (
                        <Btn onClick={()=>updatePostStatus(post.id, "READY_TO_POST")} variant="success">
                          ✓ APPROVE
                        </Btn>
                      )}
                      {(post.status === "DRAFT" || post.status === "READY_TO_RENDER") && (
                        <Btn onClick={()=>updatePostStatus(post.id, "FAILED")} variant="danger">
                          ✕ REJECT
                        </Btn>
                      )}
                      {post.status === "READY_TO_POST" && (
                        <Btn onClick={()=>updatePostStatus(post.id, "SCHEDULED")} variant="gold">
                          🕐 SCHEDULE
                        </Btn>
                      )}
                      <Btn onClick={()=>deletePost(post.id)} variant="danger">
                        🗑 DELETE
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ─── TAB 3: SETTINGS ─────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════

  function renderSettingsTab() {
    function keyField(label, field, placeholder) {
      const isMasked = field !== "n8n_webhook_url";
      const tr = testResults[field];
      return (
        <Fld label={label}>
          <div style={{ display:"flex",gap:6 }}>
            <Inp
              type={isMasked ? "password" : "text"}
              value={apiKeys[field] || ""}
              onChange={v => { setApiKeys(prev => ({ ...prev, [field]: v })); setKeysDirty(true); }}
              placeholder={placeholder}
              style={{ flex:1 }}
            />
            <Btn onClick={()=>testConnection(field)} variant="ghost" style={{ whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:4 }}>
              {tr === "testing" ? <Spin size={10} color="#888" /> :
               tr === "ok" ? <span style={{ color:"#10b981" }}>✓</span> :
               tr === "fail" ? <span style={{ color:"#ef4444" }}>✕</span> :
               <span>⚡</span>}
              TEST
            </Btn>
          </div>
        </Fld>
      );
    }

    return (
      <div style={{ maxWidth:600 }}>
        <div style={{ background:"#0f0f23",border:"1px solid rgba(255,255,255,.06)",borderRadius:12,padding:20 }}>
          <div style={{ fontSize:13,fontWeight:600,color:"#fff",marginBottom:16,display:"flex",alignItems:"center",gap:8 }}>
            <span style={{ fontSize:14 }}>🛡</span> API KEYS & CONNECTIONS
          </div>

          {keyField("ANTHROPIC API KEY", "anthropic_key", "sk-ant-...")}
          {keyField("ELEVENLABS API KEY", "elevenlabs_key", "xi-...")}
          {keyField("HEYGEN API KEY", "heygen_key", "hg-...")}
          {keyField("eCLINCHER API KEY", "eclincher_key", "ec-...")}
          {keyField("n8n WEBHOOK URL", "n8n_webhook_url", "https://n8n.example.com/webhook/...")}
          {keyField("n8n WEBHOOK SECRET", "n8n_webhook_secret", "secret-...")}
          {keyField("GHL API KEY", "ghl_key", "ghl-...")}

          <div style={{ display:"flex",gap:8,marginTop:16 }}>
            <Btn onClick={saveApiKeys} variant="gold" disabled={!keysDirty || savingKeys} style={{ display:"flex",alignItems:"center",gap:4 }}>
              {savingKeys ? <Spin size={10} color="#000" /> : "✓"}
              {savingKeys ? " SAVING..." : " SAVE KEYS"}
            </Btn>
          </div>
        </div>
      </div>
    );
  }

  // ═════════════════════════════════════════════════════════════════════════════
  // ─── BRAND EDIT MODAL ────────────────────────────────────────────────────
  // ═════════════════════════════════════════════════════════════════════════════

  function renderBrandModal() {
    const brand = editBrand;
    const cfg = getConfig(brand.id);

    function updateField(field, value) {
      const patch = { [field]: value };
      // Keep en/es in sync
      if (field === "language_es_pct") {
        patch.language_en_pct = 100 - value;
      }
      if (field === "language_en_pct") {
        patch.language_es_pct = 100 - value;
      }
      saveConfig(brand.id, patch);
    }

    const HOURS = Array.from({length:24}, (_,i) => ({ value: i, label: `${i.toString().padStart(2,"0")}:00` }));
    const allPlatforms = Object.keys(PLATFORM_ICONS);
    const activePlatforms = cfg.platforms || [];

    return (
      <Modal onClose={()=>setEditBrand(null)} title={`${brand.name} — AGENT SETTINGS`} width="520px">
        {/* Brand name (read-only) */}
        <Fld label="BRAND">
          <div style={{ fontSize:13,color:"#fff",fontWeight:600,padding:"8px 0" }}>{brand.name}</div>
        </Fld>

        {/* Language Mix Slider */}
        <Fld label={`LANGUAGE MIX — ${100 - (cfg.language_es_pct||30)}% ENGLISH / ${cfg.language_es_pct||30}% SPANISH`}>
          <input
            type="range" min={0} max={100} value={cfg.language_es_pct || 30}
            onChange={e => updateField("language_es_pct", parseInt(e.target.value))}
            style={{ width:"100%",accentColor:"#f59e0b" }}
          />
          <div style={{ display:"flex",justifyContent:"space-between",fontSize:8,color:"#555" }}>
            <span>100% English</span>
            <span>100% Spanish</span>
          </div>
        </Fld>

        {/* Daily Limits */}
        <div style={{ display:"flex",gap:12 }}>
          <Fld label="DAILY VIDEO LIMIT">
            <Inp type="number" value={cfg.daily_video_limit || 3} onChange={v => updateField("daily_video_limit", parseInt(v)||0)} style={{ width:80 }} />
          </Fld>
          <Fld label="DAILY POST LIMIT">
            <Inp type="number" value={cfg.daily_post_limit || 5} onChange={v => updateField("daily_post_limit", parseInt(v)||0)} style={{ width:80 }} />
          </Fld>
        </div>

        {/* Critique Mode */}
        <Fld label="CRITIQUE MODE">
          <div style={{ display:"flex",alignItems:"center",gap:12 }}>
            <Toggle on={cfg.critique_mode} onToggle={()=>updateField("critique_mode", !cfg.critique_mode)} />
            {cfg.critique_mode && (
              <div style={{ flex:1 }}>
                <div style={{ fontSize:9,color:"#555",marginBottom:2 }}>CRITIQUE PERCENT: {cfg.critique_pct||10}%</div>
                <input type="range" min={0} max={40} value={cfg.critique_pct||10} onChange={e=>updateField("critique_pct", parseInt(e.target.value))} style={{ width:"100%",accentColor:"#f59e0b" }} />
              </div>
            )}
          </div>
        </Fld>

        {/* Posting Hours */}
        <div style={{ display:"flex",gap:12 }}>
          <Fld label="POST HOUR START">
            <Sel value={cfg.post_hour_start ?? 9} onChange={v => updateField("post_hour_start", parseInt(v))} options={HOURS.map(h=>({value:h.value,label:h.label}))} style={{ width:100 }} />
          </Fld>
          <Fld label="POST HOUR END">
            <Sel value={cfg.post_hour_end ?? 21} onChange={v => updateField("post_hour_end", parseInt(v))} options={HOURS.map(h=>({value:h.value,label:h.label}))} style={{ width:100 }} />
          </Fld>
        </div>

        {/* Auto-approval */}
        <Fld label="AUTO-APPROVAL">
          <Toggle on={cfg.auto_approve} onToggle={()=>updateField("auto_approve", !cfg.auto_approve)} label={cfg.auto_approve ? "Posts auto-approved" : "Manual review required"} />
        </Fld>

        {/* Connected Platforms */}
        <Fld label="CONNECTED PLATFORMS">
          <div style={{ display:"flex",flexWrap:"wrap",gap:6 }}>
            {allPlatforms.map(p => {
              const active = activePlatforms.includes(p);
              const c = active ? "#f59e0b" : "#333";
              return (
                <button key={p} onClick={() => {
                  const newPlats = active ? activePlatforms.filter(x => x !== p) : [...activePlatforms, p];
                  updateField("platforms", newPlats);
                }} style={{
                  padding:"4px 10px",borderRadius:4,fontSize:9,letterSpacing:".06em",textTransform:"uppercase",
                  background:active?`${c}18`:"#0a0a1a",color:c,border:`1px solid ${c}40`,cursor:"pointer",fontFamily:"inherit",
                  transition:"all .2s",
                }}>
                  {PLATFORM_ICONS[p]} {p}
                </button>
              );
            })}
          </div>
        </Fld>

        <div style={{ marginTop:16,display:"flex",justifyContent:"flex-end" }}>
          <Btn onClick={()=>setEditBrand(null)} variant="ghost">CLOSE</Btn>
        </div>
      </Modal>
    );
  }
}
