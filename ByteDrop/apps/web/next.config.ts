import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const config = {
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { optimizePackageImports: ["lucide-react", "recharts"] },
  // Keep the dev server from adding generated helper files to the repository.
  agentRules: false,
} as NextConfig;

export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "1" })(config);
