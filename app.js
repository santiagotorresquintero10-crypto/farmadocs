// ═══════════════════════════════════════════════════════
//  FarmaDocs v9 — app.js
//  • Subcampos globales en Firestore (visibles para todos)
//  • Nombre correcto desde Firestore (nunca email)
//  • Visor de PDF e imágenes en modal
//  • Subida de imagen/PDF en formulario de documentos
//  • Menú actualizado con nuevos ítems
// ═══════════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, onAuthStateChanged, updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import {
  getFirestore, collection, addDoc, getDocs, doc, updateDoc,
  deleteDoc, query, where, serverTimestamp, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── Firebase Config ──────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyDKcxqaSg4LYhi5RUf5VAtbaT_UHCuTNGI",
  authDomain: "farmadocs-2024.firebaseapp.com",
  projectId: "farmadocs-2024",
  storageBucket: "farmadocs-2024.firebasestorage.app",
  messagingSenderId: "638588290494",
  appId: "1:638588290494:web:295e18b32c55469586e5ef",
  measurementId: "G-ZCQ8CTQN7J"
};
const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db   = getFirestore(firebaseApp);

// ── State ─────────────────────────────────────────────────
let currentUser     = null;
let currentUserDoc  = null;
let currentUserData = {};
let currentSection  = null;   // top-level menu section
let currentSgcParent = null;
let currentSgcSub   = null;   // subcampo (tarjeta) selected in SGC
let calDate         = new Date();
let allDocs         = [];
let allSgcDocs      = [];
let editingId       = null;
let sidebarCollapsed = false;
let profileTabActive = 'info';
let currentDocSubcampo = null;  // subcampo (tarjeta) selected in doc view
let pendingImageData   = null;

// ── Active doc context — the single source of truth for what section to save/load docs ──
// Can be: currentSection, currentDocSubcampo, currentSgcSub, or a node.fid (subitem)
let currentActiveDocSection = null;  // the actual Firestore section key in use
let currentNodeSubitem      = null;  // { fid, name } when a subitem card is selected, else null
let currentNodeSubitemParent = null; // subcampoId that owns currentNodeSubitem

// SGC default subcampos (used only if Firestore has none for a parent)
const SGC_DEFAULTS = {
  "Procesos Estratégicos":           ["Misión","Visión"],
  "Procesos Misionales":             ["Caracterización del establecimiento","Estructura interna","Usuarios","Proveedores","Procesos propios","Procesos estratégicos","Criterios y métodos","Puntos de control sobre riesgos","Acciones necesarias"],
  "Procesos de Apoyo y de Soporte":  ["Infraestructura","Recurso humano","Control de inventarios","Mantenimiento","Inyectología","Mensajería"],
  "Procesos de Evaluación y Control":["Evaluación y capacitación","Mejoramiento e indicadores","Seguimiento y auditoría"],
};

// ═══════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════
window.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => g("loader").classList.add("fade-out"), 1500);
  const dd = g("dash-date");
  if (dd) dd.textContent = new Date().toLocaleDateString("es-CO",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
  document.addEventListener("click", onDocClick);
});

function onDocClick(e) {
  const nT=g("notif-trigger"),nD=g("notif-dropdown");
  if (nT&&nD&&!nT.contains(e.target)&&!nD.contains(e.target)){nD.classList.add("hidden");nT.classList.remove("active");}
  const pT=g("profile-trigger"),pD=g("profile-dropdown");
  if (pT&&pD&&!pT.contains(e.target)&&!pD.contains(e.target)){pD.classList.add("hidden");pT.classList.remove("active");}
}

// ═══════════════════════════════════════════════════════
//  AUTH STATE
// ═══════════════════════════════════════════════════════
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUser = user;
    await loadUserData(user);
    showApp();
    navigate("home");
    loadDashboardStats();
    renderCalendar();
  } else {
    currentUser = null; currentUserData = {};
    showAuth();
  }
});

// ── Load user profile from Firestore — ALWAYS use name, never email ──
async function loadUserData(user) {
  const snap = await getDocs(query(collection(db,"users"), where("uid","==",user.uid)));
  let data = { name:"", role:"Regente de Farmacia", establecimiento:"FarmaDocs" };
  if (!snap.empty) {
    currentUserDoc = snap.docs[0].id;
    data = { ...data, ...snap.docs[0].data() };
  }
  // Build display name: use name field first; never fall back to email for display
  data._displayName = buildDisplayName(data);
  currentUserData = data;
  updateUIUser(user, data);
}

function buildDisplayName(d) {
  // Priority: name field → "Usuario"  (NEVER email)
  const n = (d.name || "").trim();
  if (n) return n;
  return "Usuario";
}

function updateUIUser(user, d) {
  const displayName = d._displayName || buildDisplayName(d);
  const firstName   = displayName.split(" ")[0];
  const initials    = displayName !== "Usuario"
    ? displayName.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase()
    : "FD";
  const hour  = new Date().getHours();
  const greet = hour<12?"Buenos días":hour<18?"Buenas tardes":"Buenas noches";

  // Sidebar
  safeSet("sidebar-name",   displayName);
  safeSet("sidebar-role",   d.role);
  safeSet("sidebar-avatar", initials);

  // Topbar (show name; show email only in the small sub-label)
  safeSet("topbar-name",    displayName);
  safeSet("topbar-role",    d.role);
  safeSet("topbar-avatar",  initials);

  // Dashboard greeting — name only, never email
  safeSet("dash-greeting",  `${greet}, ${firstName} 👋`);
  safeSet("dash-sub",       "Aquí tienes el resumen general de tu sistema");

  // Profile dropdown
  safeSet("pd-name",    displayName);
  safeSet("pd-email",   user.email);   // email shown explicitly here
  safeSet("pd-est",     d.establecimiento || "—");
  safeSet("pd-avatar",  initials);
}

// ═══════════════════════════════════════════════════════
//  AUTH FUNCTIONS
// ═══════════════════════════════════════════════════════
window.doLogin = async () => {
  const email=val("login-email"),pwd=val("login-password");
  const err=g("login-error"); err.textContent="";
  if(!email||!pwd){err.textContent="Completa todos los campos.";return;}
  const btn=g("page-login").querySelector(".btn-cta"); setLoading(btn,true);
  try{await signInWithEmailAndPassword(auth,email,pwd);}
  catch(e){err.textContent=friendlyError(e.code);setLoading(btn,false);}
};

window.doRegister = async () => {
  const name=val("reg-name"),cedula=val("reg-cedula"),est=val("reg-establecimiento"),
        nit=val("reg-nit"),dir=val("reg-direccion"),tel=val("reg-telefono"),
        email=val("reg-email"),pwd=val("reg-password");
  const err=g("reg-error"); err.textContent="";
  if(!name||!email||!pwd||!est){err.textContent="Nombre, establecimiento, correo y contraseña son obligatorios.";return;}
  const btn=g("page-register").querySelector(".btn-cta"); setLoading(btn,true);
  try{
    const cred=await createUserWithEmailAndPassword(auth,email,pwd);
    await addDoc(collection(db,"users"),{uid:cred.user.uid,name,cedula,establecimiento:est,nit,direccion:dir,telefono:tel,email,role:"Regente de Farmacia",createdAt:serverTimestamp()});
    showToast("¡Cuenta creada exitosamente!","success");
  }catch(e){err.textContent=friendlyError(e.code);setLoading(btn,false);}
};

window.doRecover = async () => {
  const email=val("recover-email"); const msg=g("recover-msg"); msg.textContent="";msg.style.color="";
  if(!email){msg.textContent="Ingresa tu correo.";return;}
  const btn=g("page-recover").querySelector(".btn-cta"); setLoading(btn,true);
  try{
    await sendPasswordResetEmail(auth,email);
    msg.textContent="✓ Enlace enviado. Revisa tu bandeja."; msg.style.color="var(--teal)";
  }catch(e){msg.textContent=friendlyError(e.code);}
  finally{setLoading(btn,false);}
};

window.doLogout = async () => {
  closeProfileDropdown(); await signOut(auth); showToast("Sesión cerrada","info");
};

// ═══════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════
window.navigate = async (type, section) => {
  document.querySelectorAll(".nav-item,.nav-sub-item").forEach(el=>el.classList.remove("active"));
  document.querySelectorAll(".nav-accordion-trigger").forEach(el=>el.classList.remove("has-active"));

  if (type==="home") {
    g('[data-section="home"]')?.classList.add("active");
    setBreadcrumb("Inicio"); showView("view-home");
    await loadDashboardStats();
  } else if (type==="doc") {
    currentSection=section; currentDocSubcampo=null;
    const m=document.querySelector(`[data-key="${section}"]`);
    if(m){m.classList.add("active");openParentAccordion(m);}
    setBreadcrumb(`${getSectionParent(section)} / ${section}`);
    safeSet("doc-section-title",section);
    safeSet("doc-breadcrumb",getSectionParent(section));
    // Immediate UI reset for snappy feel
    g("doc-subcampo-back")?.classList.add("hidden");
    g("subitems-panel")?.classList.add("hidden");
    safeSet("doc-add-label","Agregar documento");
    g("doc-subcampo-grid").innerHTML="";
    g("doc-tbody").innerHTML=`<tr><td colspan="5" class="table-empty-row"><div class="empty-state" style="padding:20px"><p>Cargando...</p></div></td></tr>`;
    g("doc-stats-strip").innerHTML="";
    g("doc-direct-wrap")?.classList.add("hidden");
    if(g("doc-direct-tbody")) g("doc-direct-tbody").innerHTML="";
    g("doc-direct-stats") && (g("doc-direct-stats").innerHTML="");
    showView("view-doc");
    await loadDocuments();
  } else if (type==="sgc-sub") {
    currentSgcParent=section; currentSgcSub=null;
    const m=document.querySelector(`[data-key="${section}"]`);
    if(m){m.classList.add("active");openParentAccordion(m);}
    setBreadcrumb(`SGC / ${section}`);
    safeSet("sgc-sub-title",section);
    safeSet("sgc-add-label","Agregar documento");
    // Immediate UI reset
    g("active-sub-label")?.classList.add("hidden");
    g("sgc-subitems-panel")?.classList.add("hidden");
    g("sgc-subcat-grid").innerHTML="";
    g("sgc-doc-tbody").innerHTML=`<tr><td colspan="5" class="table-empty-row"><div class="empty-state" style="padding:20px"><p>Cargando...</p></div></td></tr>`;
    g("sgc-stats-strip").innerHTML="";
    showView("view-sgc-sub");
    await loadSgcSubcamposFromFirestore(section);
    renderSgcSubcategoryGrid();
    await loadSgcDocs();
  }
  closeMobileSidebar();
};

function openParentAccordion(el) {
  const body=el.closest(".nav-accordion-body");
  if(body){body.classList.add("open");const t=body.previousElementSibling;if(t){t.classList.add("open","has-active");}}
}

function getSectionParent(s) {
  const m={
    "Cámara de Comercio":"Documentación Legal","RUT":"Documentación Legal","Representante Legal":"Documentación Legal",
    "Certificado Uso de Suelos":"Documentación Legal","Certificado de Calibración":"Documentación Legal",
    "Certificado de Fumigación":"Documentación Legal","Certificado de Bomberos":"Documentación Legal",
    "Contrato Recolección Residuos":"Documentación Legal","Recarga Extintor":"Documentación Legal",
    "Actas de Visitas":"Actas de Visitas",
    "Actas de Visitas - Secretaría Seccional":"Actas de Visitas",
    "Actas de Visitas - Secretaría de Salud":"Actas de Visitas",
    "Administrador":"Talento Humano","Regente":"Talento Humano","Auxiliar":"Talento Humano","Mensajero":"Talento Humano",
    "Sistema de Gestión de la Calidad":"Normatividad","PGIRS":"Normatividad",
    "Generalidades":"SGC",
    "PGIRASA-modulo":"PGIRASA",
    "PGIRASA-Información General":"PGIRASA",
    "PGIRASA-Políticas Institucionales":"PGIRASA",
    "PGIRASA-Clasificación del Generador":"PGIRASA",
    "PGIRASA-Gestión Integral":"PGIRASA",
    "PGIRASA-Gestión Interna":"PGIRASA",
    "PGIRASA-Gestión Externa":"PGIRASA",
    "PQIRS":"PQIRS","Encuestas y PQRS":"Encuestas y PQRS",
    "Publicidad":"Publicidad","Alertas Sanitarias":"Alertas Sanitarias",
  };
  return m[s]||"FarmaDocs";
}

function setBreadcrumb(text) {
  const bc=g("breadcrumb"); if(!bc) return;
  bc.innerHTML=text.split(" / ").map((p,i,a)=>
    i===a.length-1?`<span class="bc-active">${p}</span>`:`<span>${p}</span>`
  ).join(' <span style="opacity:.4;margin:0 3px">/</span> ');
}

// ═══════════════════════════════════════════════════════
//  SUBCAMPOS — GLOBAL (Firestore)
// ═══════════════════════════════════════════════════════

// Cache of subcampos loaded from Firestore: { sectionKey: [{id, name, desc, createdAt}] }
let subcampoCache = {};

async function loadDocSubcamposFromFirestore(section) {
  const q = query(collection(db,"subcampos"), where("section","==",section));
  const snap = await getDocs(q);
  subcampoCache[section] = snap.docs.map(d=>({firestoreId:d.id,...d.data()}));
  sortSubcampoCache(section);
}

async function loadSgcSubcamposFromFirestore(parent) {
  const key = `sgc::${parent}`;
  const q = query(collection(db,"subcampos"), where("section","==",key));
  const snap = await getDocs(q);
  if (snap.empty) {
    const defaults = SGC_DEFAULTS[parent] || [];
    const batch = [];
    for (const [idx, name] of defaults.entries()) {
      const ref = await addDoc(collection(db,"subcampos"),{section:key,name,desc:"",order:idx+1,createdAt:serverTimestamp()});
      batch.push({firestoreId:ref.id,section:key,name,desc:"",order:idx+1});
    }
    subcampoCache[key] = batch;
  } else {
    subcampoCache[key] = snap.docs.map(d=>({firestoreId:d.id,...d.data()}));
    sortSubcampoCache(key);
  }
}

function getSubcampos(section) {
  return subcampoCache[section] || [];
}

// ── Render subcampo grid for doc sections ──
// ── Helpers ──────────────────────────────────────────
const svgDoc  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const svgAll  = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 6h16M4 10h16M4 14h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
const svgPlus = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;
const svgEdit = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const svgDel  = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`;

function buildCardHtml(sc, isActive, cnt, ctx) {
  const orderLabel = sc.order != null ? `#${sc.order}` : '';
  const onSelect   = ctx === 'sgc' ? `selectSgcSub('${sc.firestoreId}','${esc(sc.name)}')` : `selectSubcampo('${sc.firestoreId}','${esc(sc.name)}')`;
  const onEdit     = `editSubcampo('${sc.firestoreId}','${ctx}')`;
  const onDel      = `deleteSubcampo('${sc.firestoreId}','${ctx}')`;
  const statusHtml = `<div class="subcampo-card-status">
    <span class="status-mini-label" style="font-size:.67rem;color:var(--text-3)">${cnt} doc${cnt!==1?'s':''}</span>
    ${orderLabel ? `<span class="subcampo-order-pill" style="margin-left:auto">${orderLabel}</span>` : ''}
  </div>`;
  return `<div class="subcampo-card ${isActive?'active':''}">
    <div class="subcampo-card-ctrl">
      <button class="subcampo-edit-btn" onclick="event.stopPropagation();${onEdit}">${svgEdit} Editar</button>
      <button class="subcampo-del" onclick="event.stopPropagation();${onDel}" title="Eliminar">${svgDel}</button>
    </div>
    <div class="subcampo-card-inner" onclick="${onSelect}">
      <div class="subcampo-icon">${svgDoc}</div>
      <div class="subcampo-card-info">
        <div class="subcampo-card-label">${esc2(sc.name)}</div>
        ${sc.desc ? `<div class="subcampo-card-desc">${esc2(sc.desc)}</div>` : ''}
      </div>
    </div>
    ${statusHtml}
  </div>`;
}

function buildTreeItems(list, activeId, ctx) {
  return list.map((sc, i) => {
    const isActive = activeId === sc.firestoreId;
    const isLast   = i === list.length - 1;
    const onSelect = ctx === 'sgc' ? `selectSgcSub('${sc.firestoreId}','${esc(sc.name)}')` : `selectSubcampo('${sc.firestoreId}','${esc(sc.name)}')`;
    const onEdit   = `editSubcampo('${sc.firestoreId}','${ctx}')`;
    const onDel    = `deleteSubcampo('${sc.firestoreId}','${ctx}')`;
    const order    = sc.order != null ? sc.order : i+1;
    return `<div class="tree-item ${isActive?'active':''}">
      <div class="tree-item-connector">
        <div class="tree-item-line" style="${isLast?'height:50%':''}"></div>
        <div class="tree-item-branch"></div>
      </div>
      <div class="tree-item-icon">${svgDoc}</div>
      <div class="tree-item-body" onclick="${onSelect}">
        <div class="tree-item-order">${order}.</div>
        <div class="tree-item-name">${esc2(sc.name)}</div>
      </div>
      <div class="tree-item-actions">
        <button class="tree-action-btn edit" onclick="event.stopPropagation();${onEdit}" title="Editar">${svgEdit}</button>
        <button class="tree-action-btn del"  onclick="event.stopPropagation();${onDel}"  title="Eliminar">${svgDel}</button>
      </div>
    </div>`;
  }).join('');
}

// ── Render DOC subcampo grid + tree ──
function renderSubcampoGrid(section) {
  const grid = g("doc-subcampo-grid"); if (!grid) return;
  const list = getSubcampos(section);
  const cnt  = allDocs.length;

  // TREE
  const treeEl = g("doc-tree-items");
  if (treeEl) treeEl.innerHTML = buildTreeItems(list, currentDocSubcampo, 'doc');
  // Update root active state
  const rootEl = g("doc-tree-panel")?.querySelector(".tree-root-item");
  if (rootEl) rootEl.classList.toggle("active", !currentDocSubcampo);

  // CARDS
  let html = `<div class="subcampo-card all-card ${!currentDocSubcampo?'active':''}">
    <div class="subcampo-card-inner" onclick="selectSubcampo(null)">
      <div class="subcampo-icon" style="${!currentDocSubcampo?'background:var(--teal);color:#fff':''}">${svgAll}</div>
      <div class="subcampo-card-info"><div class="subcampo-card-label">Todos los documentos</div><div class="subcampo-card-count">${cnt} documento${cnt!==1?'s':''}</div></div>
    </div>
  </div>`;
  list.forEach((sc, i) => {
    const isActive = currentDocSubcampo === sc.firestoreId;
    const docCnt   = allDocs.filter(d => d.subcampo === sc.firestoreId).length;
    html += buildCardHtml(sc, isActive, docCnt, 'doc');
  });
  html += `<div class="subcampo-card add-card" onclick="openSubcampoModal('doc')">${svgPlus}<span>Nueva tarjeta</span></div>`;
  grid.innerHTML = html;

  // Count label
  safeSet("doc-cards-count", `${list.length} tarjeta${list.length!==1?'s':''}`);
}

window.selectSubcampo = async (id, name) => {
  currentDocSubcampo = id;
  currentNodeSubitem = null;
  currentNodeSubitemParent = null;
  const panel = g("subitems-panel");
  const cardsView  = g("doc-cards-view");
  const detailView = g("doc-detail-view");

  if (id) {
    cardsView?.classList.add("hidden");
    detailView?.classList.remove("hidden");
    currentActiveDocSection = id;

    // Dynamic breadcrumb: Section > Tarjeta
    safeSet("doc-detail-title", name || id);
    safeSet("doc-detail-breadcrumb", currentSection);
    updateDocHeaderBreadcrumb(currentSection, name, null);
    safeSet("doc-add-label", `Agregar documento`);
    safeSet("doc-volver-label", `← ${name}`);

    // Hide legacy subitems panel — we show subitems as cards instead
    panel?.classList.add("hidden");

    // Load subitem nodes for this subcampo and render as mini-cards above table
    await renderSubitemCards(id, "doc-subitem-cards", "doc");

    // Load docs for this subcampo
    await loadDocsForSection(id);
  } else {
    cardsView?.classList.remove("hidden");
    detailView?.classList.add("hidden");
    currentActiveDocSection = currentSection;
    currentNodeSubitem = null;
    safeSet("doc-add-label", "Agregar documento");
    panel?.classList.add("hidden");
    g("doc-subitem-cards")?.classList.add("hidden");
    updateDocHeaderBreadcrumb(currentSection, null, null);
  }
  renderSubcampoGrid(currentSection);
};
window.clearDocSubcampo = () => selectSubcampo(null);

// ── Render SGC subcampo grid + tree ──
function renderSgcSubcategoryGrid() {
  const grid = g("sgc-subcat-grid"); if (!grid) return;
  const key  = `sgc::${currentSgcParent}`;
  const list = getSubcampos(key);
  const cnt  = allSgcDocs.length;

  // TREE
  const treeEl = g("sgc-tree-items");
  if (treeEl) treeEl.innerHTML = buildTreeItems(list, currentSgcSub, 'sgc');
  const rootEl = g("sgc-tree-panel")?.querySelector(".tree-root-item");
  if (rootEl) rootEl.classList.toggle("active", !currentSgcSub);

  // CARDS
  let html = `<div class="subcampo-card all-card ${!currentSgcSub?'active':''}">
    <div class="subcampo-card-inner" onclick="selectSgcSub(null)">
      <div class="subcampo-icon" style="${!currentSgcSub?'background:var(--teal);color:#fff':''}">${svgAll}</div>
      <div class="subcampo-card-info"><div class="subcampo-card-label">Todos los documentos</div><div class="subcampo-card-count">${cnt} documento${cnt!==1?'s':''}</div></div>
    </div>
  </div>`;
  list.forEach((sc, i) => {
    const isActive = currentSgcSub === sc.firestoreId;
    const docCnt   = allSgcDocs.filter(d => d.section === sc.firestoreId).length;
    html += buildCardHtml(sc, isActive, docCnt, 'sgc');
  });
  html += `<div class="subcampo-card add-card" onclick="openSubcampoModal('sgc')">${svgPlus}<span>Nueva tarjeta</span></div>`;
  grid.innerHTML = html;

  safeSet("sgc-cards-count", `${list.length} tarjeta${list.length!==1?'s':''}`);
}

window.selectSgcSub = async (key, label) => {
  currentSgcSub = key;
  currentNodeSubitem = null;
  currentNodeSubitemParent = null;
  const cardsView  = g("sgc-cards-view");
  const detailView = g("sgc-detail-view");
  const subPanel   = g("sgc-subitems-panel");

  if (key) {
    cardsView?.classList.add("hidden");
    detailView?.classList.remove("hidden");
    currentActiveDocSection = key;

    safeSet("sgc-detail-title", label || key);
    safeSet("sgc-add-label",   "Agregar documento");
    updateSgcHeaderBreadcrumb(currentSgcParent, label, null);

    // Hide legacy subitems panel
    subPanel?.classList.add("hidden");

    // Show subitem cards above the doc table
    await renderSubitemCards(key, "sgc-subitem-cards", "sgc");

    // Load docs for this subcampo
    await loadDocsForSection(key);
  } else {
    cardsView?.classList.remove("hidden");
    detailView?.classList.add("hidden");
    currentActiveDocSection = currentSgcParent;
    currentNodeSubitem = null;
    safeSet("sgc-add-label", "Agregar documento");
    subPanel?.classList.add("hidden");
    g("sgc-subitem-cards")?.classList.add("hidden");
    updateSgcHeaderBreadcrumb(currentSgcParent, null, null);
  }
  renderSgcSubcategoryGrid();
  await loadSgcDocs();
};
window.clearSubSelection = async () => selectSgcSub(null);

// ── Subcampo modal ──
// ═══════════════════════════════════════════════════════
//  SUBITEM CARDS — shown above the doc module
//  Clicking a subitem card changes the doc context (section key = node.fid)
// ═══════════════════════════════════════════════════════

function updateDocHeaderBreadcrumb(section, tarjeta, subitem) {
  if (subitem) {
    safeSet("doc-detail-breadcrumb", tarjeta ? `${section} / ${tarjeta}` : section);
    safeSet("doc-detail-title", subitem);
  } else if (tarjeta) {
    safeSet("doc-detail-breadcrumb", section);
    safeSet("doc-detail-title", tarjeta);
  }
  const parts = [section, tarjeta, subitem].filter(Boolean);
  setBreadcrumb(parts.join(" / "));
}

function updateSgcHeaderBreadcrumb(parent, tarjeta, subitem) {
  // Left panel: small label above the title
  safeSet("sgc-tree-breadcrumb", "Sist Gestión de calidad");

  // Right panel detail view
  if (subitem) {
    // SGC / Parent / Tarjeta / Subítem
    safeSet("sgc-detail-breadcrumb", tarjeta ? `${parent} / ${tarjeta}` : parent);
    safeSet("sgc-detail-title", subitem);
  } else if (tarjeta) {
    // SGC / Parent / Tarjeta
    safeSet("sgc-detail-breadcrumb", parent || "Sist Gestión de calidad");
    safeSet("sgc-detail-title", tarjeta);
  }

  // Top breadcrumb bar
  const parts = ["SGC", parent, tarjeta, subitem].filter(Boolean);
  setBreadcrumb(parts.join(" / "));
}

// Render subitem nodes as mini-cards above the doc table
async function renderSubitemCards(subcampoId, containerId, context) {
  const container = g(containerId);
  if (!container) return;

  container.innerHTML = '<div class="sic-loading">Cargando subítems...</div>';
  container.classList.remove("hidden");

  const nodes = await loadNodesForSubcampo(subcampoId);
  const level0 = nodes.filter(n => n.level === 0);

  if (!level0.length) {
    container.innerHTML = buildSubitemCardBar(subcampoId, [], context);
    return;
  }
  container.innerHTML = buildSubitemCardBar(subcampoId, level0, context);
}

function buildSubitemCardBar(subcampoId, nodes, context) {
  const isDoc = context === 'doc';
  const addCall = `openNodeCreate('${subcampoId}','${subcampoId}','','${context}',0)`;

  let html = `<div class="sic-bar">
    <div class="sic-bar-header">
      <span class="sic-bar-title">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Subítems
      </span>
      <button class="sic-add-btn" onclick="${addCall}">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        Nuevo subítem
      </button>
    </div>`;

  if (!nodes.length) {
    html += `<div class="sic-empty">Sin subítems aún. Crea el primero.</div>`;
  } else {
    html += `<div class="sic-grid">`;
    nodes.forEach((node, i) => {
      const isActive   = currentNodeSubitem && currentNodeSubitem.fid === node.fid;
      const selectCall = `selectNodeSubitem('${node.fid}','${esc(node.name)}','${subcampoId}','${context}')`;
      const editCall   = `event.stopPropagation();showRenameForm('${node.fid}','${esc(node.name)}','${subcampoId}','${context}')`;
      const delCall    = `event.stopPropagation();deleteNodeSubitem('${node.fid}','${subcampoId}','${context}')`;
      html += `
        <div class="sic-card ${isActive ? 'active' : ''}" onclick="${selectCall}" id="sic-card-${node.fid}">
          <div class="sic-card-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div>
          <div class="sic-card-name" id="sic-name-${node.fid}">${esc2(node.name)}</div>
          <div class="sic-card-actions">
            <button class="sic-action-btn sic-edit" onclick="${editCall}" title="Editar nombre">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
            <button class="sic-action-btn sic-del" onclick="${delCall}" title="Eliminar subítem">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </button>
          </div>
        </div>`;
    });
    html += `</div>`;
  }
  html += `</div>`;
  return html;
}

// Called when user clicks a subitem card
window.selectNodeSubitem = async (nodeFid, nodeName, subcampoId, context) => {
  currentNodeSubitem = { fid: nodeFid, name: nodeName };
  currentNodeSubitemParent = subcampoId;
  currentActiveDocSection = nodeFid;

  // Update breadcrumb
  if (context === 'sgc') {
    const tarjetaName = (subcampoCache[`sgc::${currentSgcParent}`] || []).find(s=>s.firestoreId===subcampoId)?.name || subcampoId;
    updateSgcHeaderBreadcrumb(currentSgcParent, tarjetaName, nodeName);
    safeSet("sgc-add-label", "Agregar documento");
  } else {
    const tarjetaName = (subcampoCache[currentSection] || []).find(s=>s.firestoreId===subcampoId)?.name || subcampoId;
    updateDocHeaderBreadcrumb(currentSection, tarjetaName, nodeName);
    safeSet("doc-add-label", "Agregar documento");
  }

  // Re-render subitem cards to show which one is active
  const containerId = context === 'sgc' ? 'sgc-subitem-cards' : 'doc-subitem-cards';
  const container = g(containerId);
  const nodes = _nodeCache[subcampoId] || [];
  if (container) container.innerHTML = buildSubitemCardBar(subcampoId, nodes.filter(n=>n.level===0), context);

  // Load docs for this node (using node.fid as section key)
  await loadDocsForSection(nodeFid);
};

// Delete a subitem node
window.deleteNodeSubitem = async (nodeFid, subcampoId, context) => {
  if (!confirm("¿Eliminar este subítem y todos sus documentos?")) return;
  try {
    await deleteDoc(doc(db, 'nodes', nodeFid));
    if (_nodeCache[subcampoId]) {
      _nodeCache[subcampoId] = _nodeCache[subcampoId].filter(n => n.fid !== nodeFid);
    }
    if (currentNodeSubitem?.fid === nodeFid) {
      currentNodeSubitem = null;
      currentNodeSubitemParent = null;
      currentActiveDocSection = subcampoId;
      if (context === 'sgc') {
        const lbl = (subcampoCache[`sgc::${currentSgcParent}`]||[]).find(s=>s.firestoreId===subcampoId)?.name||'';
        updateSgcHeaderBreadcrumb(currentSgcParent, lbl, null);
        await loadDocsForSection(subcampoId);
      } else {
        const lbl = (subcampoCache[currentSection]||[]).find(s=>s.firestoreId===subcampoId)?.name||'';
        updateDocHeaderBreadcrumb(currentSection, lbl, null);
        await loadDocsForSection(subcampoId);
      }
    }
    const containerId = context === 'sgc' ? 'sgc-subitem-cards' : 'doc-subitem-cards';
    const container = g(containerId);
    const nodes = (_nodeCache[subcampoId]||[]).filter(n=>n.level===0);
    if (container) container.innerHTML = buildSubitemCardBar(subcampoId, nodes, context);
    showToast("Subítem eliminado", "info");
  } catch(e) { showToast("Error al eliminar: " + e.message, "error"); }
};

// Show inline rename form inside the card (replaces name with input)
// ── Rename subitem via modal ──
let _renameNodeCtx = null;

window.showRenameForm = (nodeFid, currentName, subcampoId, context) => {
  _renameNodeCtx = { nodeFid, subcampoId, context, originalName: currentName };
  const input = g('rename-node-input');
  if (input) input.value = currentName;
  g('rename-node-overlay').classList.remove('hidden');
  setTimeout(() => { if(input){ input.focus(); input.select(); } }, 40);
};
window.closeRenameNode = () => g('rename-node-overlay').classList.add('hidden');
window.closeRenameNodeOutside = (e) => { if (e.target.id === 'rename-node-overlay') closeRenameNode(); };

window.saveRenameNode = async () => {
  if (!_renameNodeCtx) return;
  const { nodeFid, subcampoId, context } = _renameNodeCtx;
  const newName = (g('rename-node-input')?.value || '').trim();
  if (!newName) { showToast('Ingresa un nombre.', 'error'); return; }
  const btn = g('rename-node-save-btn'); setLoading(btn, true);
  try {
    await updateDoc(doc(db, 'nodes', nodeFid), { name: newName });
    if (_nodeCache[subcampoId]) {
      const n = _nodeCache[subcampoId].find(x => x.fid === nodeFid);
      if (n) n.name = newName;
    }
    if (currentNodeSubitem?.fid === nodeFid) {
      currentNodeSubitem.name = newName;
      if (context === 'sgc') {
        const tarjeta = (subcampoCache[`sgc::${currentSgcParent}`]||[]).find(s=>s.firestoreId===subcampoId)?.name||'';
        updateSgcHeaderBreadcrumb(currentSgcParent, tarjeta, newName);
      } else {
        const tarjeta = (subcampoCache[currentSection]||[]).find(s=>s.firestoreId===subcampoId)?.name||'';
        updateDocHeaderBreadcrumb(currentSection, tarjeta, newName);
      }
    }
    const containerId = context === 'sgc' ? 'sgc-subitem-cards' : 'doc-subitem-cards';
    const container = g(containerId);
    const nodes = (_nodeCache[subcampoId]||[]).filter(n=>n.level===0);
    if (container) container.innerHTML = buildSubitemCardBar(subcampoId, nodes, context);
    closeRenameNode();
    showToast('Subítem renombrado', 'success');
  } catch(e) { showToast("Error: " + e.message, "error"); }
  finally { setLoading(btn, false); }
};

// ── Subcampo modal state ──
let subcampoContext    = 'doc'; // 'doc' or 'sgc'
let subcampoEditingId  = null;  // firestoreId when editing, null when creating

// Open to CREATE a new subcampo
window.openSubcampoModal = (ctx = 'doc') => {
  subcampoContext   = ctx;
  subcampoEditingId = null;
  const cSection = ctx === 'sgc' ? currentSgcParent : currentSection;
  // Suggest next order number
  const sectionKey = ctx === 'sgc' ? `sgc::${currentSgcParent}` : currentSection;
  const existing   = subcampoCache[sectionKey] || [];
  const nextOrder  = existing.length + 1;

  safeSet("subcampo-modal-title", "Crear subcampo");
  safeSet("subcampo-modal-ctx",   `Nuevo subcampo en: ${cSection}`);
  safeSet("subcampo-save-label",  "Crear subcampo");
  setVal("subcampo-name",  "");
  setVal("subcampo-desc",  "");
  setVal("subcampo-order", nextOrder);
  g("subcampo-modal-overlay").classList.remove("hidden");
  setTimeout(() => g("subcampo-name")?.focus(), 80);
};

// Open to EDIT an existing subcampo
window.editSubcampo = (firestoreId, ctx) => {
  subcampoContext   = ctx;
  subcampoEditingId = firestoreId;
  const sectionKey  = ctx === 'sgc' ? `sgc::${currentSgcParent}` : currentSection;
  const sc          = (subcampoCache[sectionKey] || []).find(s => s.firestoreId === firestoreId);
  if (!sc) return;

  safeSet("subcampo-modal-title", "Editar subcampo");
  safeSet("subcampo-modal-ctx",   `Editando: ${sc.name}`);
  safeSet("subcampo-save-label",  "Guardar cambios");
  setVal("subcampo-name",  sc.name  || "");
  setVal("subcampo-desc",  sc.desc  || "");
  setVal("subcampo-order", sc.order ?? "");
  g("subcampo-modal-overlay").classList.remove("hidden");
  setTimeout(() => g("subcampo-name")?.focus(), 80);
};

window.closeSubcampoModal = () => {
  g("subcampo-modal-overlay").classList.add("hidden");
  subcampoEditingId = null;
};
window.closeSubcampoModalOutside = (e) => {
  if (e.target.id === "subcampo-modal-overlay") closeSubcampoModal();
};

window.saveSubcampo = async () => {
  const name  = val("subcampo-name");
  const desc  = val("subcampo-desc");
  const orderRaw = g("subcampo-order")?.value.trim();
  const order = orderRaw !== "" ? parseInt(orderRaw) : null;

  if (!name) { showToast("Ingresa un nombre para el subcampo.", "error"); return; }

  const btn = g("subcampo-save-btn"); setLoading(btn, true);
  const sectionKey = subcampoContext === 'sgc' ? `sgc::${currentSgcParent}` : currentSection;

  try {
    if (subcampoEditingId) {
      // ── EDIT existing ──
      await updateDoc(doc(db, "subcampos", subcampoEditingId), { name, desc, order: order ?? null, updatedAt: serverTimestamp() });
      const cache = subcampoCache[sectionKey] || [];
      const item  = cache.find(s => s.firestoreId === subcampoEditingId);
      if (item) { item.name = name; item.desc = desc; item.order = order ?? null; }
      closeSubcampoModal();
      showToast(`Subcampo "${name}" actualizado`, "success");
    } else {
      // ── CREATE new ──
      const ref = await addDoc(collection(db, "subcampos"), { section: sectionKey, name, desc, order: order ?? null, createdAt: serverTimestamp() });
      if (!subcampoCache[sectionKey]) subcampoCache[sectionKey] = [];
      subcampoCache[sectionKey].push({ firestoreId: ref.id, section: sectionKey, name, desc, order: order ?? null });
      closeSubcampoModal();
      showToast(`Subcampo "${name}" creado`, "success");
      // Auto-select the new card
      if (subcampoContext === 'sgc') await selectSgcSub(ref.id, name);
      else selectSubcampo(ref.id, name);
    }
    // Re-sort cache by order and re-render
    sortSubcampoCache(sectionKey);
    if (subcampoContext === 'sgc') renderSgcSubcategoryGrid();
    else renderSubcampoGrid(currentSection);

  } catch(e) { showToast("Error: " + e.message, "error"); }
  finally { setLoading(btn, false); }
};

function sortSubcampoCache(sectionKey) {
  if (!subcampoCache[sectionKey]) return;
  subcampoCache[sectionKey].sort((a, b) => {
    const ao = a.order ?? 9999;
    const bo = b.order ?? 9999;
    return ao !== bo ? ao - bo : (a.name || "").localeCompare(b.name || "");
  });
}

window.deleteSubcampo = async (firestoreId, ctx) => {
  if (!confirm("¿Eliminar este subcampo? Los documentos dentro quedarán en 'Todos'.")) return;
  try {
    await deleteDoc(doc(db, "subcampos", firestoreId));
    for (const k in subcampoCache) {
      subcampoCache[k] = subcampoCache[k].filter(s => s.firestoreId !== firestoreId);
    }
    if (ctx === 'sgc') {
      if (currentSgcSub === firestoreId) await selectSgcSub(null);
      else renderSgcSubcategoryGrid();
    } else {
      if (currentDocSubcampo === firestoreId) selectSubcampo(null);
      else renderSubcampoGrid(currentSection);
    }
    showToast("Subcampo eliminado", "info");
  } catch(e) { showToast("Error al eliminar", "error"); }
};

// ═══════════════════════════════════════════════════════
//  DOCUMENTS CRUD
// ═══════════════════════════════════════════════════════

// Image upload — label-based, no JS trigger needed
window.onImageSelected = (input) => {
  const file=input.files[0]; if(!file) return;
  if(file.size>5*1024*1024){showToast("El archivo es mayor a 5MB.","error");return;}
  const reader=new FileReader();
  reader.onload=(e)=>{
    pendingImageData={data:e.target.result,type:file.type,name:file.name};
    const preview=g("modal-img-preview"), fname=g("modal-img-filename"), area=g("img-upload-area");
    if(file.type.startsWith("image/")){
      preview.src=e.target.result; preview.classList.add("visible");
    } else {
      preview.classList.remove("visible");
    }
    if(fname){fname.textContent=file.name;fname.style.display="block";}
    area?.classList.add("has-image");
  };
  reader.readAsDataURL(file);
};

window.openModal = (id) => {
  editingId=id||null;
  pendingImageData=null;
  safeSet("modal-title",id?"Editar documento":"Agregar documento");
  safeSet("modal-sub",id?"Actualiza la información":"Completa la información del documento");
  safeSet("modal-save-label",id?"Actualizar":"Guardar");
  // Reset image area
  const preview=g("modal-img-preview"),fname=g("modal-img-filename"),area=g("img-upload-area"),fi=g("modal-image-file");
  if(preview){preview.src="";preview.classList.remove("visible");}
  if(fname){fname.textContent="";fname.style.display="none";}
  if(area) area.classList.remove("has-image");
  if(fi)   fi.value="";

  if(id){
    const list=currentSgcParent?allSgcDocs:allDocs;
    const d=list.find(x=>x.id===id);
    if(d){
      setVal("modal-nombre",d.nombre||""); setVal("modal-link",d.link||"");
      setVal("modal-estado",d.estado||"Completo"); setVal("modal-fecha",d.fecha||"");
      setVal("modal-obs",d.obs||"");
      // Show existing image
      if(d.imageData){
        pendingImageData={data:d.imageData,type:d.imageType||"image/jpeg",name:d.imageName||"imagen"};
        if(d.imageType?.startsWith("image/")){
          if(preview){preview.src=d.imageData;preview.classList.add("visible");}
        }
        if(fname){fname.textContent=d.imageName||"archivo adjunto";fname.style.display="block";}
        area?.classList.add("has-image");
      }
    }
  } else {
    ["modal-nombre","modal-link","modal-fecha","modal-obs"].forEach(i=>setVal(i,""));
    setVal("modal-estado","Completo");
  }
  g("modal-overlay").classList.remove("hidden");
};
window.closeModal = () => { g("modal-overlay").classList.add("hidden"); editingId=null; pendingImageData=null; };
window.closeModalOutside = (e) => { if(e.target.id==="modal-overlay") closeModal(); };

window.saveDocument = async () => {
  const nombre=val("modal-nombre"),link=val("modal-link"),estado=val("modal-estado"),
        fecha=val("modal-fecha"),obs=val("modal-obs");
  if(!nombre){showToast("El nombre del documento es requerido.","error");return;}
  const btn=g("modal-overlay").querySelector(".btn-cta.sm"); setLoading(btn,true);

  // Use the active doc section — works for section, subcampo, sgc-sub, or node subitem
  const sectionKey = currentActiveDocSection || currentSgcSub || (currentSgcParent ? currentSgcParent : (currentDocSubcampo||currentSection));
  const data={nombre,link,estado,fecha,obs,section:sectionKey,uid:currentUser.uid,updatedAt:serverTimestamp()};
  if(pendingImageData){data.imageData=pendingImageData.data;data.imageType=pendingImageData.type;data.imageName=pendingImageData.name;}
  else if(!editingId){data.imageData=null;}

  try{
    if(editingId){await updateDoc(doc(db,"documents",editingId),data);showToast("Documento actualizado","success");}
    else{data.createdAt=serverTimestamp();await addDoc(collection(db,"documents"),data);addActivity(`Documento guardado: ${nombre}`);showToast("Documento guardado","success");}
    closeModal();
    await reloadActiveDocContext();
    await loadDashboardStats();
  }catch(e){showToast("Error al guardar: "+e.message,"error");}
  finally{setLoading(btn,false);}
};

window.deleteDocument = async (id) => {
  if(!confirm("¿Eliminar este documento?")) return;
  try{
    await deleteDoc(doc(db,"documents",id));
    showToast("Documento eliminado","info");
    await reloadActiveDocContext();
    await loadDashboardStats();
  }catch(e){showToast("Error al eliminar","error");}
};

// Reload whatever doc context is currently active
async function reloadActiveDocContext() {
  if (currentNodeSubitem) {
    await loadDocsForSection(currentNodeSubitem.fid);
  } else if (currentSgcParent) {
    await loadSgcDocs();
  } else {
    await loadDocuments();
    // Also refresh direct table if visible
    const directWrap = g("doc-direct-wrap");
    if (directWrap && !directWrap.classList.contains("hidden")) {
      renderTableBody(allDocs, "doc-direct-tbody");
      renderStatsStrip(allDocs, "doc-direct-stats");
    }
  }
}

// Universal: load docs for ANY section key and render to the active table
async function loadDocsForSection(sectionKey) {
  if (!currentUser) return;
  currentActiveDocSection = sectionKey;
  const q = query(collection(db,"documents"), where("uid","==",currentUser.uid), where("section","==",sectionKey));
  const snap = await getDocs(q);
  const docs = snap.docs.map(d=>({id:d.id,...d.data()}));

  // Render into whichever table is currently visible
  const tbodyId = currentSgcParent ? "sgc-doc-tbody" : "doc-tbody";
  const statsId = currentSgcParent ? "sgc-stats-strip" : "doc-stats-strip";
  renderTableBody(docs, tbodyId);
  renderStatsStrip(docs, statsId);
  if (currentSgcParent) allSgcDocs = docs;
  else allDocs = docs;
  return docs;
}

async function loadDocuments() {
  if(!currentUser||!currentSection) return;
  await loadDocSubcamposFromFirestore(currentSection);
  currentActiveDocSection = currentSection;
  currentNodeSubitem = null;
  currentNodeSubitemParent = null;
  const q=query(collection(db,"documents"),where("uid","==",currentUser.uid),where("section","==",currentSection));
  const snap=await getDocs(q);
  allDocs=snap.docs.map(d=>({id:d.id,...d.data()}));
  renderSubcampoGrid(currentSection);
  renderFilteredDocTable();
  renderStatsStrip(allDocs,"doc-stats-strip");

  // KEY FIX: if no subcampos exist, show doc table directly in the cards view
  const hasCards = (getSubcampos(currentSection)||[]).length > 0;
  const directWrap = g("doc-direct-wrap");
  if (directWrap) {
    if (!hasCards) {
      directWrap.classList.remove("hidden");
      renderTableBody(allDocs, "doc-direct-tbody");
      renderStatsStrip(allDocs, "doc-direct-stats");
    } else {
      directWrap.classList.add("hidden");
    }
  }
}

function renderFilteredDocTable() {
  let docs=allDocs;
  if(currentDocSubcampo) docs=allDocs.filter(d=>d.subcampo===currentDocSubcampo);
  renderTableBody(docs,"doc-tbody");
  // Also refresh direct table if visible
  const directWrap = g("doc-direct-wrap");
  if (directWrap && !directWrap.classList.contains("hidden")) {
    renderTableBody(allDocs,"doc-direct-tbody");
    renderStatsStrip(allDocs,"doc-direct-stats");
  }
}

// Filter the direct (no-cards) table — called from its search/select inputs
window.filterDirectTable = (search) => {
  const ef = g("doc-direct-estado")?.value || "";
  let f = allDocs;
  if(search){const q=search.toLowerCase();f=f.filter(d=>(d.nombre||"").toLowerCase().includes(q)||(d.obs||"").toLowerCase().includes(q));}
  if(ef) f=f.filter(d=>d.estado===ef);
  renderTableBody(f,"doc-direct-tbody");
};

async function loadSgcDocs() {
  if(!currentUser) return;
  currentNodeSubitem = null;
  currentNodeSubitemParent = null;
  const key=`sgc::${currentSgcParent}`;
  if(currentSgcSub){
    currentActiveDocSection = currentSgcSub;
    const q=query(collection(db,"documents"),where("uid","==",currentUser.uid),where("section","==",currentSgcSub));
    const snap=await getDocs(q);
    allSgcDocs=snap.docs.map(d=>({id:d.id,...d.data()}));
    currentSection=currentSgcSub;
  } else {
    const ids=[currentSgcParent,...(subcampoCache[key]||[]).map(s=>s.firestoreId)];
    let merged=[];
    for(const id of ids){
      const q=query(collection(db,"documents"),where("uid","==",currentUser.uid),where("section","==",id));
      const snap=await getDocs(q);
      snap.docs.forEach(d=>{if(!merged.find(x=>x.id===d.id))merged.push({id:d.id,...d.data()});});
    }
    allSgcDocs=merged;
    currentSection=currentSgcParent;
    currentActiveDocSection = currentSgcParent;
  }
  renderTableBody(allSgcDocs,"sgc-doc-tbody");
  renderStatsStrip(allSgcDocs,"sgc-stats-strip");
  renderSgcSubcategoryGrid();
}

function renderTableBody(docs, tbodyId) {
  const tbody=g(tbodyId); if(!tbody) return;
  if(!docs.length){
    tbody.innerHTML=`<tr><td colspan="5" class="table-empty-row"><div class="empty-state"><p>No hay documentos guardados.</p><button class="btn-ghost-sm" onclick="openModal()">+ Agregar el primero</button></div></td></tr>`;
    return;
  }
  tbody.innerHTML=docs.map((d,i)=>{
    const hasImg=d.imageData&&d.imageType?.startsWith("image/");
    const hasPdf=d.imageData&&d.imageType==="application/pdf";
    const viewBtns=(d.link?`<button class="view-file-btn" onclick="openViewer('${d.link}','${esc(d.nombre)}','link')">&#128196; Ver doc</button>`:"")
      +(hasImg?`<button class="view-file-btn img-btn" onclick="openViewer(null,'${esc(d.nombre)}','img','${i}')">&#128444; Ver imagen</button>`:"")
      +(hasPdf?`<button class="view-file-btn" onclick="openViewer(null,'${esc(d.nombre)}','pdf','${i}')">&#128196; Ver PDF</button>`:"");
    // Store doc index for image retrieval
    return `<tr data-doc-idx="${i}" style="animation:ai .2s ${i*35}ms var(--ease) backwards">
      <td><span class="doc-name">${d.nombre}</span><br>${viewBtns}</td>
      <td><span class="status-badge ${badgeClass(d.estado)}">${d.estado}</span></td>
      <td style="color:var(--text-2)">${d.fecha?formatDate(d.fecha):"—"}</td>
      <td style="color:var(--text-3);font-size:.79rem;max-width:180px">${d.obs||"—"}</td>
      <td><div class="row-actions">
        <button class="row-action-btn edit" onclick="openModal('${d.id}')" title="Editar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="row-action-btn del" onclick="deleteDocument('${d.id}')" title="Eliminar"><svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="3 6 5 6 21 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div></td>
    </tr>`;
  }).join("");
  // Store docs in a global lookup for image retrieval by index
  window._tableDocsList = docs;
}

window.filterTable = (search) => {
  const ef=val("filter-estado"); let f=allDocs;
  if(search){const q=search.toLowerCase();f=f.filter(d=>(d.nombre||"").toLowerCase().includes(q)||(d.obs||"").toLowerCase().includes(q));}
  if(ef) f=f.filter(d=>d.estado===ef);
  if(currentDocSubcampo) f=f.filter(d=>d.subcampo===currentDocSubcampo);
  renderTableBody(f,"doc-tbody");
};

window.filterSgcTable = (search) => {
  const ef=val("sgc-filter-estado"); let f=allSgcDocs;
  if(search){const q=search.toLowerCase();f=f.filter(d=>(d.nombre||"").toLowerCase().includes(q)||(d.obs||"").toLowerCase().includes(q));}
  if(ef) f=f.filter(d=>d.estado===ef);
  renderTableBody(f,"sgc-doc-tbody");
};

function renderStatsStrip(docs, stripId) {
  const strip=g(stripId); if(!strip) return;
  const t=docs.length,c=docs.filter(d=>d.estado==="Completo").length,
        p=docs.filter(d=>d.estado==="Pendiente").length,
        px=docs.filter(d=>d.estado==="Próximo a vencer").length,
        v=docs.filter(d=>d.estado==="Vencido").length;

  const chip = (estado, count, color, label) =>
    `<div class="stat-chip" onclick="applyStatFilter('${stripId}','${estado}')" data-filter="${estado}"><span class="stat-chip-dot" style="background:${color}"></span>${count} ${label}</div>`;

  strip.innerHTML =
    chip("", t, "var(--text-3)", "total") +
    chip("Completo", c, "var(--green)", c!==1?"completos":"completo") +
    (p ? chip("Pendiente", p, "var(--amber)", p!==1?"pendientes":"pendiente") : "") +
    (px ? chip("Próximo a vencer", px, "#eab308", px!==1?"próximos a vencer":"próximo a vencer") : "") +
    (v ? chip("Vencido", v, "var(--rose)", v!==1?"vencidos":"vencido") : "");

  // Mark "total" active by default and store the docs for filtering
  strip._allDocs = docs;
  const totalChip = strip.querySelector('.stat-chip[data-filter=""]');
  if (totalChip) totalChip.classList.add('active');
}

// Single global handler for all stat strips
window.applyStatFilter = (stripId, estado) => {
  const strip = g(stripId); if (!strip) return;
  strip.querySelectorAll('.stat-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.filter === estado);
  });
  const docs = strip._allDocs || [];
  const filtered = estado ? docs.filter(d => d.estado === estado) : docs;
  const tbodyId = stripId === 'doc-direct-stats' ? 'doc-direct-tbody'
                : stripId === 'sgc-stats-strip'  ? 'sgc-doc-tbody'
                : 'doc-tbody';
  renderTableBody(filtered, tbodyId);
};

function badgeClass(e){return{Completo:"badge-green",Pendiente:"badge-amber","Próximo a vencer":"badge-yellow",Vencido:"badge-rose"}[e]||"";}

// ═══════════════════════════════════════════════════════
//  FILE VIEWER
// ═══════════════════════════════════════════════════════
window.openViewer = (url, name, type, idx) => {
  const viewer=g("file-viewer"), body=g("viewer-body"), fname=g("viewer-filename");
  if(!viewer||!body) return;
  fname.textContent=name||"Documento";
  body.innerHTML='<div class="viewer-loading">Cargando...</div>';
  viewer.classList.remove("hidden");
  _viewerCurrentSrc = null;

  if(type==="link"&&url){
    let embedUrl=url;
    if(url.includes("drive.google.com/file/d/")){
      const match=url.match(/\/d\/(.*?)\//);
      if(match) embedUrl=`https://drive.google.com/file/d/${match[1]}/preview`;
    }
    _viewerCurrentSrc = { type:'url', value:url };
    body.innerHTML=`<iframe src="${embedUrl}" allow="autoplay" style="width:100%;height:80vh;border:none"></iframe>`;
  } else if(type==="img"||type==="pdf"){
    const docItem=window._tableDocsList?.[parseInt(idx)];
    if(docItem?.imageData){
      _viewerCurrentSrc = { type:'base64', value:docItem.imageData, mime:docItem.imageType };
      if(type==="img"){
        body.innerHTML=`<img src="${docItem.imageData}" alt="${name}" style="max-width:100%;max-height:80vh;object-fit:contain"/>`;
      } else {
        body.innerHTML=`<embed src="${docItem.imageData}" type="application/pdf" style="width:100%;height:80vh"/>`;
      }
    } else {
      body.innerHTML='<div class="viewer-loading">No se pudo cargar el archivo.</div>';
    }
  }
};

// Track what's currently loaded in the viewer so we can open it in a new window
let _viewerCurrentSrc = null; // { type: 'url'|'base64', value, mime }

window.closeViewer = () => {
  const viewer=g("file-viewer"); if(viewer){viewer.classList.add("hidden");g("viewer-body").innerHTML="";}
  _viewerCurrentSrc = null;
};
window.closeViewerOutside = (e) => { if(e.target.id==="file-viewer") closeViewer(); };

window.openViewerInWindow = () => {
  if (!_viewerCurrentSrc) return;
  if (_viewerCurrentSrc.type === 'url') {
    window.open(_viewerCurrentSrc.value, '_blank');
  } else if (_viewerCurrentSrc.type === 'base64') {
    // Convert base64 to blob and open as object URL
    try {
      const byteStr = atob(_viewerCurrentSrc.value.split(',')[1]);
      const ab = new ArrayBuffer(byteStr.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteStr.length; i++) ia[i] = byteStr.charCodeAt(i);
      const blob = new Blob([ab], { type: _viewerCurrentSrc.mime });
      const url  = URL.createObjectURL(blob);
      window.open(url, '_blank');
    } catch(e) { showToast('No se pudo abrir en ventana', 'error'); }
  }
};

// ═══════════════════════════════════════════════════════
//  DASHBOARD STATS
// ═══════════════════════════════════════════════════════
async function loadDashboardStats() {
  if(!currentUser) return;
  const snap=await getDocs(query(collection(db,"documents"),where("uid","==",currentUser.uid)));
  const docs=snap.docs.map(d=>d.data());

  // ── Overall stats (Sistema de Calidad = todos los documentos)
  const total=docs.length;
  const compl=docs.filter(d=>d.estado==="Completo").length;
  const pend=docs.filter(d=>d.estado==="Pendiente").length;
  const prox=docs.filter(d=>d.estado==="Próximo a vencer").length;
  const venc=docs.filter(d=>d.estado==="Vencido").length;
  const pct=total?Math.round(compl/total*100):0;
  const lbl=pct>=90?"Excelente":pct>=75?"Óptimo":pct>=60?"Bueno":"Regular";
  const sinActualizar=pend+prox+venc;

  // ── PGIRASA stats (solo documentos en sección PGIRS)
  const pgirsDocs=docs.filter(d=>d.section==="PGIRS");
  const pgirsTotal=pgirsDocs.length;
  const pgirsCompl=pgirsDocs.filter(d=>d.estado==="Completo").length;
  const pgirsPend=pgirsDocs.filter(d=>d.estado==="Pendiente").length;
  const pgirsProx=pgirsDocs.filter(d=>d.estado==="Próximo a vencer").length;
  const pgirsVenc=pgirsDocs.filter(d=>d.estado==="Vencido").length;
  const pgirsPct=pgirsTotal?Math.round(pgirsCompl/pgirsTotal*100):0;
  const pgirsLbl=pgirsPct>=90?"Excelente":pgirsPct>=75?"Óptimo":pgirsPct>=60?"Bueno":"Regular";
  const pgirsSinAct=pgirsPend+pgirsProx+pgirsVenc;

  // ── KPI cards
  animateValue("stat-sgc",0,pct,800,v=>v+"%");
  animateValue("stat-pgirasa",0,pgirsPct,900,v=>v+"%");
  animateValue("stat-vencidos",0,venc,600);
  animateValue("stat-pendientes",0,prox,700);
  safeSet("badge-sgc",total?`${total} doc${total!==1?"s":""} · ${sinActualizar} por actualizar`:lbl);
  safeSet("badge-pgirasa",pgirsTotal?`${pgirsTotal} doc${pgirsTotal!==1?"s":""} · ${pgirsSinAct} pendientes`:pgirsLbl);
  setTimeout(()=>{setWidth("fill-sgc",pct+"%");setWidth("fill-pgirasa",pgirsPct+"%");},100);

  // ── Semáforo normativo (barras de progreso)
  const semCumplen=compl,semAtencion=pend+prox,semCriticos=venc;
  const semBase=total||1;
  safeSet("sem-cumplen",semCumplen);
  safeSet("sem-atencion",semAtencion);
  safeSet("sem-criticos",semCriticos);
  safeSet("sem-total-val",total||"0");
  safeSet("sem-pct",total?pct+"%":"0%");
  safeSet("sem-v-pct-cumplen",total?Math.round(semCumplen/semBase*100)+"%":"0%");
  safeSet("sem-v-pct-atencion",total?Math.round(semAtencion/semBase*100)+"%":"0%");
  safeSet("sem-v-pct-criticos",total?Math.round(semCriticos/semBase*100)+"%":"0%");
  const semLabel=pct>=90?"Excelente":pct>=75?"Óptimo":pct>=50?"Atención":"Crítico";
  const semColor=pct>=75?"teal":pct>=50?"amber":"rose";
  const semBadge=g("sem-status-label");
  if(semBadge){semBadge.textContent=semLabel;semBadge.className="sem-badge-status "+semColor;}
  setTimeout(()=>{
    setWidth("sem-bar-cumplen",Math.round(semCumplen/semBase*100)+"%");
    setWidth("sem-bar-atencion",Math.round(semAtencion/semBase*100)+"%");
    setWidth("sem-bar-criticos",Math.round(semCriticos/semBase*100)+"%");
    const pctEl=g("sem-pct");
    if(pctEl) pctEl.className="sem-footer-val "+(pct>=75?"green":pct>=50?"":"rose");
  },200);

  // ── Estado de documentos (ring chart — r=62, circ≈390)
  const circ=390;
  safeSet("estado-total",total?`${total} total`:"—");
  safeSet("est-total-num",total||"—");
  safeSet("est-vigentes",compl);
  safeSet("est-prox",prox);
  safeSet("est-venc",venc);
  safeSet("est-pend",pend);
  const vigPct=total?Math.round(compl/total*100):0;
  setTimeout(()=>{
    const arc=g("est-arc-vigentes");
    if(arc){arc.style.strokeDashoffset=String(circ-Math.round(vigPct/100*circ));}
  },350);

  const nc=g("notif-count"); const alertCount=venc+prox+pend;
  if(nc){nc.textContent=alertCount>0?alertCount:"";nc.classList.toggle("visible",alertCount>0);}
  renderDashAlerts(docs); renderActivity(); renderNotifDropdown(docs);
}

function renderDashAlerts(docs) {
  const al=g("alert-list"),ac=g("alerts-count");
  const alerts=docs.filter(d=>d.estado==="Vencido"||d.estado==="Próximo a vencer"||d.estado==="Pendiente");
  if(ac)ac.textContent=alerts.length?`${alerts.length} alerta${alerts.length!==1?'s':''}` :"Todo en orden";
  if(!al) return;
  if(!alerts.length){al.innerHTML=`<div class="empty-state"><p>Todo en orden ✓</p></div>`;return;}
  al.innerHTML=alerts.slice(0,6).map((d,i)=>{
    const cls=d.estado==="Vencido"?"rose":d.estado==="Próximo a vencer"?"amber":"blue";
    return `<div class="alert-row ${cls}" style="animation:ai .2s ${i*60}ms var(--ease) backwards"><div class="alert-indicator ${cls}"></div><div class="alert-content"><span class="alert-type">${d.estado}</span><span>${d.nombre}</span>${d.fecha?`<small>Vence: ${formatDate(d.fecha)}</small>`:""}</div></div>`;
  }).join("");
}

function renderNotifDropdown(docs) {
  const list=g("notif-dd-list"); if(!list) return;
  const alerts=docs.filter(d=>d.estado==="Vencido"||d.estado==="Próximo a vencer"||d.estado==="Pendiente");
  if(!alerts.length){list.innerHTML=`<div class="notif-empty">Sin notificaciones pendientes</div>`;return;}
  list.innerHTML=alerts.slice(0,8).map(d=>{
    const isV=d.estado==="Vencido",isP=d.estado==="Próximo a vencer";
    const cls=isV?"rose":isP?"amber":"blue";
    return `<div class="notif-row unread"><div class="notif-row-icon ${cls}"><svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></div><div class="notif-row-body"><div class="notif-row-title">${d.estado}</div><div class="notif-row-desc">${d.nombre}</div>${d.fecha?`<div class="notif-row-time">${formatDate(d.fecha)}</div>`:""}</div><div class="notif-row-dot"></div></div>`;
  }).join("");
}

window.markAllRead = () => {
  document.querySelectorAll(".notif-row.unread").forEach(r=>r.classList.remove("unread"));
  const nc=g("notif-count"); if(nc){nc.textContent="";nc.classList.remove("visible");}
};

function renderActivity() {
  if(!currentUser) return;
  const acts=JSON.parse(localStorage.getItem("fd_activity_"+currentUser.uid)||"[]");
  const al=g("activity-list"); if(!al) return;
  if(!acts.length){al.innerHTML=`<div class="empty-state"><p>Sin actividad reciente</p></div>`;return;}
  al.innerHTML=acts.slice(0,5).map((a,i)=>`<div class="activity-item" style="animation-delay:${i*45}ms"><div class="activity-dot"></div><div class="activity-info"><span>${a.text}</span><small>${a.time}</small></div></div>`).join("");
}

function addActivity(text) {
  if(!currentUser) return;
  const key="fd_activity_"+currentUser.uid;
  const acts=JSON.parse(localStorage.getItem(key)||"[]");
  acts.unshift({text,time:new Date().toLocaleString("es-CO")});
  localStorage.setItem(key,JSON.stringify(acts.slice(0,30)));
}

// ═══════════════════════════════════════════════════════
//  CALENDAR
// ═══════════════════════════════════════════════════════
window.calNav=(dir)=>{calDate.setMonth(calDate.getMonth()+dir);renderCalendar();};
function renderCalendar(){
  const months=["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const y=calDate.getFullYear(),m=calDate.getMonth(),fd=(new Date(y,m,1).getDay()+6)%7,dim=new Date(y,m+1,0).getDate(),today=new Date();
  safeSet("cal-label",`${months[m]} ${y}`);
  let html='<div class="cal-grid">';
  ["L","M","M","J","V","S","D"].forEach(h=>{html+=`<div class="cal-hdr">${h}</div>`;});
  for(let i=0;i<fd;i++) html+="<div></div>";
  for(let i=1;i<=dim;i++){const isT=i===today.getDate()&&m===today.getMonth()&&y===today.getFullYear();html+=`<div class="cal-day${isT?" today":""}">${i}</div>`;}
  html+="</div>"; g("calendar").innerHTML=html;
}

// ═══════════════════════════════════════════════════════
//  SIDEBAR
// ═══════════════════════════════════════════════════════
window.toggleSidebar=()=>{sidebarCollapsed=!sidebarCollapsed;g("sidebar").classList.toggle("collapsed",sidebarCollapsed);};
window.toggleMobileSidebar=()=>{g("sidebar").classList.add("mobile-open");g("mobile-overlay").classList.add("active");};
window.closeMobileSidebar=()=>{g("sidebar").classList.remove("mobile-open");g("mobile-overlay").classList.remove("active");};
window.toggleAccordion=(id)=>{const b=g(id);if(!b) return;const t=b.previousElementSibling;const o=b.classList.contains("open");b.classList.toggle("open",!o);if(t)t.classList.toggle("open",!o);};

// ═══════════════════════════════════════════════════════
//  DROPDOWNS
// ═══════════════════════════════════════════════════════
window.toggleNotifDropdown=()=>{const d=g("notif-dropdown"),t=g("notif-trigger"),isH=d.classList.contains("hidden");g("profile-dropdown").classList.add("hidden");g("profile-trigger").classList.remove("active");d.classList.toggle("hidden",!isH);t.classList.toggle("active",isH);};
window.toggleProfileDropdown=()=>{const d=g("profile-dropdown"),t=g("profile-trigger"),isH=d.classList.contains("hidden");g("notif-dropdown").classList.add("hidden");g("notif-trigger").classList.remove("active");d.classList.toggle("hidden",!isH);t.classList.toggle("active",isH);};
function closeProfileDropdown(){g("profile-dropdown")?.classList.add("hidden");g("profile-trigger")?.classList.remove("active");}

// ═══════════════════════════════════════════════════════
//  PROFILE MODAL
// ═══════════════════════════════════════════════════════
window.openProfileModal=(tab='info')=>{
  closeProfileDropdown();
  const d=currentUserData;
  const displayName=d._displayName||buildDisplayName(d);
  const initials=displayName!=="Usuario"?displayName.split(" ").map(w=>w[0]).slice(0,2).join("").toUpperCase():"FD";

  setVal("profile-name",d.name||"");
  setVal("profile-cedula",d.cedula||"");
  setVal("profile-telefono",d.telefono||"");
  setVal("profile-establecimiento",d.establecimiento||"");
  setVal("profile-nit",d.nit||"");
  setVal("profile-direccion",d.direccion||"");
  setVal("profile-role",d.role||"");
  // Show name (not email) as display header
  safeSet("profile-display-name",displayName);
  safeSet("profile-display-email",currentUser?.email||"—");
  safeSet("profile-big-avatar",initials);
  setVal("profile-new-pwd",""); setVal("profile-confirm-pwd","");
  safeSet("pwd-change-error","");
  switchProfileTab(tab);
  g("profile-modal-overlay").classList.remove("hidden");
};
window.closeProfileModal=()=>g("profile-modal-overlay").classList.add("hidden");
window.closeProfileOutside=(e)=>{if(e.target.id==="profile-modal-overlay")closeProfileModal();};
window.switchProfileTab=(tab)=>{
  profileTabActive=tab;
  ["info","password"].forEach(t=>{g(`tab-${t}`)?.classList.toggle("active",t===tab);g(`profile-tab-${t}`)?.classList.toggle("hidden",t!==tab);});
};

window.saveProfile=async()=>{
  if(!currentUser) return;
  const btn=g("profile-modal-overlay").querySelector(".btn-cta.sm"); setLoading(btn,true);
  try{
    if(profileTabActive==="info"){
      const newData={name:val("profile-name"),cedula:val("profile-cedula"),telefono:val("profile-telefono"),establecimiento:val("profile-establecimiento"),nit:val("profile-nit"),direccion:val("profile-direccion"),role:val("profile-role"),updatedAt:serverTimestamp()};
      if(currentUserDoc) await updateDoc(doc(db,"users",currentUserDoc),newData);
      else{const ref=await addDoc(collection(db,"users"),{...newData,uid:currentUser.uid,email:currentUser.email,createdAt:serverTimestamp()});currentUserDoc=ref.id;}
      currentUserData={...currentUserData,...newData};
      currentUserData._displayName=buildDisplayName(currentUserData);
      updateUIUser(currentUser,currentUserData);
      showToast("Perfil actualizado","success"); closeProfileModal();
    } else {
      const p1=val("profile-new-pwd"),p2=val("profile-confirm-pwd"),err=g("pwd-change-error"); err.textContent="";
      if(!p1||!p2){err.textContent="Completa ambos campos.";setLoading(btn,false);return;}
      if(p1!==p2){err.textContent="Las contraseñas no coinciden.";setLoading(btn,false);return;}
      if(p1.length<6){err.textContent="Mínimo 6 caracteres.";setLoading(btn,false);return;}
      await updatePassword(currentUser,p1);
      showToast("Contraseña actualizada","success"); closeProfileModal();
    }
  }catch(e){const err=g("pwd-change-error");if(err)err.textContent=friendlyError(e.code)||e.message;else showToast("Error: "+e.message,"error");}
  finally{setLoading(btn,false);}
};

// ═══════════════════════════════════════════════════════
//  UI HELPERS
// ═══════════════════════════════════════════════════════
function showApp(){g("auth-wrapper").classList.add("hidden");g("app-wrapper").classList.remove("hidden");}
function showAuth(){g("auth-wrapper").classList.remove("hidden");g("app-wrapper").classList.add("hidden");showPage("page-login");}
function showView(id){document.querySelectorAll(".view").forEach(v=>v.classList.remove("active"));g(id).classList.add("active");}
window.showPage=(id)=>{document.querySelectorAll(".auth-form-card").forEach(c=>c.classList.remove("active"));g(id).classList.add("active");};
window.togglePwd=(inputId,btn)=>{const inp=g(inputId);const isP=inp.type==="password";inp.type=isP?"text":"password";btn.querySelector(".eye-off")?.classList.toggle("hidden",isP);btn.querySelector(".eye-on")?.classList.toggle("hidden",!isP);};

window.showToast=(message,type="success")=>{
  const container=g("toast-container");
  const toast=document.createElement("div"); toast.className=`toast-item ${type}`;
  const icons={success:`<svg class="t-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><polyline points="22 4 12 14.01 9 11.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,error:`<svg class="t-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,info:`<svg class="t-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2"/><line x1="12" y1="16" x2="12" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="8" x2="12.01" y2="8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`};
  toast.innerHTML=`${icons[type]||icons.info}<span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(()=>{toast.style.animation="to-out .25s var(--ease) forwards";setTimeout(()=>toast.remove(),260);},3200);
};

function animateValue(id,start,end,duration,format=v=>v){
  const el=g(id); if(!el) return;
  const st=performance.now();
  const up=(now)=>{const p=Math.min((now-st)/duration,1),ep=1-Math.pow(1-p,3);el.textContent=format(Math.round(start+(end-start)*ep));if(p<1)requestAnimationFrame(up);};
  requestAnimationFrame(up);
}

function setLoading(btn,loading){if(!btn)return;btn.disabled=loading;btn.style.opacity=loading?".6":"1";}
function formatDate(s){if(!s)return"—";const[y,m,d]=s.split("-");return`${d}/${m}/${y}`;}
function setWidth(id,w){const el=g(id);if(el)el.style.width=w;}
function esc(s){return(s||"").replace(/'/g,"\\'").replace(/"/g,"&quot;");}
function friendlyError(code){const m={"auth/user-not-found":"Usuario no encontrado.","auth/wrong-password":"Contraseña incorrecta.","auth/invalid-credential":"Correo o contraseña incorrectos.","auth/email-already-in-use":"Este correo ya está registrado.","auth/invalid-email":"Correo inválido.","auth/weak-password":"Mínimo 6 caracteres.","auth/too-many-requests":"Demasiados intentos. Espera unos minutos.","auth/requires-recent-login":"Por seguridad vuelve a iniciar sesión para cambiar la contraseña."};return m[code]||"Ocurrió un error inesperado.";}
const g=(id)=>document.getElementById(id);
const val=(id)=>g(id)?.value.trim()||"";
const setVal=(id,v)=>{const el=g(id);if(el)el.value=v;};
const safeSet=(id,v)=>{const el=g(id);if(el)el.textContent=v;};

// ═══════════════════════════════════════════════════════
//  v11 — NODE HIERARCHY SYSTEM
//  nodes collection in Firestore (global, visible to all)
//  level: 0 = subitem (child of subcampo)
//         1 = sub-subitem (child of subitem)
//  Each node: { section, parentId, level, name, desc, order, createdAt }
//  node_docs: { nodeId, nombre, link, imageData, imageType, imageName, createdAt }
// ═══════════════════════════════════════════════════════

// ── State ─────────────────────────────────────────────
let _nodeCache    = {};     // { subcampoId: [ nodeObj ] }
let _nodeDocCache = {};     // { nodeId: [ docObj ] }
let _activeNodeCtx = null;  // { subcampoId, nodeId(optional), level, gridId, panelId }
let _ndocPendingImage = null;

// ── Load nodes (subitems + sub-subitems) for a subcampo ──
async function loadNodesForSubcampo(subcampoId) {
  const q = query(collection(db, 'nodes'), where('section', '==', subcampoId));
  const snap = await getDocs(q);
  const all = snap.docs.map(d => ({ fid: d.id, ...d.data() }));
  all.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  _nodeCache[subcampoId] = all;
  return all;
}

async function loadNodeDocs(nodeId) {
  const q = query(collection(db, 'node_docs'), where('nodeId', '==', nodeId));
  const snap = await getDocs(q);
  _nodeDocCache[nodeId] = snap.docs.map(d => ({ fid: d.id, ...d.data() }));
  return _nodeDocCache[nodeId];
}

// ── Load ALL nodes AND their docs for a subcampo (all levels) ──
async function loadAllNodesAndDocs(subcampoId) {
  const nodes = await loadNodesForSubcampo(subcampoId);
  // Load docs for EVERY node (level 0 AND level 1) — this was the persistence bug
  await Promise.all(nodes.map(n => loadNodeDocs(n.fid)));
  return nodes;
}

// ── Render subitems grid (called when a subcampo card is selected) ──
async function renderSubitemsGrid(subcampoId, gridId, context) {
  const grid = g(gridId); if (!grid) return;
  grid.innerHTML = '<div class="node-empty" style="padding:16px;color:var(--text-3)">Cargando...</div>';
  await loadAllNodesAndDocs(subcampoId);
  renderSubitemsList(subcampoId, gridId, context);
}

function renderSubitemsList(subcampoId, gridId, context) {
  const grid = g(gridId); if (!grid) return;
  const allNodes = _nodeCache[subcampoId] || [];
  const level0   = allNodes.filter(n => n.level === 0);

  if (!level0.length) {
    grid.innerHTML = '<div class="node-empty">No hay subítems aún. Crea el primero con el botón de arriba.</div>';
    return;
  }

  grid.innerHTML = level0.map((node, idx) => {
    const docs   = _nodeDocCache[node.fid] || [];
    const level1 = allNodes.filter(n => n.level === 1 && n.parentId === node.fid);
    // Pass gridId explicitly so buildSubitemCard can use it
    return buildSubitemCard(node, docs, level1, allNodes, subcampoId, context, gridId, idx, level0.length);
  }).join('');
}

function buildSubitemCard(node, docs, level1, allNodes, subcampoId, context, gridId, idx, total) {
  const svgFolder = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const svgChevron = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const docsHtml   = docs.map(d => buildNodeDocRow(d)).join('');
  const level1Html = level1.map(sub => {
    const subDocs = (_nodeDocCache[sub.fid] || []);
    return buildSubSubitemCard(sub, subDocs, subcampoId, gridId, context);
  }).join('');

  const orderVal   = node.order ?? idx;
  const totalFiles = docs.length;
  const totalSubs  = level1.length;

  return `
  <div class="si-card" data-node-id="${node.fid}" data-order="${orderVal}">

    <!-- ── Header (click to expand) ── -->
    <div class="si-card-header" onclick="toggleNodeCard(this.parentElement)">
      <div class="si-icon">${svgFolder}</div>
      <div class="si-info">
        <div class="si-name">${esc2(node.name)}</div>
        <div class="si-meta">${totalFiles} archivo${totalFiles!==1?'s':''} · ${totalSubs} sub-subítem${totalSubs!==1?'s':''}</div>
      </div>
      <div class="si-actions">
        <button class="si-btn si-btn-add" onclick="event.stopPropagation();openNodeDoc('${node.fid}','${subcampoId}','${gridId}','${context}')" title="Adjuntar archivo">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="si-btn si-btn-sub" onclick="event.stopPropagation();openNodeCreate('${node.fid}','${subcampoId}','${gridId}','${context}',1)" title="Nuevo sub-subítem">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
        </button>
        <button class="si-btn si-btn-order" onclick="event.stopPropagation();openOrderEdit('${node.fid}','${subcampoId}','${gridId}','${context}','${orderVal}')" title="Editar orden">
          #${orderVal + 1}
        </button>
        <button class="si-btn si-btn-del" onclick="event.stopPropagation();deleteNode('${node.fid}','${subcampoId}','${gridId}','${context}')" title="Eliminar">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <span class="si-chevron">${svgChevron}</span>
      </div>
    </div>

    <!-- ── Body (expandable) ── -->
    <div class="si-card-body">

      <!-- PRIMERO: Sub-subítems -->
      <div class="si-subsection">
        <div class="si-subsection-hdr">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Sub-subítems
          <button class="si-mini-add" onclick="openNodeCreate('${node.fid}','${subcampoId}','${gridId}','${context}',1)">+ Nuevo</button>
        </div>
        <div class="si-sub-list" id="ssi-${node.fid}">
          ${level1Html || '<div class="si-empty">Sin sub-subítems aún</div>'}
        </div>
      </div>

      <!-- DESPUÉS: Archivos adjuntos -->
      <div class="si-subsection si-docs-section">
        <div class="si-subsection-hdr">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
          Archivos adjuntos
          <button class="si-mini-add" onclick="openNodeDoc('${node.fid}','${subcampoId}','${gridId}','${context}')">+ Adjuntar</button>
        </div>
        <div class="si-docs-list" id="ndocs-${node.fid}">
          ${docsHtml || '<div class="si-empty">Sin archivos adjuntos</div>'}
        </div>
      </div>

    </div>
  </div>`;
}

function buildSubSubitemCard(sub, docs, subcampoId, gridId, context) {
  const svgChevron = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const docsHtml = docs.map(d => buildNodeDocRow(d)).join('');
  return `
  <div class="ssi-card" data-node-id="${sub.fid}">
    <div class="ssi-header" onclick="toggleNodeCard(this.parentElement)">
      <div class="ssi-icon">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>
      <div class="ssi-info">
        <span class="ssi-name">${esc2(sub.name)}</span>
        <span class="ssi-meta">${docs.length} archivo${docs.length!==1?'s':''}</span>
      </div>
      <div class="ssi-actions">
        <button class="si-btn si-btn-add" onclick="event.stopPropagation();openNodeDoc('${sub.fid}','${subcampoId}','${gridId}','${context}')" title="Adjuntar">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="si-btn si-btn-del" onclick="event.stopPropagation();deleteNode('${sub.fid}','${subcampoId}','${gridId}','${context}')" title="Eliminar">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
        <span class="ssi-chevron">${svgChevron}</span>
      </div>
    </div>
    <div class="ssi-body">
      <div id="ssi-docs-${sub.fid}">
        ${docsHtml || '<div class="si-empty">Sin archivos adjuntos</div>'}
      </div>
      <button class="si-attach-btn" onclick="openNodeDoc('${sub.fid}','${subcampoId}','${gridId}','${context}')">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Adjuntar archivo
      </button>
    </div>
  </div>`;
}

function buildNodeDocRow(d) {
  const isImg  = d.imageData && d.imageType?.startsWith('image/');
  const isPdf  = d.imageData && d.imageType === 'application/pdf';
  const isLink = !!d.link;
  const type   = isImg ? 'img' : isPdf ? 'pdf' : 'link';
  const typeLabel = isImg ? 'Imagen' : isPdf ? 'PDF' : 'Enlace';
  const icon = isImg
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="8.5" cy="8.5" r="1.5" fill="currentColor"/><polyline points="21 15 16 10 5 21" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : isPdf
    ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

  const viewCall = isImg
    ? `openNodeViewer('img','${d.fid}')`
    : isPdf
    ? `openNodeViewer('pdf','${d.fid}')`
    : `openNodeViewer('link','${d.fid}')`;

  return `
  <div class="node-doc-row" data-ndoc-id="${d.fid}">
    <div class="node-doc-icon ${type}">${icon}</div>
    <div class="node-doc-info">
      <div class="node-doc-name">${esc2(d.nombre)}</div>
      <div class="node-doc-type">${typeLabel}</div>
    </div>
    <div class="node-doc-btns">
      <button class="node-view-btn" onclick="${viewCall}">Ver</button>
      <button class="node-del-btn" onclick="deleteNodeDoc('${d.fid}')">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>
  </div>`;
}

// ── Toggle open/close a node card ──
window.toggleNodeCard = (card) => {
  card.classList.toggle('open');
  // Works for .si-card, .ssi-card, .subitem-card, .sub-subitem-card
  const chevronEl = card.querySelector('.si-chevron, .ssi-chevron, .subitem-card-arrow, .sub-subitem-arrow');
  if (chevronEl) {
    const svg = chevronEl.querySelector('svg');
    if (svg) svg.style.transform = card.classList.contains('open') ? 'rotate(180deg)' : '';
  }
  // Load sub-subitem docs if needed when opening a subitem
  if (card.classList.contains('open')) {
    const nodeId = card.dataset.nodeId;
    if (nodeId) {
      const ssiList = card.querySelector(`#ssi-${nodeId}`);
      if (ssiList) {
        const subCards = ssiList.querySelectorAll('[data-node-id]');
        subCards.forEach(sc => {
          const sid = sc.dataset.nodeId;
          if (sid && !_nodeDocCache[sid]) {
            loadNodeDocs(sid).then(docs => {
              const docsEl = sc.querySelector(`#ssi-docs-${sid}`);
              if (docsEl) docsEl.innerHTML = docs.map(d => buildNodeDocRow(d)).join('') || '<div class="si-empty">Sin archivos adjuntos</div>';
              // update meta
              const meta = sc.querySelector('.ssi-meta, .sub-subitem-meta');
              if (meta) meta.textContent = `${docs.length} archivo${docs.length!==1?'s':''}`;
            });
          }
        });
      }
    }
  }
};

// ── Create node (subitem or sub-subitem) ──
let _nodeCreateCtx = null;
window.openSubitemModal = (context) => {
  const subcampoId = currentDocSubcampo || currentSgcSub;
  const containerId = context === 'sgc' ? 'sgc-subitem-cards' : 'doc-subitem-cards';
  openNodeCreate(subcampoId, subcampoId, containerId, context, 0);
};

window.openNodeCreate = (parentId, subcampoId, gridId, context, level) => {
  _nodeCreateCtx = { parentId, subcampoId, gridId, context, level };
  safeSet('node-create-title', level === 0 ? 'Crear subítem' : 'Crear sub-subítem');
  safeSet('node-create-sub', level === 0 ? `Subítem en este subcampo` : `Sub-subítem de este subítem`);
  setVal('node-create-name', '');
  setVal('node-create-desc', '');
  g('node-create-overlay').classList.remove('hidden');
};
window.closeNodeCreate = () => g('node-create-overlay').classList.add('hidden');
window.closeNodeCreateOutside = (e) => { if (e.target.id === 'node-create-overlay') closeNodeCreate(); };

window.saveNodeCreate = async () => {
  const name = val('node-create-name');
  if (!name) { showToast('Ingresa un nombre.', 'error'); return; }
  const btn = g('node-create-save-btn'); setLoading(btn, true);
  const ctx = _nodeCreateCtx;
  try {
    const allNodes = _nodeCache[ctx.subcampoId] || [];
    const siblings = allNodes.filter(n => n.level === ctx.level && (ctx.level === 0 ? true : n.parentId === ctx.parentId));
    const order = siblings.length;
    const ref = await addDoc(collection(db, 'nodes'), {
      section: ctx.subcampoId, parentId: ctx.parentId, level: ctx.level,
      name, desc: val('node-create-desc'), order, createdAt: serverTimestamp()
    });
    if (!_nodeCache[ctx.subcampoId]) _nodeCache[ctx.subcampoId] = [];
    _nodeCache[ctx.subcampoId].push({ fid: ref.id, section: ctx.subcampoId, parentId: ctx.parentId, level: ctx.level, name, desc: val('node-create-desc'), order });
    _nodeDocCache[ref.id] = [];
    closeNodeCreate();
    // Refresh subitem cards bar (level 0 = subitem card)
    const containerId = ctx.context === 'sgc' ? 'sgc-subitem-cards' : 'doc-subitem-cards';
    const container = g(containerId);
    const level0 = (_nodeCache[ctx.subcampoId]||[]).filter(n=>n.level===0);
    if (container) container.innerHTML = buildSubitemCardBar(ctx.subcampoId, level0, ctx.context);
    showToast(`Subítem "${name}" creado`, 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  finally { setLoading(btn, false); }
};

// ── Delete node ──
window.deleteNode = async (nodeId, subcampoId, gridId, context) => {
  if (!confirm('¿Eliminar este elemento y sus archivos?')) return;
  try {
    await deleteDoc(doc(db, 'nodes', nodeId));
    // Remove from cache
    if (_nodeCache[subcampoId]) _nodeCache[subcampoId] = _nodeCache[subcampoId].filter(n => n.fid !== nodeId && n.parentId !== nodeId);
    delete _nodeDocCache[nodeId];
    const gId = gridId || (context === 'sgc' ? 'sgc-subitems-grid' : 'subitems-grid');
    renderSubitemsList(subcampoId, gId, context);
    showToast('Elemento eliminado', 'info');
  } catch(e) { showToast('Error al eliminar', 'error'); }
};

// ── Node doc (file) attached to a node ──
window.openNodeDoc = (nodeId, subcampoId, gridId, context) => {
  _activeNodeCtx = { nodeId, subcampoId, gridId, context };
  _ndocPendingImage = null;
  setVal('ndoc-nombre', '');
  setVal('ndoc-link', '');
  const prev = g('ndoc-img-preview'), fn = g('ndoc-img-filename'), area = g('ndoc-upload-area'), fi = g('ndoc-file');
  if (prev) { prev.src = ''; prev.classList.remove('visible'); }
  if (fn)   { fn.textContent = ''; fn.style.display = 'none'; }
  if (area)  area.classList.remove('has-image');
  if (fi)    fi.value = '';
  g('node-doc-overlay').classList.remove('hidden');
};
window.closeNodeDoc = () => g('node-doc-overlay').classList.add('hidden');
window.closeNodeDocOutside = (e) => { if (e.target.id === 'node-doc-overlay') closeNodeDoc(); };

window.onNdocFileSelected = (input) => {
  const file = input.files[0]; if (!file) return;
  if (file.size > 5 * 1024 * 1024) { showToast('El archivo es mayor a 5MB.', 'error'); return; }
  const reader = new FileReader();
  reader.onload = (e) => {
    _ndocPendingImage = { data: e.target.result, type: file.type, name: file.name };
    const prev = g('ndoc-img-preview'), fn = g('ndoc-img-filename'), area = g('ndoc-upload-area');
    if (file.type.startsWith('image/')) { prev.src = e.target.result; prev.classList.add('visible'); }
    else prev.classList.remove('visible');
    if (fn) { fn.textContent = file.name; fn.style.display = 'block'; }
    area?.classList.add('has-image');
  };
  reader.readAsDataURL(file);
};

window.saveNodeDoc = async () => {
  const nombre = val('ndoc-nombre');
  if (!nombre) { showToast('Ingresa un nombre.', 'error'); return; }
  const btn = g('ndoc-save-btn'); setLoading(btn, true);
  const ctx = _activeNodeCtx;
  const data = {
    nodeId: ctx.nodeId,
    nombre,
    link: val('ndoc-link'),
    createdAt: serverTimestamp()
  };
  if (_ndocPendingImage) {
    data.imageData = _ndocPendingImage.data;
    data.imageType = _ndocPendingImage.type;
    data.imageName = _ndocPendingImage.name;
  }
  try {
    const ref = await addDoc(collection(db, 'node_docs'), data);
    // Update cache immediately (no need to reload from Firestore)
    if (!_nodeDocCache[ctx.nodeId]) _nodeDocCache[ctx.nodeId] = [];
    _nodeDocCache[ctx.nodeId].push({ fid: ref.id, ...data });
    closeNodeDoc();
    const gId = ctx.gridId || (ctx.context === 'sgc' ? 'sgc-subitems-grid' : 'subitems-grid');
    // Re-render using cached data (already updated above)
    renderSubitemsList(ctx.subcampoId, gId, ctx.context);
    showToast('Archivo guardado', 'success');
  } catch(e) { showToast('Error: ' + e.message, 'error'); }
  finally { setLoading(btn, false); }
};

window.deleteNodeDoc = async (docId) => {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    await deleteDoc(doc(db, 'node_docs', docId));
    // Remove from all caches
    for (const nid in _nodeDocCache) {
      _nodeDocCache[nid] = _nodeDocCache[nid].filter(d => d.fid !== docId);
    }
    const ctx = _activeNodeCtx;
    if (ctx) {
      const gId = ctx.gridId || (ctx.context === 'sgc' ? 'sgc-subitems-grid' : 'subitems-grid');
      renderSubitemsList(ctx.subcampoId, gId, ctx.context);
    }
    showToast('Archivo eliminado', 'info');
  } catch(e) { showToast('Error al eliminar', 'error'); }
};

// ── Node file viewer ──
window.openNodeViewer = (type, docId) => {
  let docData = null;
  for (const nid in _nodeDocCache) {
    const found = _nodeDocCache[nid].find(d => d.fid === docId);
    if (found) { docData = found; break; }
  }
  if (!docData) { showToast('No se encontró el archivo.', 'error'); return; }

  const viewer = g('file-viewer'), body = g('viewer-body'), fname = g('viewer-filename');
  if (!viewer || !body) return;
  fname.textContent = docData.nombre || 'Documento';
  body.innerHTML = '<div class="viewer-loading">Cargando...</div>';
  viewer.classList.remove('hidden');
  _viewerCurrentSrc = null;

  if (type === 'link' && docData.link) {
    let embedUrl = docData.link;
    if (docData.link.includes('drive.google.com/file/d/')) {
      const m = docData.link.match(/\/d\/(.*?)\//);
      if (m) embedUrl = `https://drive.google.com/file/d/${m[1]}/preview`;
    }
    _viewerCurrentSrc = { type:'url', value:docData.link };
    body.innerHTML = `<iframe src="${embedUrl}" allow="autoplay" style="width:100%;height:80vh;border:none"></iframe>`;
  } else if (type === 'img' && docData.imageData) {
    _viewerCurrentSrc = { type:'base64', value:docData.imageData, mime:docData.imageType };
    body.innerHTML = `<img src="${docData.imageData}" alt="${docData.nombre}" style="max-width:100%;max-height:80vh;object-fit:contain"/>`;
  } else if (type === 'pdf' && docData.imageData) {
    _viewerCurrentSrc = { type:'base64', value:docData.imageData, mime:'application/pdf' };
    body.innerHTML = `<embed src="${docData.imageData}" type="application/pdf" style="width:100%;height:80vh"/>`;
  } else {
    body.innerHTML = '<div class="viewer-loading">No se pudo cargar el archivo.</div>';
  }
};

// ── Manual order editing ──
window.openOrderEdit = (nodeId, subcampoId, gridId, context, currentOrder) => {
  const newOrder = prompt(`Asigna un número de orden para este subítem (actual: ${parseInt(currentOrder) + 1}):`, parseInt(currentOrder) + 1);
  if (newOrder === null) return; // cancelled
  const orderNum = parseInt(newOrder) - 1;
  if (isNaN(orderNum) || orderNum < 0) { showToast('Ingresa un número válido mayor a 0.', 'error'); return; }
  updateDoc(doc(db, 'nodes', nodeId), { order: orderNum })
    .then(() => {
      // Update cache and re-sort
      const nodes = _nodeCache[subcampoId];
      if (nodes) {
        const n = nodes.find(x => x.fid === nodeId);
        if (n) n.order = orderNum;
        nodes.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
      }
      renderSubitemsList(subcampoId, gridId, context);
      showToast('Orden actualizado', 'success');
    })
    .catch(() => showToast('Error al actualizar el orden', 'error'));
};

// (drag and drop removed in v12)

function esc2(s) { return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/'/g,"&#39;"); }
