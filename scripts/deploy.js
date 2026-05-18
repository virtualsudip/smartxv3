const hre = require("hardhat");
const fs  = require("fs");
const path = require("path");

async function main() {
  console.log("\n🚀 Deploying PurchaseOrderManager to local Hardhat network...\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log(`   Deployer address : ${deployer.address}`);

  const Factory  = await hre.ethers.getContractFactory("PurchaseOrderManager");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log(`   Contract address : ${address}`);

  // Persist address so the server can load it at startup
  const out = {
    address,
    network:    "localhost",
    deployer:   deployer.address,
    deployedAt: new Date().toISOString()
  };

  const serverDir = path.join(__dirname, "../server");
  if (!fs.existsSync(serverDir)) fs.mkdirSync(serverDir, { recursive: true });

  fs.writeFileSync(
    path.join(serverDir, "contract-address.json"),
    JSON.stringify(out, null, 2)
  );

  console.log("\n✅ contract-address.json saved to server/\n");
  console.log("   Next step → node server/index.js\n");
}

main().catch(err => { console.error(err); process.exit(1); });
