import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const LegacyVaultModule = buildModule("LegacyVaultModule", (m) => {
  // Deploy the DocumentVault contract
  const LegacyVault = m.contract("LegacyVault");

  return { LegacyVault };
});

export default LegacyVaultModule;
