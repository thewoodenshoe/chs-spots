import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure Turbopack resolves from the project root, not a parent directory
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
