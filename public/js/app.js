/* ── Auth helpers ─────────────────────────────────────────────────────────── */
function getToken() { return localStorage.getItem("sx_token"); }
function getUser()  {
  try { return JSON.parse(localStorage.getItem("sx_user") || "null"); }
  catch { return null; }
}
function logout() {
  localStorage.removeItem("sx_token");
  localStorage.removeItem("sx_user");
  window.location.href = "/login.html";
}

// Redirect to login if not authenticated
(function guardAuth() {
  if (!getToken() || !getUser()) {
    window.location.href = "/login.html";
  }
})();

/* ── Constants ────────────────────────────────────────────────────────────── */
const STATUS_LABELS  = ["Pending","Approved","Rejected","Shipped","Delivered","Cancelled"];
const STATUS_CLASSES = ["badge-pending","badge-approved","badge-rejected","badge-shipped","badge-delivered","badge-cancelled"];

/* ── State ────────────────────────────────────────────────────────────────── */
let allOrders    = [];
let allSuppliers = [];
let allInventory = [];
let allUsers     = [];
let orderFilter  = "all";
let chartStatus  = null;
let chartMonthly = null;

/* ── Utility ──────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);

function fmtDate(ts) {
  if (!ts) return "–";
  return new Date(ts * 1000).toLocaleDateString("en-AU", { day:"2-digit", month:"short", year:"numeric" });
}
function fmtMoney(cents) {
  return "$" + (cents / 100).toLocaleString("en-AU", { minimumFractionDigits:2, maximumFractionDigits:2 });
}
function statusBadge(s) {
  return `<span class="badge ${STATUS_CLASSES[s]}">${STATUS_LABELS[s]}</span>`;
}

async function apiFetch(url, opts = {}) {
  const token = getToken();
  const r = await fetch(url, {
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
    ...opts,
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  if (r.status === 401) { logout(); return; }
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || "Request failed");
  return data;
}

function toast(msg, type = "info") {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  $("toast-container").appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function closeModal(id) { $(id).style.display = "none"; }
function openModal(id)  { $(id).style.display = "flex"; }

/* ── Role-based UI setup ──────────────────────────────────────────────────── */
function setupRoleUI() {
  const user = getUser();
  if (!user) return;

  // Topbar user chip
  $("user-avatar").textContent = user.name.charAt(0).toUpperCase();
  $("user-name").textContent   = user.name;
  const roleEl = $("user-role-badge");
  roleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
  roleEl.className   = `user-role-badge role-${user.role}`;

  // Nav visibility per role
  const navRules = {
    admin:    ["dashboard","orders","suppliers","inventory","analytics","blockchain","users"],
    manager:  ["dashboard","orders","suppliers","inventory","analytics","blockchain"],
    user:     ["dashboard","orders"],
    supplier: ["dashboard","orders"]
  };
  const allowed = navRules[user.role] || [];
  document.querySelectorAll(".nav-item[data-page]").forEach(item => {
    item.style.display = allowed.includes(item.dataset.page) ? "" : "none";
  });

  // "New PO" button: admin and user only
  $("btn-new-order").style.display = ["admin","user"].includes(user.role) ? "" : "none";

  // Admin-only elements
  document.querySelectorAll(".admin-only").forEach(el => {
    el.style.display = user.role === "admin" ? "" : "none";
  });
}

/* ── Mobile sidebar ───────────────────────────────────────────────────────── */
const sidebar  = document.querySelector(".sidebar");
const overlay  = $("sidebar-overlay");
const hamburger= $("btn-hamburger");

function openSidebar() {
  sidebar.classList.add("open");
  overlay.classList.add("visible");
  hamburger.classList.add("open");
  hamburger.setAttribute("aria-expanded", "true");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  overlay.classList.remove("visible");
  hamburger.classList.remove("open");
  hamburger.setAttribute("aria-expanded", "false");
}
hamburger.addEventListener("click", () =>
  sidebar.classList.contains("open") ? closeSidebar() : openSidebar()
);
overlay.addEventListener("click", closeSidebar);

/* ── Form validation helpers ──────────────────────────────────────────────── */
function showFieldError(input, msg) {
  clearFieldError(input);
  input.classList.add("input-error");
  const err = document.createElement("div");
  err.className   = "field-error";
  err.textContent = msg;
  err.setAttribute("role", "alert");
  input.parentNode.insertBefore(err, input.nextSibling);
  // Clear error as user types
  const clear = () => { clearFieldError(input); input.removeEventListener("input", clear); };
  input.addEventListener("input", clear);
}

function clearFieldError(input) {
  input.classList.remove("input-error");
  const existing = input.parentNode.querySelector(".field-error");
  if (existing) existing.remove();
}

function clearAllErrors(form) {
  form.querySelectorAll(".input-error").forEach(el => el.classList.remove("input-error"));
  form.querySelectorAll(".field-error").forEach(el => el.remove());
}

function validateForm(fields) {
  let valid = true;
  for (const { el, rules } of fields) {
    if (!el) continue;
    clearFieldError(el);
    for (const { test, msg } of rules) {
      if (!test(el.value)) {
        showFieldError(el, msg);
        if (valid) el.focus(); // focus first invalid field
        valid = false;
        break;
      }
    }
  }
  return valid;
}

/* ── Navigation ───────────────────────────────────────────────────────────── */
function navigate(page) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-item").forEach(n => n.classList.remove("active"));
  $(`page-${page}`).classList.add("active");
  const navEl = document.querySelector(`[data-page="${page}"]`);
  if (navEl) navEl.classList.add("active");
  $("page-title").textContent = {
    dashboard:"Dashboard", orders:"Purchase Orders",
    suppliers:"Suppliers", inventory:"Inventory",
    analytics:"Analytics", blockchain:"Blockchain", users:"User Management"
  }[page];

  if (page === "dashboard")  loadDashboard();
  if (page === "orders")     loadOrders();
  if (page === "suppliers")  loadSuppliers();
  if (page === "inventory")  loadInventory();
  if (page === "analytics")  loadAnalytics();
  if (page === "blockchain") loadBlockchain();
  if (page === "users")      loadUsers();
}

document.querySelectorAll(".nav-item[data-page]").forEach(item => {
  item.addEventListener("click", () => {
    navigate(item.dataset.page);
    closeSidebar(); // auto-close on mobile
  });
});

$("btn-logout").addEventListener("click", () => {
  if (confirm("Sign out of SmartXX?")) logout();
});

/* ── Blockchain status badge ──────────────────────────────────────────────── */
async function checkChainStatus() {
  try {
    const s  = await apiFetch("/api/status");
    const el = $("chain-status");
    el.textContent = `● Block #${s.blockNumber}`;
    el.className   = "chain-badge connected";
  } catch {
    $("chain-status").textContent = "● Disconnected";
    $("chain-status").className   = "chain-badge disconnected";
  }
}

/* ── Dashboard ────────────────────────────────────────────────────────────── */
async function loadDashboard() {
  const user = getUser();
  try {
    const orders = await apiFetch("/api/orders");

    const statusTally = [0,0,0,0,0,0];
    orders.forEach(o => statusTally[o.status]++);
    $("kpi-total").textContent     = orders.length;
    $("kpi-pending").textContent   = statusTally[0];
    $("kpi-approved").textContent  = statusTally[1];
    $("kpi-delivered").textContent = statusTally[4];

    const canSeeAnalytics = ["admin","manager"].includes(user.role);

    if (canSeeAnalytics) {
      const analytics = await apiFetch("/api/analytics");
      $("kpi-alerts").textContent    = analytics.inventoryAlerts;
      $("kpi-suppliers").textContent = analytics.activeSuppliers;
    } else {
      $("kpi-alerts").textContent    = "–";
      $("kpi-suppliers").textContent = "–";
    }

    // ── Action Required panel ──────────────────────────────────────────
    const actionCard  = $("dash-action-card");
    const actionBody  = $("dash-action-body");
    const actionCount = $("dash-action-count");

    // Determine which orders need this user's action
    let actionOrders = [];
    if (user.role === "manager" || user.role === "admin") {
      // Pending orders → Approve / Reject
      actionOrders = orders.filter(o => o.status === 0);
    }
    if (user.role === "supplier") {
      // Approved orders for their company → Mark Shipped
      actionOrders = orders.filter(o => o.status === 1 && o.supplierName === user.company);
    }
    if (user.role === "admin") {
      // Also add approved orders that need shipping
      const needsShip = orders.filter(o => o.status === 1);
      actionOrders = [...actionOrders, ...needsShip];
    }

    if (actionOrders.length > 0) {
      actionCard.style.display = "";
      actionCount.textContent  = `${actionOrders.length} pending`;

      actionBody.innerHTML = actionOrders
        .sort((a, b) => b.createdAt - a.createdAt)
        .map(o => {
          let btns = "";
          if (o.status === 0 && (user.role === "manager" || user.role === "admin")) {
            btns = `
              <button class="btn btn-success btn-sm" onclick="dashAction(${o.id},'approve')">✔ Approve</button>
              <button class="btn btn-danger  btn-sm" onclick="dashAction(${o.id},'reject')">✖ Reject</button>`;
          }
          if (o.status === 1 && (user.role === "supplier" || user.role === "admin")) {
            btns += `<button class="btn btn-info btn-sm" onclick="dashAction(${o.id},'ship')">🚚 Mark Shipped</button>`;
          }
          return `
            <tr id="dash-action-row-${o.id}">
              <td><strong>#${o.id}</strong>${o.isAutoGenerated ? " 🤖" : ""}</td>
              <td>${o.supplierName}</td>
              <td>${o.itemCount} item${o.itemCount !== 1 ? "s" : ""}</td>
              <td><strong>${fmtMoney(o.totalAmount)}</strong></td>
              <td>${statusBadge(o.status)}</td>
              <td><div class="actions-col">${btns}</div></td>
            </tr>`;
        }).join("");
    } else {
      actionCard.style.display = "";
      actionBody.innerHTML = `<tr><td colspan="6" style="padding:.9rem 1rem;color:var(--success);font-size:13px">✔ No actions required right now.</td></tr>`;
      actionCount.textContent = "all clear";
      actionCount.className   = "badge badge-approved";
    }

    // ── Recent orders ──────────────────────────────────────────────────
    const recent = [...orders].sort((a,b) => b.createdAt - a.createdAt).slice(0, 7);
    $("dash-orders-body").innerHTML = recent.length
      ? recent.map(o => `
          <tr>
            <td><strong>#${o.id}</strong>${o.isAutoGenerated ? ' <span title="Auto-generated" style="font-size:13px">🤖</span>' : ""}</td>
            <td>${o.supplierName}</td>
            <td>${fmtMoney(o.totalAmount)}</td>
            <td>${statusBadge(o.status)}</td>
            <td>${fmtDate(o.createdAt)}</td>
          </tr>`).join("")
      : `<tr><td colspan="5" class="text-muted p-sm">No orders yet. Create your first PO!</td></tr>`;

    // Low-stock alerts + auto-PO panel (admin/manager)
    if (canSeeAnalytics) {
      const alerts = await apiFetch("/api/inventory/alerts");
      let alertHtml = alerts.length
        ? alerts.map(item => `
            <div class="alert-item">
              <div>
                <div class="alert-name">${item.name}</div>
                <div class="alert-stock">Stock: ${item.currentStock} ${item.unit} &nbsp;|&nbsp; Min: ${item.minThreshold} ${item.unit} &nbsp;|&nbsp; Reorder: ${item.reorderQty} ${item.unit}</div>
              </div>
              <span class="badge badge-low">⚠ Low Stock</span>
            </div>`).join("")
        : `<p class="text-muted p-sm">✓ All stock levels are healthy.</p>`;

      // Admin: add manual auto-PO trigger button
      if (user.role === "admin") {
        alertHtml += `
          <div style="padding:.75rem 1rem;border-top:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:.5rem">
            <span style="font-size:12px;color:var(--muted)">🤖 System auto-checks every 2 minutes</span>
            <button class="btn btn-primary btn-sm" onclick="triggerAutoPO()">Run Auto-PO Now</button>
          </div>`;
      }
      $("dash-alerts-list").innerHTML = alertHtml;
    } else {
      $("dash-alerts-list").innerHTML = `<p class="text-muted p-sm">Not available for your role.</p>`;
    }
  } catch (e) { toast("Dashboard error: " + e.message, "error"); }
}

async function dashAction(id, action) {
  const row = $(`dash-action-row-${id}`);
  if (row) {
    // Show loading state on buttons
    row.querySelectorAll("button").forEach(b => { b.disabled = true; b.style.opacity = ".5"; });
  }
  try {
    const res = await apiFetch(`/api/orders/${id}/status`, { method:"PUT", body:{ action } });
    toast(`Order #${id} ${action}d! Tx: ${res.txHash.slice(0,14)}…`, "success");
    // Animate row removal then reload dashboard
    if (row) {
      row.style.transition = "opacity .35s, transform .35s";
      row.style.opacity    = "0";
      row.style.transform  = "translateX(20px)";
      setTimeout(() => loadDashboard(), 380);
    } else {
      loadDashboard();
    }
    // Refresh orders page if it's open
    if ($("page-orders").classList.contains("active")) loadOrders();
  } catch (e) {
    toast("Error: " + e.message, "error");
    if (row) row.querySelectorAll("button").forEach(b => { b.disabled = false; b.style.opacity = "1"; });
  }
}

async function triggerAutoPO() {
  try {
    toast("🤖 Running auto-PO check…", "info");
    const res = await apiFetch("/api/orders/auto-check", { method:"POST" });
    if (res.log && res.log.length > 0) {
      toast(`✅ Auto-PO created for ${res.log.length} supplier(s)`, "success");
    } else {
      toast("No new auto-POs needed at this time", "info");
    }
    await loadDashboard();
    if (allOrders.length) await loadOrders();
  } catch (e) { toast("Auto-PO error: " + e.message, "error"); }
}

/* ── Purchase Orders ──────────────────────────────────────────────────────── */
async function loadOrders() {
  const user = getUser();

  // Role hint banner
  const banners = {
    manager:  { icon:"✔", color:"var(--success)", text:"As Manager, you can <strong>Approve</strong> or <strong>Reject</strong> pending orders, and confirm delivery." },
    user:     { icon:"📋", color:"var(--info)",    text:"As User, you can <strong>create new purchase orders</strong>. Use the button above to submit a request." },
    supplier: { icon:"🚚", color:"var(--shipped)", text:`As Supplier (${user.company}), you can <strong>Mark Shipped</strong> on orders approved for your company.` },
    admin:    null
  };

  const banner = banners[user.role];
  let bannerHtml = "";
  if (banner) {
    bannerHtml = `
      <div style="display:flex;align-items:center;gap:.75rem;padding:.75rem 1rem;
        background:${banner.color}18;border:1px solid ${banner.color}40;
        border-radius:10px;margin-bottom:1rem;font-size:13px;">
        <span style="font-size:18px">${banner.icon}</span>
        <span>${banner.text}</span>
      </div>`;
  }

  // Inject banner above the filter toolbar (replace if already exists)
  const existing = document.getElementById("orders-role-banner");
  if (existing) existing.remove();
  if (bannerHtml) {
    const div = document.createElement("div");
    div.id = "orders-role-banner";
    div.innerHTML = bannerHtml;
    $("page-orders").insertBefore(div, $("page-orders").firstChild);
  }

  try {
    allOrders = await apiFetch("/api/orders");
    renderOrders();
  } catch (e) { toast("Failed to load orders: " + e.message, "error"); }
}

function renderOrders() {
  const user   = getUser();
  const search = ($("order-search").value || "").toLowerCase();
  let filtered = allOrders;

  if (orderFilter !== "all") filtered = filtered.filter(o => o.status === parseInt(orderFilter));
  if (search) filtered = filtered.filter(o =>
    o.supplierName.toLowerCase().includes(search) ||
    (o.notes || "").toLowerCase().includes(search)
  );
  filtered.sort((a, b) => b.createdAt - a.createdAt);

  $("orders-body").innerHTML = filtered.length
    ? filtered.map(o => {
        const actions = buildOrderActions(o, user);
        return `
        <tr>
          <td><strong>#${o.id}</strong></td>
          <td>${o.supplierName}</td>
          <td>${o.itemCount} item${o.itemCount !== 1 ? "s" : ""}</td>
          <td><strong>${fmtMoney(o.totalAmount)}</strong></td>
          <td>${statusBadge(o.status)}</td>
          <td>${fmtDate(o.createdAt)}</td>
          <td>${o.expectedDelivery ? fmtDate(o.expectedDelivery) : "–"}</td>
          <td><div class="actions-col">${actions}</div></td>
        </tr>`;
      }).join("")
    : `<tr><td colspan="8" class="text-muted p-sm">No orders found.</td></tr>`;
}

function buildOrderActions(o, user) {
  let html = `<button class="btn btn-ghost btn-sm" onclick="viewOrder(${o.id})">View</button>`;

  // Supplier: can only ship approved orders from their company
  if (user.role === "supplier") {
    if (o.status === 1 && o.supplierName === user.company)
      html += `<button class="btn btn-info btn-sm" onclick="updateOrderStatus(${o.id},'ship')">Mark Shipped</button>`;
    return html;
  }

  // User (requester): view only — no approve/reject/ship/deliver
  if (user.role === "user") return html;

  // Admin & Manager: approve, reject, deliver, cancel
  if (o.status === 0) {
    html += `<button class="btn btn-success btn-sm" onclick="updateOrderStatus(${o.id},'approve')">Approve</button>`;
    html += `<button class="btn btn-danger btn-sm"  onclick="updateOrderStatus(${o.id},'reject')">Reject</button>`;
    html += `<button class="btn btn-ghost btn-sm"   onclick="updateOrderStatus(${o.id},'cancel')">Cancel</button>`;
  }
  // Admin only: can also ship
  if (o.status === 1) {
    if (user.role === "admin")
      html += `<button class="btn btn-info btn-sm" onclick="updateOrderStatus(${o.id},'ship')">Mark Shipped</button>`;
    html += `<button class="btn btn-ghost btn-sm" onclick="updateOrderStatus(${o.id},'cancel')">Cancel</button>`;
  }
  if (o.status === 3)
    html += `<button class="btn btn-success btn-sm" onclick="updateOrderStatus(${o.id},'deliver')">Mark Delivered</button>`;

  return html;
}

async function updateOrderStatus(id, action) {
  try {
    toast("Submitting blockchain transaction…", "info");
    const res = await apiFetch(`/api/orders/${id}/status`, { method:"PUT", body:{ action } });
    toast(`Order #${id} ${action}d! Tx: ${res.txHash.slice(0,12)}…`, "success");
    await loadOrders();
  } catch (e) { toast("Error: " + e.message, "error"); }
}

async function viewOrder(id) {
  try {
    const o = await apiFetch(`/api/orders/${id}`);
    const itemRows = o.items.map(it => `
      <tr>
        <td>${it.name}</td>
        <td>${it.quantity}</td>
        <td>${fmtMoney(it.unitPrice)}</td>
        <td><strong>${fmtMoney(it.quantity * it.unitPrice)}</strong></td>
      </tr>`).join("");

    const txRows = Object.entries(o.txLog || {}).map(([k,v]) =>
      `<tr><td style="text-transform:capitalize;font-weight:600">${k}</td><td class="tx-hash">${v}</td></tr>`
    ).join("") || `<tr><td colspan="2" class="text-muted">No transactions recorded</td></tr>`;

    $("modal-view-body").innerHTML = `
      <div class="detail-grid">
        <div class="detail-field"><div class="detail-label">PO Number</div><div class="detail-value">#${o.id}</div></div>
        <div class="detail-field"><div class="detail-label">Status</div><div class="detail-value">${statusBadge(o.status)}</div></div>
        <div class="detail-field"><div class="detail-label">Supplier</div><div class="detail-value">${o.supplierName}</div></div>
        <div class="detail-field"><div class="detail-label">Supplier Address</div><div class="detail-value">${o.supplierAddress || "–"}</div></div>
        <div class="detail-field"><div class="detail-label">Total Amount</div><div class="detail-value" style="font-size:18px;color:var(--success)">${fmtMoney(o.totalAmount)}</div></div>
        <div class="detail-field"><div class="detail-label">Created</div><div class="detail-value">${fmtDate(o.createdAt)}</div></div>
        <div class="detail-field"><div class="detail-label">Last Updated</div><div class="detail-value">${fmtDate(o.updatedAt)}</div></div>
        <div class="detail-field"><div class="detail-label">Expected Delivery</div><div class="detail-value">${o.expectedDelivery ? fmtDate(o.expectedDelivery) : "–"}</div></div>
      </div>
      ${o.notes ? `<div class="form-group"><div class="detail-label">Notes</div><div class="detail-value" style="color:var(--muted)">${o.notes}</div></div>` : ""}
      <div class="detail-section">Line Items</div>
      <table class="table">
        <thead><tr><th>Item</th><th>Qty</th><th>Unit Price</th><th>Subtotal</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
      <div class="detail-section">⛓ Blockchain Audit Trail</div>
      <table class="table">
        <thead><tr><th>Action</th><th>Transaction Hash</th></tr></thead>
        <tbody>${txRows}</tbody>
      </table>
      <div style="font-size:11px;color:var(--muted);margin-top:.5rem">
        Creator wallet: <span class="mono">${o.creator}</span>
      </div>`;

    openModal("modal-view-order");
  } catch (e) { toast("Failed to load order: " + e.message, "error"); }
}

/* ── Create Order ─────────────────────────────────────────────────────────── */
function openCreateOrder() {
  const supplierOpts = allSuppliers.map(s =>
    `<option value="${s.name}">${s.name}</option>`).join("");

  $("modal-order-title").textContent = "New Purchase Order";
  $("modal-order-body").innerHTML = `
    <form id="order-form">
      <div class="form-row">
        <div class="form-group">
          <label>Supplier *</label>
          <select class="form-control" name="supplierName" required>
            <option value="">– Select supplier –</option>
            ${supplierOpts}
          </select>
        </div>
        <div class="form-group">
          <label>Expected Delivery</label>
          <input class="form-control" name="expectedDelivery" type="date" />
        </div>
      </div>
      <div class="form-group">
        <label>Supplier Address</label>
        <input class="form-control" name="supplierAddress" placeholder="Supplier's business address" />
      </div>
      <div class="items-header">
        <label>Line Items *</label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="addItemRow()">+ Add Item</button>
      </div>
      <div id="items-container">
        <div style="display:grid;grid-template-columns:2fr 1fr 1fr auto;gap:.5rem;margin-bottom:.3rem;padding:0 .1rem">
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase">Item Name</span>
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase">Qty</span>
          <span style="font-size:11px;color:var(--muted);text-transform:uppercase">Unit Price ($)</span>
          <span></span>
        </div>
      </div>
      <div id="order-total" style="text-align:right;font-weight:700;margin:.5rem 0 1rem;font-size:15px;color:var(--success)"></div>
      <div class="form-group">
        <label>Notes</label>
        <textarea class="form-control" name="notes" placeholder="Additional instructions, terms…"></textarea>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn btn-ghost" onclick="closeModal('modal-order')">Cancel</button>
        <button type="submit" class="btn btn-primary">Submit to Blockchain</button>
      </div>
    </form>`;

  addItemRow();
  $("order-form").addEventListener("submit", submitOrder);
  openModal("modal-order");
}

function addItemRow() {
  const row = document.createElement("div");
  row.className = "item-row";
  row.innerHTML = `
    <input class="form-control item-name"  placeholder="e.g. Network Switch" />
    <input class="form-control item-qty"   type="number" min="1" value="1" />
    <input class="form-control item-price" type="number" min="0" step="0.01" placeholder="0.00" />
    <button type="button" class="btn-remove-item" onclick="this.parentElement.remove();calcTotal()">✕</button>`;
  row.querySelectorAll("input").forEach(i => i.addEventListener("input", calcTotal));
  $("items-container").appendChild(row);
}

function calcTotal() {
  let total = 0;
  document.querySelectorAll(".item-row").forEach(row => {
    const qty   = parseFloat(row.querySelector(".item-qty").value)   || 0;
    const price = parseFloat(row.querySelector(".item-price").value) || 0;
    total += qty * price * 100;
  });
  $("order-total").textContent = total > 0 ? `Total: ${fmtMoney(total)}` : "";
}

async function submitOrder(e) {
  e.preventDefault();
  const form  = e.target;
  const fd    = new FormData(form);
  const items = [];

  // Validate supplier selection
  const supSel = form.querySelector("[name='supplierName']");
  const ok = validateForm([
    { el: supSel, rules: [{ test: v => v.trim() !== "", msg: "Please select a supplier" }] }
  ]);
  if (!ok) return;

  // Validate items
  let itemErrors = false;
  document.querySelectorAll(".item-row").forEach(row => {
    const nameEl  = row.querySelector(".item-name");
    const qtyEl   = row.querySelector(".item-qty");
    const priceEl = row.querySelector(".item-price");
    const name    = nameEl.value.trim();
    const qty     = parseInt(qtyEl.value);
    const price   = Math.round(parseFloat(priceEl.value) * 100);

    if (!name)  { showFieldError(nameEl, "Item name required");  itemErrors = true; }
    if (!qty || qty < 1) { showFieldError(qtyEl, "Min 1");       itemErrors = true; }
    if (!price || price < 1) { showFieldError(priceEl, "Enter price"); itemErrors = true; }

    if (name && qty && price) items.push({ name, quantity: qty, unitPrice: price });
  });

  if (itemErrors) return;
  if (!items.length) { toast("Add at least one item", "error"); return; }

  const body = {
    supplierName:    fd.get("supplierName"),
    supplierAddress: fd.get("supplierAddress"),
    notes:           fd.get("notes"),
    expectedDelivery:fd.get("expectedDelivery"),
    items
  };

  const btn = form.querySelector("[type=submit]");
  try {
    btn.textContent = "⏳ Submitting…"; btn.disabled = true;
    const res = await apiFetch("/api/orders", { method:"POST", body });
    toast(`PO #${res.orderId} created on blockchain! ⛓`, "success");
    closeModal("modal-order");
    await loadOrders();
  } catch (err) {
    toast("Failed: " + err.message, "error");
    btn.textContent = "Submit to Blockchain"; btn.disabled = false;
  }
}

/* ── Order filter tabs ────────────────────────────────────────────────────── */
document.querySelectorAll(".ftab").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".ftab").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    orderFilter = btn.dataset.status;
    renderOrders();
  });
});
$("order-search").addEventListener("input", renderOrders);

/* ── Suppliers ────────────────────────────────────────────────────────────── */
async function loadSuppliers() {
  try {
    allSuppliers = await apiFetch("/api/suppliers");
    renderSuppliers();
  } catch (e) { toast("Supplier load failed: " + e.message, "error"); }
}

function renderSuppliers() {
  const user = getUser();
  const q    = ($("supplier-search").value || "").toLowerCase();
  const list = q
    ? allSuppliers.filter(s => s.name.toLowerCase().includes(q) || (s.category||"").toLowerCase().includes(q))
    : allSuppliers;

  $("suppliers-body").innerHTML = list.length
    ? list.map(s => `
        <tr>
          <td>${s.id}</td>
          <td>
            <strong>${s.name}</strong>
            ${s.abn ? `<div style="font-size:11px;color:var(--muted)">ABN: ${s.abn}</div>` : ""}
            ${s.website ? `<div style="font-size:11px;color:var(--info)">${s.website}</div>` : ""}
          </td>
          <td>${s.category || "–"}</td>
          <td>${s.contact || "–"}</td>
          <td>${s.email || "–"}</td>
          <td>${s.phone || "–"}</td>
          <td>${s.rating ? "★ " + s.rating : "–"}</td>
          <td><span class="badge ${s.status==="Active"?"badge-approved":"badge-cancelled"}">${s.status}</span></td>
          <td><div class="actions-col">
            ${user.role === "admin" ? `<button class="btn btn-ghost btn-sm" onclick="editSupplier(${s.id})">Edit</button>` : ""}
            ${user.role === "admin" ? `<button class="btn btn-danger btn-sm" onclick="deleteSupplier(${s.id})">Delete</button>` : ""}
          </div></td>
        </tr>`).join("")
    : `<tr><td colspan="9" class="text-muted p-sm">No suppliers found.</td></tr>`;
}

$("supplier-search").addEventListener("input", renderSuppliers);
$("btn-add-supplier").addEventListener("click", () => {
  $("modal-supplier-title").textContent = "Add Supplier";
  $("supplier-form").reset();
  delete $("supplier-form").dataset.editId;
  openModal("modal-supplier");
});

function editSupplier(id) {
  const s = allSuppliers.find(x => x.id === id);
  if (!s) return;
  $("modal-supplier-title").textContent = "Edit Supplier";
  const f = $("supplier-form");
  f.dataset.editId = id;
  ["name","contact","email","phone","address","category"].forEach(k => {
    if (f[k]) f[k].value = s[k] || "";
  });
  openModal("modal-supplier");
}

async function deleteSupplier(id) {
  if (!confirm("Delete this supplier?")) return;
  try {
    await apiFetch(`/api/suppliers/${id}`, { method:"DELETE" });
    toast("Supplier deleted", "success");
    loadSuppliers();
  } catch (e) { toast(e.message, "error"); }
}

$("supplier-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form   = e.target;
  const fd     = new FormData(form);
  const body   = Object.fromEntries(fd);
  const editId = form.dataset.editId;

  const ok = validateForm([
    { el: form.name,    rules: [{ test: v => v.trim().length > 1, msg: "Company name is required" }] },
    { el: form.contact, rules: [{ test: v => v.trim().length > 0, msg: "Contact person is required" }] },
    { el: form.email,   rules: [
      { test: v => v.trim().length > 0, msg: "Email is required" },
      { test: v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), msg: "Enter a valid email address" }
    ]},
  ]);
  if (!ok) return;
  try {
    if (editId) {
      await apiFetch(`/api/suppliers/${editId}`, { method:"PUT", body });
      toast("Supplier updated", "success");
      closeModal("modal-supplier");
      loadSuppliers();
    } else {
      const data = await apiFetch("/api/suppliers", { method:"POST", body });
      closeModal("modal-supplier");
      loadSuppliers();
      // Show auto-generated credentials
      if (data.credentials) showCredentials(data.credentials);
    }
  } catch (err) { toast(err.message, "error"); }
});

function showCredentials(c) {
  $("modal-creds-body").innerHTML = `
    <div style="text-align:center;padding:.5rem 0 1.2rem">
      <div style="font-size:44px;margin-bottom:.6rem">🔑</div>
      <div style="font-weight:800;font-size:17px">Account Created Successfully</div>
      <div style="color:var(--muted);font-size:13px;margin-top:.4rem">Share these login credentials with <strong>${c.name}</strong></div>
    </div>

    <div style="background:var(--bg);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-bottom:1rem">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">Company</span>
        <span style="font-weight:700">${c.company}</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">Role</span>
        <span class="badge badge-approved" style="text-transform:capitalize">Supplier</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem;border-bottom:1px solid var(--border)">
        <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">Username</span>
        <span class="mono" style="font-size:15px;color:var(--info);font-weight:700">${c.username}</span>
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:.75rem 1rem">
        <span style="font-size:12px;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.4px">Password</span>
        <span class="mono" style="font-size:15px;color:var(--success);font-weight:700">${c.password}</span>
      </div>
    </div>

    <div style="padding:.75rem 1rem;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.25);border-radius:10px;font-size:12.5px;color:var(--warning);line-height:1.6;margin-bottom:1rem">
      ⚠ <strong>Save these credentials now.</strong> The password cannot be recovered after closing this window.
      The supplier can log in at <strong>http://localhost:3000/login.html</strong>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="copyCredentials('${c.username}','${c.password}','${c.company}')">📋 Copy</button>
      <button class="btn btn-primary" onclick="closeModal('modal-creds')">Done</button>
    </div>`;
  openModal("modal-creds");
}

function copyCredentials(u, p, company) {
  const text = `SmartXX – Supplier Login\nCompany: ${company}\nURL: http://localhost:3000/login.html\nUsername: ${u}\nPassword: ${p}`;
  navigator.clipboard.writeText(text).then(() => toast("Credentials copied to clipboard", "success"));
}

/* ── Inventory ────────────────────────────────────────────────────────────── */
async function loadInventory() {
  try {
    allInventory = await apiFetch("/api/inventory");
    renderInventory();
  } catch (e) { toast("Inventory load failed: " + e.message, "error"); }
}

function renderInventory() {
  const user = getUser();
  const q    = ($("inv-search").value || "").toLowerCase();
  const list = q
    ? allInventory.filter(i => i.name.toLowerCase().includes(q) || (i.sku||"").toLowerCase().includes(q))
    : allInventory;

  $("inventory-body").innerHTML = list.length
    ? list.map(item => {
        const pct   = Math.min(100, Math.round((item.currentStock / Math.max(1, item.minThreshold * 1.5)) * 100));
        const low   = item.currentStock <= item.minThreshold;
        const color = low ? "var(--danger)" : (pct < 70 ? "var(--warning)" : "var(--success)");
        const sup   = allSuppliers.find(s => s.id === item.supplierId);
        return `
          <tr ${low ? 'style="background:rgba(239,68,68,.04)"' : ""}>
            <td class="mono">${item.sku || "–"}</td>
            <td><strong>${item.name}</strong>${low ? ' <span class="badge badge-low" style="font-size:10px">⚠ Low</span>' : ""}</td>
            <td>${item.category || "–"}</td>
            <td>
              <div class="stock-bar-wrap">
                <div class="stock-bar"><div class="stock-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                <span class="stock-val" style="color:${color}">${item.currentStock} ${item.unit}</span>
              </div>
            </td>
            <td>${item.minThreshold} ${item.unit}</td>
            <td>${fmtMoney(item.unitCost)}</td>
            <td>${sup ? sup.name : "–"}</td>
            <td>${item.location || "–"}</td>
            <td><div class="actions-col">
              ${user.role === "admin" ? `<button class="btn btn-info btn-sm" onclick="quickSetStock(${item.id})">Set Stock</button>` : ""}
              ${["admin","manager"].includes(user.role) ? `<button class="btn btn-ghost btn-sm" onclick="editInventory(${item.id})">Edit</button>` : ""}
              ${user.role === "admin" ? `<button class="btn btn-danger btn-sm" onclick="deleteInventory(${item.id})">Delete</button>` : ""}
            </div></td>
          </tr>`;
      }).join("")
    : `<tr><td colspan="9" class="text-muted p-sm">No items found.</td></tr>`;
}

async function quickSetStock(id) {
  const item = allInventory.find(i => i.id === id);
  if (!item) return;
  const val = prompt(`Set stock level for "${item.name}"\n\nCurrent: ${item.currentStock} ${item.unit}\nMin threshold: ${item.minThreshold} ${item.unit}\n\nEnter new stock quantity:`);
  if (val === null || val === "") return;
  const newStock = parseInt(val);
  if (isNaN(newStock) || newStock < 0) { toast("Invalid quantity", "error"); return; }
  try {
    await apiFetch(`/api/inventory/${id}`, { method:"PUT", body:{ currentStock: newStock } });
    if (newStock <= item.minThreshold) {
      toast(`⚠ Stock set to ${newStock} — below threshold. Auto-PO will trigger shortly.`, "info");
    } else {
      toast(`Stock updated to ${newStock} ${item.unit}`, "success");
    }
    loadInventory();
    loadDashboard();
  } catch (e) { toast("Update failed: " + e.message, "error"); }
}

$("inv-search").addEventListener("input", renderInventory);
$("btn-add-inv").addEventListener("click", () => {
  $("modal-inv-title").textContent = "Add Inventory Item";
  $("inv-form").reset();
  delete $("inv-form").dataset.editId;
  openModal("modal-inv");
});

function editInventory(id) {
  const item = allInventory.find(i => i.id === id);
  if (!item) return;
  $("modal-inv-title").textContent = "Edit Inventory Item";
  const f = $("inv-form");
  f.dataset.editId = id;
  ["name","sku","currentStock","minThreshold","reorderQty","unitCost","unit","category","location"].forEach(k => {
    if (f[k]) f[k].value = item[k] ?? "";
  });
  openModal("modal-inv");
}

async function deleteInventory(id) {
  if (!confirm("Delete this inventory item?")) return;
  try {
    await apiFetch(`/api/inventory/${id}`, { method:"DELETE" });
    toast("Item deleted", "success");
    loadInventory();
  } catch (e) { toast(e.message, "error"); }
}

$("inv-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form   = e.target;
  const fd     = new FormData(form);
  const body   = Object.fromEntries(fd);
  const editId = form.dataset.editId;

  const ok = validateForm([
    { el: form.name,         rules: [{ test: v => v.trim().length > 0, msg: "Item name is required" }] },
    { el: form.currentStock, rules: [{ test: v => v !== "" && Number(v) >= 0, msg: "Enter current stock (0 or more)" }] },
    { el: form.minThreshold, rules: [{ test: v => v !== "" && Number(v) >= 0, msg: "Enter minimum threshold" }] },
  ]);
  if (!ok) return;
  ["currentStock","minThreshold","reorderQty","unitCost"].forEach(k => {
    if (body[k] !== undefined) body[k] = Number(body[k]);
  });
  try {
    editId
      ? await apiFetch(`/api/inventory/${editId}`, { method:"PUT", body })
      : await apiFetch("/api/inventory", { method:"POST", body });
    toast(editId ? "Item updated" : "Item added", "success");
    closeModal("modal-inv");
    loadInventory();
  } catch (err) { toast(err.message, "error"); }
});

/* ── Analytics ────────────────────────────────────────────────────────────── */
async function loadAnalytics() {
  try {
    const data = await apiFetch("/api/analytics");
    const sb   = data.statusBreakdown;
    $("an-total").textContent    = data.totalOrders;
    $("an-value").textContent    = fmtMoney(data.totalValue);
    $("an-rate").textContent     = data.approvalRate + "%";
    $("an-suppliers").textContent= data.activeSuppliers;

    if (chartStatus) chartStatus.destroy();
    chartStatus = new Chart($("chart-status"), {
      type:"doughnut",
      data:{
        labels: STATUS_LABELS,
        datasets:[{ data:[sb.pending,sb.approved,sb.rejected,sb.shipped,sb.delivered,sb.cancelled],
          backgroundColor:["#f59e0b","#10b981","#ef4444","#06b6d4","#3b82f6","#64748b"],
          borderColor:"#243047", borderWidth:2 }]
      },
      options:{ plugins:{ legend:{ position:"right", labels:{ color:"#e2e8f0", boxWidth:12 } } }, cutout:"60%" }
    });

    const months = Object.keys(data.monthlyData).sort().slice(-8);
    if (chartMonthly) chartMonthly.destroy();
    chartMonthly = new Chart($("chart-monthly"), {
      type:"bar",
      data:{
        labels: months,
        datasets:[
          { label:"Orders", data:months.map(m=>data.monthlyData[m]?.count||0), backgroundColor:"#6366f180", borderColor:"#6366f1", borderWidth:1, yAxisID:"y" },
          { label:"Value ($)", data:months.map(m=>((data.monthlyData[m]?.value||0)/100).toFixed(0)), type:"line", borderColor:"#10b981", backgroundColor:"#10b98120", tension:.4, fill:true, yAxisID:"y1" }
        ]
      },
      options:{
        plugins:{ legend:{ labels:{ color:"#e2e8f0" } } },
        scales:{
          x: { ticks:{ color:"#94a3b8" }, grid:{ color:"#334155" } },
          y: { ticks:{ color:"#94a3b8" }, grid:{ color:"#334155" } },
          y1:{ position:"right", ticks:{ color:"#94a3b8" }, grid:{ drawOnChartArea:false } }
        }
      }
    });

    $("top-suppliers-body").innerHTML = data.topSuppliers.length
      ? data.topSuppliers.map((s,i) => `
          <tr>
            <td>${["🥇","🥈","🥉","4","5"][i]||i+1}</td>
            <td><strong>${s.name}</strong></td>
            <td>${s.count}</td>
            <td>${fmtMoney(s.value)}</td>
          </tr>`).join("")
      : `<tr><td colspan="4" class="text-muted">No data yet</td></tr>`;
  } catch (e) { toast("Analytics error: " + e.message, "error"); }
}

/* ── Blockchain ───────────────────────────────────────────────────────────── */
async function loadBlockchain() {
  try {
    const s = await apiFetch("/api/status");
    $("bc-status-panel").innerHTML = `
      <div class="bc-info-row"><span class="bc-info-key">Network</span>        <span class="bc-info-val">Hardhat Local (Chain ID: ${s.chainId})</span></div>
      <div class="bc-info-row"><span class="bc-info-key">Block Number</span>   <span class="bc-info-val">#${s.blockNumber}</span></div>
      <div class="bc-info-row"><span class="bc-info-key">Contract Address</span><span class="bc-info-val">${s.contractAddress}</span></div>
      <div class="bc-info-row"><span class="bc-info-key">Signer Wallet</span>  <span class="bc-info-val">${s.signerAddress}</span></div>
      <div class="bc-info-row"><span class="bc-info-key">Deployed At</span>    <span class="bc-info-val">${new Date(s.deployedAt).toLocaleString()}</span></div>
      <div class="bc-info-row"><span class="bc-info-key">Status</span>         <span class="badge badge-approved">● Connected</span></div>`;
  } catch {
    $("bc-status-panel").innerHTML = `<div class="bc-info-row" style="color:var(--danger)">⚠ Cannot connect to blockchain node</div>`;
  }

  try {
    const orders = await apiFetch("/api/orders");
    const rows   = [];
    orders.slice().reverse().slice(0,20).forEach(o => {
      Object.entries(o.txLog||{}).forEach(([action,hash]) => {
        rows.push({ action, orderId:o.id, supplier:o.supplierName, hash });
      });
    });
    $("bc-events-body").innerHTML = rows.length
      ? rows.slice(0,15).map(r => `
          <tr>
            <td><span class="badge badge-approved" style="text-transform:capitalize">${r.action}</span></td>
            <td>#${r.orderId}</td>
            <td>${r.supplier}</td>
            <td class="tx-hash">${r.hash}</td>
          </tr>`).join("")
      : `<tr><td colspan="4" class="text-muted">No blockchain events yet.</td></tr>`;
  } catch {}
}

async function lookupTx() {
  const hash = $("bc-tx-input").value.trim();
  if (!hash) { toast("Enter a transaction hash", "error"); return; }
  try {
    const data = await apiFetch(`/api/blockchain/tx/${hash}`);
    $("bc-tx-result").innerHTML = `
      <div class="card">
        <div class="card-header">Transaction Details</div>
        <div class="bc-info-list">
          <div class="bc-info-row"><span class="bc-info-key">Status</span>       <span class="badge badge-approved">${data.status}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">Block</span>        <span class="bc-info-val">#${data.blockNumber}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">Timestamp</span>    <span class="bc-info-val">${new Date(data.timestamp*1000).toLocaleString()}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">From</span>         <span class="bc-info-val">${data.from}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">To (Contract)</span><span class="bc-info-val">${data.to}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">Gas Used</span>     <span class="bc-info-val">${Number(data.gasUsed).toLocaleString()}</span></div>
          <div class="bc-info-row"><span class="bc-info-key">Confirmations</span><span class="bc-info-val">${data.confirmations}</span></div>
        </div>
      </div>`;
  } catch (e) {
    $("bc-tx-result").innerHTML = `<p style="color:var(--danger)">${e.message}</p>`;
  }
}

/* ── Users (admin only) ───────────────────────────────────────────────────── */
async function loadUsers() {
  try {
    allUsers = await apiFetch("/api/users");
    renderUsers();
  } catch (e) { toast("Failed to load users: " + e.message, "error"); }
}

function renderUsers() {
  const q    = ($("users-search").value || "").toLowerCase();
  const list = q
    ? allUsers.filter(u => u.name.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.role.toLowerCase().includes(q))
    : allUsers;

  const roleBadge = r => {
    const cls = { admin:"badge-rejected", manager:"badge-pending", supplier:"badge-approved" };
    return `<span class="badge ${cls[r]||""}">${r.charAt(0).toUpperCase()+r.slice(1)}</span>`;
  };

  $("users-body").innerHTML = list.length
    ? list.map(u => `
        <tr>
          <td>${u.id}</td>
          <td><strong>${u.name}</strong></td>
          <td class="mono">${u.username}</td>
          <td>${roleBadge(u.role)}</td>
          <td>${u.company || "–"}</td>
          <td><span class="badge ${u.status==="Active"?"badge-approved":"badge-cancelled"}">${u.status}</span></td>
          <td>${u.createdAt || "–"}</td>
          <td><div class="actions-col">
            <button class="btn btn-ghost btn-sm" onclick="editUser(${u.id})">Edit</button>
            ${u.id !== 1 ? `<button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})">Delete</button>` : ""}
          </div></td>
        </tr>`).join("")
    : `<tr><td colspan="8" class="text-muted p-sm">No users found.</td></tr>`;
}

$("users-search").addEventListener("input", renderUsers);

$("btn-add-user").addEventListener("click", () => {
  $("modal-user-title").textContent = "Add User";
  $("user-form").reset();
  delete $("user-form").dataset.editId;
  // Password required for new users
  $("user-form").password.required = true;
  $("company-field").style.display = "none";
  openModal("modal-user");
});

function toggleCompanyField() {
  const role = $("user-form-role").value;
  $("company-field").style.display = role === "supplier" ? "block" : "none";
  $("user-company").required = role === "supplier";
}

function editUser(id) {
  const u = allUsers.find(x => x.id === id);
  if (!u) return;
  $("modal-user-title").textContent = "Edit User";
  const f = $("user-form");
  f.dataset.editId = id;
  f.name.value    = u.name;
  f.username.value = u.username;
  f.password.value = "";
  f.password.required = false;
  f.role.value    = u.role;
  f.status.value  = u.status;
  toggleCompanyField();
  if (u.company) $("user-company").value = u.company;
  openModal("modal-user");
}

async function deleteUser(id) {
  if (!confirm("Delete this user account?")) return;
  try {
    await apiFetch(`/api/users/${id}`, { method:"DELETE" });
    toast("User deleted", "success");
    loadUsers();
  } catch (e) { toast(e.message, "error"); }
}

$("user-form").addEventListener("submit", async e => {
  e.preventDefault();
  const form   = e.target;
  const fd     = new FormData(form);
  const body   = Object.fromEntries(fd);
  const editId = form.dataset.editId;
  if (!body.password) delete body.password;

  const rules = [
    { el: form.name,     rules: [{ test: v => v.trim().length > 1,  msg: "Full name is required" }] },
    { el: form.username, rules: [
      { test: v => v.trim().length > 2,     msg: "Username must be at least 3 characters" },
      { test: v => /^[a-z0-9._]+$/i.test(v), msg: "Username: letters, numbers, . and _ only" }
    ]},
    { el: form.role,     rules: [{ test: v => v !== "",              msg: "Select a role" }] },
  ];
  if (!editId) {
    rules.push({ el: form.password, rules: [
      { test: v => v.length >= 6,   msg: "Password must be at least 6 characters" },
    ]});
  }
  if (!validateForm(rules)) return; // don't send empty password on edit
  try {
    editId
      ? await apiFetch(`/api/users/${editId}`, { method:"PUT", body })
      : await apiFetch("/api/users", { method:"POST", body });
    toast(editId ? "User updated" : "User created", "success");
    closeModal("modal-user");
    loadUsers();
  } catch (err) { toast(err.message, "error"); }
});

/* ── New Order button ────────────────────────────────────────────────────────*/
$("btn-new-order").addEventListener("click", async () => {
  if (!allSuppliers.length) allSuppliers = await apiFetch("/api/suppliers").catch(()=>[]);
  openCreateOrder();
});

/* ── Close modals on overlay click ──────────────────────────────────────────*/
document.querySelectorAll(".modal-overlay").forEach(overlay => {
  overlay.addEventListener("click", e => {
    if (e.target === overlay) overlay.style.display = "none";
  });
});

/* ── Notifications ───────────────────────────────────────────────────────── */
let notifList  = [];
let notifOpen  = false;

const NOTIF_ICONS = {
  "order:created":  "◼",
  "order:auto":     "◎",
  "order:approved": "✓",
  "order:rejected": "✕",
  "order:shipped":  "▶",
  "order:delivered":"◉"
};

function toggleNotifPanel() {
  notifOpen = !notifOpen;
  $("notif-panel").style.display = notifOpen ? "" : "none";
  if (notifOpen) {
    // mark all as read
    notifList.forEach(n => n.unread = false);
    renderNotifs();
    updateNotifBadge();
  }
}

function updateNotifBadge() {
  const unread = notifList.filter(n => n.unread).length;
  const badge  = $("notif-badge");
  if (unread > 0) {
    badge.style.display = "flex";
    badge.textContent   = unread > 9 ? "9+" : unread;
  } else {
    badge.style.display = "none";
  }
}

function renderNotifs() {
  const list = $("notif-list");
  if (!notifList.length) {
    list.innerHTML = `<p class="text-muted p-sm" style="font-size:13px">No notifications yet</p>`;
    return;
  }
  list.innerHTML = notifList.slice(0, 20).map(n => `
    <div class="notif-item ${n.unread ? "unread" : ""}" onclick="handleNotifClick(${n.orderId})">
      <span class="notif-icon">${NOTIF_ICONS[n.type] || "🔔"}</span>
      <div>
        <div class="notif-msg">${n.message}</div>
        <div class="notif-time">${timeSince(n.ts)}</div>
      </div>
    </div>`).join("");
}

function handleNotifClick(orderId) {
  toggleNotifPanel();
  if (orderId) {
    navigate("orders");
    setTimeout(() => viewOrder(orderId), 400);
  }
}

function clearNotifs() {
  notifList = [];
  renderNotifs();
  updateNotifBadge();
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return `${Math.floor(s/60)}m ago`;
  return `${Math.floor(s/3600)}h ago`;
}

function pushNotif(type, data) {
  const n = { type, message: data.message, orderId: data.orderId, ts: Date.now(), unread: true };
  notifList.unshift(n);
  updateNotifBadge();
  if (notifOpen) renderNotifs();
  // Also show toast
  const toastType = type.includes("reject") ? "error" : type.includes("ship") || type.includes("auto") ? "info" : "success";
  toast(data.message, toastType);
  // Refresh dashboard if visible
  if ($("page-dashboard").classList.contains("active")) loadDashboard();
  if ($("page-orders").classList.contains("active"))    loadOrders();
}

function connectSSE() {
  const token = getToken();
  if (!token) return;
  const es = new EventSource(`/api/notifications/stream?token=${encodeURIComponent(token)}`);

  es.addEventListener("connected", () => console.log("🔔 SSE connected"));

  ["order:created","order:auto","order:approved","order:rejected","order:shipped","order:delivered"].forEach(evt => {
    es.addEventListener(evt, e => {
      const data = JSON.parse(e.data);
      pushNotif(evt, data);
    });
  });

  es.onerror = () => {
    es.close();
    // Reconnect after 5s
    setTimeout(connectSSE, 5000);
  };
}

// Close notif panel when clicking outside
document.addEventListener("click", e => {
  if (notifOpen && !$("notif-wrap").contains(e.target)) {
    notifOpen = false;
    $("notif-panel").style.display = "none";
  }
});

/* ── Theme toggle ────────────────────────────────────────────────────────── */
function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("sx_theme", theme);
  const btn = $("theme-toggle");
  if (btn) btn.title = theme === "light" ? "Switch to dark mode" : "Switch to light mode";
}

$("theme-toggle").addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  applyTheme(current === "light" ? "dark" : "light");
});

/* ── Boot ────────────────────────────────────────────────────────────────── */
(async () => {
  // Apply saved theme
  applyTheme(localStorage.getItem("sx_theme") || "dark");

  setupRoleUI();
  await checkChainStatus();
  setInterval(checkChainStatus, 15000);
  loadDashboard();
  apiFetch("/api/suppliers").then(d => { allSuppliers = d; }).catch(()=>{});
  connectSSE();
})();
