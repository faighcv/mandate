import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["node:sqlite"],
  devIndicators: false,
  agentRules: false,
};

export default config;
