require("dotenv").config();
const express    = require("express");
const cors       = require("cors");
const path       = require("path");
const fs         = require("fs");
const crypto     = require("crypto");
const { ethers } = require("ethers");

const app  = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = !!process.env.BLOCKCHAIN_RPC_URL;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "../public")));

// ── Token helpers ─────────────────────────────────────────────────────────────
const TOKEN_SECRET = process.env.TOKEN_SECRET || "smartx-dev-secret-2026";
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

function signToken(payload) {
  payload.exp = Date.now() + TOKEN_TTL_MS;
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig  = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

function verifyToken(token) {
  if (!token) throw new Error("No token");
  const [data, sig] = token.split(".");
  const expected = crypto.createHmac("sha256", TOKEN_SECRET).update(data).digest("base64url");
  if (sig !== expected) throw new Error("Invalid token");
  const payload = JSON.parse(Buffer.from(data, "base64url").toString());
  if (Date.now() > payload.exp) throw new Error("Token expired");
  return payload;
}

// ── Users ─────────────────────────────────────────────────────────────────────
let users = [
  { id:1, username:"sudip",   password:"Sudip@123",   name:"Sudip Basnet",      role:"admin",    company:null,                    status:"Active", createdAt:"2026-01-01" },
  { id:2, username:"rohit",   password:"Rohit@123",   name:"Rohit Shah",        role:"manager",  company:null,                    status:"Active", createdAt:"2026-01-01" },
  { id:3, username:"awash",   password:"Awash@123",   name:"Awash Poudel",      role:"supplier", company:"Ingram Micro Australia", status:"Active", createdAt:"2026-01-01" },
  { id:4, username:"samir",   password:"Samir@123",   name:"Samir Simkhada",    role:"supplier", company:"Dicker Data",           status:"Active", createdAt:"2026-01-01" },
  { id:5, username:"sandesh", password:"Sandesh@123", name:"Sandesh Bhattarai", role:"supplier", company:"Synnex Australia",      status:"Active", createdAt:"2026-01-01" },
];
let userIdCounter = 6;

// ── Auth middleware ───────────────────────────────────────────────────────────
function authMiddleware(req, res, next) {
  const header = req.headers.authorization || "";
  const token  = header.startsWith("Bearer ") ? header.slice(7) : null;
  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: "Unauthorised. Please log in." });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: `Access denied. Required role: ${roles.join(" or ")}` });
    next();
  };
}

// ── Blockchain setup ──────────────────────────────────────────────────────────
let contractMeta, contractABI;
try {
  // ABI: always read from committed file
  contractABI = JSON.parse(fs.readFileSync(path.join(__dirname, "contract-abi.json"), "utf8"));

  // Contract address: env var (production) or generated file (local)
  if (process.env.CONTRACT_ADDRESS) {
    contractMeta = { address: process.env.CONTRACT_ADDRESS, deployedAt: process.env.DEPLOYED_AT || new Date().toISOString() };
    console.log(`\n⛓  Production mode — Sepolia testnet`);
  } else {
    contractMeta = require("./contract-address.json");
    console.log(`\n⛓  Development mode — local Hardhat`);
  }
} catch (e) {
  console.error("\n❌  Setup error:", e.message);
  console.error("   Local: npx hardhat node → npx hardhat run scripts/deploy.js --network localhost");
  console.error("   Production: set CONTRACT_ADDRESS env var\n");
  process.exit(1);
}

// RPC: Alchemy/Infura URL in production, local Hardhat in dev
const RPC_URL = process.env.BLOCKCHAIN_RPC_URL || "http://127.0.0.1:8545";
const provider = new ethers.JsonRpcProvider(RPC_URL);
let signer, contract;

async function initBlockchain() {
  if (process.env.DEPLOYER_PRIVATE_KEY) {
    // Production: sign with real wallet private key
    signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);
  } else {
    // Development: use Hardhat account 0
    signer = await provider.getSigner(0);
  }
  contract = new ethers.Contract(contractMeta.address, contractABI, signer);
  console.log(`   Contract : ${contractMeta.address}`);
  console.log(`   Signer   : ${await signer.getAddress()}`);
  console.log(`   Network  : ${IS_PROD ? "Sepolia testnet" : "localhost:8545"}\n`);
}

// ── In-memory stores ──────────────────────────────────────────────────────────
const suppliers = [
  {
    id:1, name:"Ingram Micro Australia",
    contact:"Awash Poudel",         email:"au.sales@ingrammicro.com",
    phone:"+61 7 3860 8000",        address:"2 Holt St, Pinkenba QLD 4008",
    category:"IT Distribution",     rating:4.6, status:"Active",
    abn:"12 004 111 395",           website:"ingrammicro.com/en-au"
  },
  {
    id:2, name:"Dicker Data",
    contact:"Samir Simkhada",       email:"accounts@dickerdata.com.au",
    phone:"+61 2 9541 5000",        address:"230 Captain Cook Drive, Kurnell NSW 2231",
    category:"IT Distribution",     rating:4.4, status:"Active",
    abn:"56 010 283 186",           website:"dickerdata.com.au"
  },
  {
    id:3, name:"Synnex Australia",
    contact:"Sandesh Bhattarai",    email:"info@synnex.com.au",
    phone:"+61 2 8875 5000",        address:"1 James Place, North Ryde NSW 2113",
    category:"IT Distribution",     rating:4.3, status:"Active",
    abn:"39 063 910 894",           website:"synnex.com.au"
  },
];
let supplierIdCounter = 4;

const inventory = [
  { id:1, name:"DDR4 Laptop RAM 8GB",         sku:"RAM-DDR4-8",   currentStock:3,  minThreshold:10, reorderQty:20,  unit:"units", unitCost:4500,  supplierId:1, category:"Memory",       location:"Parts Cabinet A" },
  { id:2, name:"256GB NVMe SSD M.2",           sku:"SSD-256-M2",   currentStock:9,  minThreshold:5,  reorderQty:15,  unit:"units", unitCost:8000,  supplierId:1, category:"Storage",      location:"Parts Cabinet A" },
  { id:3, name:"CMOS Battery CR2032",           sku:"BAT-CR2032",   currentStock:55, minThreshold:20, reorderQty:100, unit:"units", unitCost:150,   supplierId:1, category:"Batteries",    location:"Parts Cabinet B" },
  { id:4, name:"Thermal Paste 10g",             sku:"THM-10G",      currentStock:4,  minThreshold:10, reorderQty:20,  unit:"tubes", unitCost:800,   supplierId:1, category:"Consumables",  location:"Workshop Shelf"  },
  { id:5, name:"Laptop LCD Screen 15.6\" FHD",  sku:"LCD-156-FHD",  currentStock:2,  minThreshold:5,  reorderQty:10,  unit:"units", unitCost:25000, supplierId:2, category:"Displays",     location:"Parts Cabinet C" },
  { id:6, name:"USB-C Power Adapter 65W",       sku:"PWR-USBC-65",  currentStock:14, minThreshold:8,  reorderQty:15,  unit:"units", unitCost:6500,  supplierId:2, category:"Power",        location:"Parts Cabinet C" },
  { id:7, name:"Cat6 Ethernet Cable 2m",        sku:"CAB-CAT6-2",   currentStock:30, minThreshold:15, reorderQty:50,  unit:"units", unitCost:500,   supplierId:2, category:"Networking",   location:"Workshop Shelf"  },
  { id:8, name:"Laptop Keyboard (Universal)",   sku:"KBD-UNIV",     currentStock:3,  minThreshold:8,  reorderQty:15,  unit:"units", unitCost:4000,  supplierId:2, category:"Input Devices", location:"Parts Cabinet B" },
];
let inventoryIdCounter = 9;

const txLog = {};
const autoPOActive = new Set();
const autoPOLog    = [];

// ── SSE Notification hub ──────────────────────────────────────────────────────
// Map: userId → { res, role, name, company }
const sseClients = new Map();

function sseNotify(targetRoles, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of sseClients) {
    if (targetRoles.includes(client.role)) {
      try { client.res.write(msg); } catch {}
    }
  }
}
function sseNotifyCompany(company, event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const [, client] of sseClients) {
    if (client.role === "supplier" && client.company === company) {
      try { client.res.write(msg); } catch {}
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function parseOrder(raw, items, id) {
  const [orderId, creator, supplierName, supplierAddr, totalAmount,
         status, notes, createdAt, updatedAt, expectedDelivery, itemCount] = raw;
  return {
    id: Number(orderId), creator, supplierName, supplierAddress: supplierAddr,
    totalAmount: Number(totalAmount), status: Number(status), notes,
    createdAt: Number(createdAt), updatedAt: Number(updatedAt),
    expectedDelivery: Number(expectedDelivery), itemCount: Number(itemCount),
    items: items ? items[0].map((name, i) => ({
      name, quantity: Number(items[1][i]), unitPrice: Number(items[2][i])
    })) : [],
    txLog: txLog[id] || {},
    isAutoGenerated: (txLog[id] && txLog[id].autoGenerated) || false
  };
}

async function createOrderOnChain(supplierName, supplierAddr, items, notes, deliveryDays = 7) {
  const names    = items.map(i => i.name);
  const qtys     = items.map(i => BigInt(Math.max(1, i.quantity)));
  const prices   = items.map(i => BigInt(Math.round(i.unitPrice)));
  const delivery = BigInt(Math.floor((Date.now() + deliveryDays * 86400000) / 1000));

  const tx      = await contract.createOrder(supplierName, supplierAddr || "", names, qtys, prices, notes, delivery);
  const receipt = await tx.wait();

  let orderId = Number(await contract.getOrderCount());
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "OrderCreated") { orderId = Number(parsed.args[0]); break; }
    } catch {}
  }
  return { orderId, txHash: tx.hash, blockNumber: receipt.blockNumber };
}

// ── Auto-PO Generation ────────────────────────────────────────────────────────
async function autoGeneratePOs() {
  const lowItems = inventory.filter(i => i.currentStock <= i.minThreshold && !autoPOActive.has(i.id));
  if (!lowItems.length) return;

  console.log(`\n🤖 Auto-PO check: ${lowItems.length} low-stock item(s) found`);

  // Group low-stock items by supplier to batch into single POs
  const bySupplier = {};
  for (const item of lowItems) {
    const sup = suppliers.find(s => s.id === item.supplierId);
    if (!sup) continue;
    if (!bySupplier[sup.id]) bySupplier[sup.id] = { supplier: sup, items: [] };
    bySupplier[sup.id].items.push(item);
  }

  for (const { supplier, items } of Object.values(bySupplier)) {
    const poItems = items.map(i => ({
      name:      i.name,
      quantity:  i.reorderQty || i.minThreshold * 2,
      unitPrice: i.unitCost || 100
    }));
    const itemNames = items.map(i => i.name).join(", ");
    const notes = `🤖 AUTO-GENERATED: Low stock alert for [${itemNames}]. Reorder quantities applied automatically.`;

    try {
      const { orderId, txHash } = await createOrderOnChain(supplier.name, supplier.address, poItems, notes, 7);
      txLog[orderId] = { created: txHash, autoGenerated: true };

      items.forEach(i => autoPOActive.add(i.id));

      const entry = {
        orderId, supplierName: supplier.name,
        items: itemNames, txHash,
        createdAt: new Date().toISOString()
      };
      autoPOLog.unshift(entry);
      if (autoPOLog.length > 20) autoPOLog.pop();

      console.log(`   ✅ Auto-PO #${orderId} → ${supplier.name} for: ${itemNames} (tx: ${txHash.slice(0,12)}…)`);

      // Notify admins + managers of auto-generated PO
      sseNotify(["admin","manager"], "order:auto", {
        orderId, supplierName: supplier.name,
        message: `🤖 Auto-PO #${orderId} created for ${supplier.name} — low stock detected (${itemNames})`
      });
    } catch (e) {
      console.error(`   ❌ Auto-PO failed for ${supplier.name}: ${e.message}`);
    }
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// UNPROTECTED
// ══════════════════════════════════════════════════════════════════════════════

// SSE stream — token via query param (EventSource can't set headers)
app.get("/api/notifications/stream", (req, res) => {
  let user;
  try { user = verifyToken(req.query.token); } catch {
    return res.status(401).end();
  }
  res.setHeader("Content-Type",  "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection",    "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  const client = { res, role: user.role, name: user.name, company: user.company };
  sseClients.set(user.id, client);

  // Initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ message: "Connected to SmartX notifications" })}\n\n`);

  // Heartbeat every 25s to keep connection alive
  const hb = setInterval(() => { try { res.write(":heartbeat\n\n"); } catch {} }, 25000);

  req.on("close", () => { clearInterval(hb); sseClients.delete(user.id); });
});

app.post("/api/auth/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: "Username and password required" });
  const user = users.find(u => u.username === username && u.status === "Active");
  if (!user || user.password !== password) return res.status(401).json({ error: "Invalid username or password" });
  const token = signToken({ id: user.id, username: user.username, name: user.name, role: user.role, company: user.company });
  res.json({ token, user: { id: user.id, username: user.username, name: user.name, role: user.role, company: user.company } });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROTECTED
// ══════════════════════════════════════════════════════════════════════════════
app.use("/api", authMiddleware);

app.get("/api/auth/me", (req, res) => {
  const user = users.find(u => u.id === req.user.id);
  if (!user) return res.status(404).json({ error: "Not found" });
  const { password: _, ...safe } = user;
  res.json(safe);
});

// ── Status ────────────────────────────────────────────────────────────────────
app.get("/api/status", async (req, res) => {
  try {
    const blockNumber   = await provider.getBlockNumber();
    const signerAddress = await signer.getAddress();
    const network       = await provider.getNetwork();
    res.json({ ok: true, blockNumber, signerAddress, contractAddress: contractMeta.address, chainId: Number(network.chainId), deployedAt: contractMeta.deployedAt });
  } catch (e) { res.status(503).json({ ok: false, error: e.message }); }
});

// ── Purchase Orders ───────────────────────────────────────────────────────────
app.get("/api/orders", async (req, res) => {
  try {
    const count = Number(await contract.getOrderCount());
    let orders  = [];
    for (let i = 1; i <= count; i++) {
      try {
        const raw   = await contract.getOrder(i);
        const items = await contract.getOrderItems(i);
        orders.push(parseOrder(raw, items, i));
      } catch {}
    }
    // Supplier sees only their company's orders
    if (req.user.role === "supplier") orders = orders.filter(o => o.supplierName === req.user.company);
    // User sees only orders they created (by wallet address — here all, as there's one signer)
    if (req.query.status !== undefined) orders = orders.filter(o => o.status === parseInt(req.query.status));
    res.json(orders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/orders/:id", async (req, res) => {
  try {
    const id    = parseInt(req.params.id);
    const raw   = await contract.getOrder(id);
    const items = await contract.getOrderItems(id);
    const order = parseOrder(raw, items, id);
    if (req.user.role === "supplier" && order.supplierName !== req.user.company)
      return res.status(403).json({ error: "Access denied" });
    res.json(order);
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// Only admin and user (requester) can CREATE orders
app.post("/api/orders", requireRole("admin", "user"), async (req, res) => {
  try {
    const { supplierName, supplierAddress, items, notes, expectedDelivery } = req.body;
    if (!supplierName)           return res.status(400).json({ error: "supplierName required" });
    if (!items || !items.length) return res.status(400).json({ error: "At least one item required" });

    const poItems = items.map(i => ({
      name: i.name,
      quantity: Math.max(1, parseInt(i.quantity)),
      unitPrice: Math.round(parseFloat(i.unitPrice) * 100) / 100
    }));

    const delivery = expectedDelivery ? BigInt(Math.floor(new Date(expectedDelivery).getTime() / 1000)) : BigInt(0);
    const names    = poItems.map(i => i.name);
    const qtys     = poItems.map(i => BigInt(i.quantity));
    const prices   = poItems.map(i => BigInt(Math.round(i.unitPrice)));

    const tx      = await contract.createOrder(supplierName, supplierAddress || "", names, qtys, prices, notes || "", delivery);
    const receipt = await tx.wait();

    let orderId = Number(await contract.getOrderCount());
    for (const log of receipt.logs) {
      try {
        const parsed = contract.interface.parseLog(log);
        if (parsed?.name === "OrderCreated") { orderId = Number(parsed.args[0]); break; }
      } catch {}
    }
    txLog[orderId] = { created: tx.hash };

    // Notify managers + admin: new PO submitted
    sseNotify(["admin","manager"], "order:created", {
      orderId, supplierName: body.supplierName,
      message: `📋 New PO #${orderId} submitted for ${body.supplierName}`,
      createdBy: req.user.name
    });

    res.json({ success: true, orderId, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put("/api/orders/:id/status", async (req, res) => {
  try {
    const id     = parseInt(req.params.id);
    const action = req.body.action;
    const role   = req.user.role;

    // Permission matrix per action
    const actionRoles = {
      approve: ["admin", "manager"],
      reject:  ["admin", "manager"],
      deliver: ["admin", "manager"],
      cancel:  ["admin", "manager"],
      ship:    ["admin", "supplier"]
    };
    if (!actionRoles[action]) return res.status(400).json({ error: `Invalid action: ${action}` });
    if (!actionRoles[action].includes(role)) return res.status(403).json({ error: `Your role cannot perform: ${action}` });

    // Supplier can only ship their own company's orders
    if (role === "supplier") {
      const raw = await contract.getOrder(id);
      if (raw[2] !== req.user.company) return res.status(403).json({ error: "Access denied: not your order" });
    }

    const statusMap = { approve:1, reject:2, ship:3, deliver:4, cancel:5 };
    const tx      = await contract.updateStatus(id, statusMap[action]);
    const receipt = await tx.wait();

    if (!txLog[id]) txLog[id] = {};
    txLog[id][action] = tx.hash;

    // ── Role-aware notifications ─────────────────────────────────────
    const orderRaw = await contract.getOrder(id);
    const supplierName = orderRaw[2];
    if (action === "approve") {
      // Notify the supplier for this company
      sseNotifyCompany(supplierName, "order:approved", {
        orderId: id, supplierName,
        message: `✅ PO #${id} has been approved — please arrange shipment`
      });
      // Also notify admin
      sseNotify(["admin"], "order:approved", {
        orderId: id, supplierName,
        message: `✅ PO #${id} approved by ${req.user.name}`
      });
    } else if (action === "reject") {
      sseNotify(["admin"], "order:rejected", {
        orderId: id, supplierName,
        message: `❌ PO #${id} rejected by ${req.user.name}`
      });
    } else if (action === "ship") {
      sseNotify(["admin","manager"], "order:shipped", {
        orderId: id, supplierName,
        message: `🚚 PO #${id} marked as shipped by ${supplierName}`
      });
    } else if (action === "deliver") {
      sseNotify(["admin"], "order:delivered", {
        orderId: id, supplierName,
        message: `📦 PO #${id} delivered — order complete`
      });
    }

    // When order is delivered, free up autoPO tracking for those items
    if (action === "deliver") {
      const raw   = await contract.getOrder(id);
      const items = await contract.getOrderItems(id);
      const order = parseOrder(raw, items, id);
      // Re-enable auto-PO tracking for items in this order
      inventory.forEach(i => {
        if (order.items.some(oi => oi.name === i.name)) autoPOActive.delete(i.id);
      });
    }

    res.json({ success: true, txHash: tx.hash, blockNumber: receipt.blockNumber });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Auto-PO endpoints ─────────────────────────────────────────────────────────
// Manual trigger (admin only)
app.post("/api/orders/auto-check", requireRole("admin"), async (req, res) => {
  try {
    await autoGeneratePOs();
    res.json({ success: true, log: autoPOLog.slice(0, 5) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/orders/auto-log", requireRole("admin", "manager"), (req, res) => {
  res.json(autoPOLog);
});

// ── Credential helpers ────────────────────────────────────────────────────────
function generateUsername(companyName) {
  // e.g. "Acme Corp Australia" → "acmecorp" + 2-digit number
  const base = companyName
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .slice(0, 2)
    .join("");
  const suffix = String(Math.floor(Math.random() * 90) + 10);
  // Ensure unique
  let username = base + suffix;
  while (users.find(u => u.username === username)) {
    username = base + String(Math.floor(Math.random() * 900) + 100);
  }
  return username;
}

function generatePassword() {
  const upper  = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower  = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const special = "@#$!";
  const pool = lower + lower + digits + upper + special;
  let pwd = upper[Math.floor(Math.random() * upper.length)]
          + digits[Math.floor(Math.random() * digits.length)];
  for (let i = 0; i < 6; i++) pwd += pool[Math.floor(Math.random() * pool.length)];
  // Shuffle
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}

// ── Suppliers ─────────────────────────────────────────────────────────────────
app.get("/api/suppliers", (req, res) => res.json(suppliers));

app.post("/api/suppliers", requireRole("admin"), (req, res) => {
  const { name, contact, email, phone, address, category, abn, website } = req.body;
  if (!name) return res.status(400).json({ error: "name required" });

  const s = { id: supplierIdCounter++, name, contact, email, phone, address, category, abn, website, rating: 0, status: "Active" };
  suppliers.push(s);

  // Auto-create supplier login account
  const username = generateUsername(name);
  const password = generatePassword();
  const u = {
    id: userIdCounter++,
    username, password,
    name: contact || name,
    role: "supplier",
    company: name,
    status: "Active",
    createdAt: new Date().toISOString().slice(0, 10)
  };
  users.push(u);

  console.log(`\n🔑 Auto-created supplier account: ${username} / ${password} → ${name}`);

  res.json({
    supplier: s,
    credentials: { username, password, name: u.name, company: name, role: "supplier" }
  });
});

app.put("/api/suppliers/:id", requireRole("admin"), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = suppliers.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  suppliers[idx] = { ...suppliers[idx], ...req.body, id };
  res.json(suppliers[idx]);
});

app.delete("/api/suppliers/:id", requireRole("admin"), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = suppliers.findIndex(s => s.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  suppliers.splice(idx, 1);
  res.json({ success: true });
});

// ── Inventory ─────────────────────────────────────────────────────────────────
app.get("/api/inventory",        requireRole("admin","manager"), (req, res) => res.json(inventory));
app.get("/api/inventory/alerts", requireRole("admin","manager"), (req, res) => res.json(inventory.filter(i => i.currentStock <= i.minThreshold)));

app.post("/api/inventory", requireRole("admin"), (req, res) => {
  const item = { id: inventoryIdCounter++, currentStock: 0, ...req.body };
  inventory.push(item);
  res.json(item);
});

app.put("/api/inventory/:id", requireRole("admin","manager"), async (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = inventory.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });

  const prev = { ...inventory[idx] };
  inventory[idx] = { ...inventory[idx], ...req.body, id };
  const updated = inventory[idx];

  // If stock was restocked above threshold, release auto-PO lock
  if (prev.currentStock <= prev.minThreshold && updated.currentStock > updated.minThreshold) {
    autoPOActive.delete(id);
    console.log(`   ♻  Inventory restocked: ${updated.name} (auto-PO lock released)`);
  }

  // If stock just dropped to or below threshold, trigger auto-PO
  if (updated.currentStock <= updated.minThreshold && !autoPOActive.has(id)) {
    console.log(`\n⚠  Low stock detected on update: ${updated.name}`);
    setTimeout(autoGeneratePOs, 1000);
  }

  res.json(updated);
});

app.delete("/api/inventory/:id", requireRole("admin"), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = inventory.findIndex(i => i.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  inventory.splice(idx, 1);
  autoPOActive.delete(id);
  res.json({ success: true });
});

// ── Analytics ─────────────────────────────────────────────────────────────────
app.get("/api/analytics", requireRole("admin","manager"), async (req, res) => {
  try {
    const count       = Number(await contract.getOrderCount());
    const statusTally = [0,0,0,0,0,0];
    let   totalValue  = 0;
    const monthly     = {};
    const supplierMap = {};
    let   autoPOCount = 0;

    for (let i = 1; i <= count; i++) {
      try {
        const raw = await contract.getOrder(i);
        const [,, supplierName,, totalAmount, status,, createdAt] = raw;
        const s = Number(status), v = Number(totalAmount), t = Number(createdAt);
        statusTally[s]++;
        totalValue += v;
        if (txLog[i]?.autoGenerated) autoPOCount++;
        const dt  = new Date(t * 1000);
        const key = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,"0")}`;
        if (!monthly[key]) monthly[key] = { count:0, value:0 };
        monthly[key].count++; monthly[key].value += v;
        if (!supplierMap[supplierName]) supplierMap[supplierName] = { count:0, value:0 };
        supplierMap[supplierName].count++; supplierMap[supplierName].value += v;
      } catch {}
    }
    const [pending,approved,rejected,shipped,delivered,cancelled] = statusTally;
    res.json({
      totalOrders: count, totalValue, autoPOCount,
      approvalRate: count > 0 ? +(((approved+shipped+delivered)/count)*100).toFixed(1) : 0,
      statusBreakdown: { pending,approved,rejected,shipped,delivered,cancelled },
      monthlyData: monthly,
      topSuppliers: Object.entries(supplierMap).sort((a,b)=>b[1].value-a[1].value).slice(0,5).map(([name,d])=>({name,...d})),
      inventoryAlerts: inventory.filter(i=>i.currentStock<=i.minThreshold).length,
      activeSuppliers: suppliers.filter(s=>s.status==="Active").length
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Blockchain explorer ───────────────────────────────────────────────────────
app.get("/api/blockchain/tx/:hash", requireRole("admin","manager"), async (req, res) => {
  try {
    const [tx, receipt] = await Promise.all([
      provider.getTransaction(req.params.hash),
      provider.getTransactionReceipt(req.params.hash)
    ]);
    const block = await provider.getBlock(receipt.blockNumber);
    res.json({
      hash: tx.hash, from: tx.from, to: tx.to,
      blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? "Success" : "Failed",
      timestamp: Number(block.timestamp),
      confirmations: (await provider.getBlockNumber()) - receipt.blockNumber
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Users (admin only) ────────────────────────────────────────────────────────
app.get("/api/users", requireRole("admin"), (req, res) => {
  res.json(users.map(({ password:_, ...u }) => u));
});

app.post("/api/users", requireRole("admin"), (req, res) => {
  const { username, password, name, role, company } = req.body;
  if (!username || !password || !name || !role) return res.status(400).json({ error: "Missing required fields" });
  if (users.find(u => u.username === username)) return res.status(400).json({ error: "Username already exists" });
  const u = { id: userIdCounter++, username, password, name, role, company: company||null, status:"Active", createdAt: new Date().toISOString().slice(0,10) };
  users.push(u);
  const { password:_, ...safe } = u;
  res.json(safe);
});

app.put("/api/users/:id", requireRole("admin"), (req, res) => {
  const id  = parseInt(req.params.id);
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  users[idx] = { ...users[idx], ...req.body, id };
  const { password:_, ...safe } = users[idx];
  res.json(safe);
});

app.delete("/api/users/:id", requireRole("admin"), (req, res) => {
  const id  = parseInt(req.params.id);
  if (id === 1) return res.status(400).json({ error: "Cannot delete the system admin" });
  const idx = users.findIndex(u => u.id === id);
  if (idx === -1) return res.status(404).json({ error: "Not found" });
  users.splice(idx, 1);
  res.json({ success: true });
});

// ── Start ─────────────────────────────────────────────────────────────────────
initBlockchain().then(() => {
  // Run auto-PO check every 2 minutes
  setInterval(autoGeneratePOs, 120000);
  // Initial check after 10 seconds
  setTimeout(autoGeneratePOs, 10000);

  app.listen(PORT, () => console.log(`✅ Server → http://localhost:${PORT}\n`));
}).catch(err => {
  console.error("Blockchain error:", err.message);
  process.exit(1);
});
