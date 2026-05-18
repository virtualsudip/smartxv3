# SmartXX — Automated Purchase Order Management System
### With Ethereum Blockchain Integration | WADEIN IT Solutions

## Quick Start (3 terminals)

### Terminal 1 — Install & compile
```bash
cd SmartXX
npm install
npm run compile
```

### Terminal 2 — Start local blockchain node
```bash
npm run chain
# Keep this running. Note the private keys printed — they are test accounts.
```

### Terminal 3 — Deploy contract + start server
```bash
npm run deploy          # deploys smart contract, saves address
npm run server          # starts Express server on http://localhost:3000
```

Then open **http://localhost:3000** in your browser.

---

## Features

| Module | Description |
|--------|-------------|
| **Dashboard** | KPI cards, recent POs, low-stock alerts |
| **Purchase Orders** | Create, approve, reject, ship, deliver — all recorded on-chain |
| **Suppliers** | Supplier directory with categories, contacts, ratings |
| **Inventory** | Stock levels with threshold warnings and reorder tracking |
| **Analytics** | Status breakdown (pie), monthly volume (bar), top suppliers |
| **Blockchain** | Live network status, transaction lookup, audit trail |

## PO Lifecycle (Smart Contract)

```
[Pending] → Approve → [Approved] → Ship → [Shipped] → Deliver → [Delivered]
[Pending] → Reject  → [Rejected]
[Pending|Approved] → Cancel → [Cancelled]
```

Every status change is a blockchain transaction with a hash recorded for audit.

## Tech Stack

- **Solidity 0.8.24** — `PurchaseOrderManager.sol`
- **Hardhat** — local EVM node + compile + deploy
- **ethers.js v6** — blockchain interaction
- **Node.js + Express** — REST API
- **Vanilla HTML/CSS/JS** — no framework frontend
- **Chart.js** — analytics charts

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Blockchain connection health |
| GET | `/api/orders` | All purchase orders |
| POST | `/api/orders` | Create new PO (on-chain) |
| GET | `/api/orders/:id` | Single PO with audit trail |
| PUT | `/api/orders/:id/status` | Update status (on-chain) |
| GET | `/api/suppliers` | Supplier list |
| POST | `/api/suppliers` | Add supplier |
| GET | `/api/inventory` | Inventory items |
| GET | `/api/inventory/alerts` | Low-stock items |
| GET | `/api/analytics` | Aggregated KPIs |
| GET | `/api/blockchain/tx/:hash` | Transaction details |
