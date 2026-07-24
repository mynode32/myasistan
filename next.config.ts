import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root to this project. Without this, Next.js
  // auto-detects a stray package-lock.json elsewhere on disk (e.g.
  // C:\Users\<user>\package-lock.json) and picks the wrong root.
  outputFileTracingRoot: path.resolve(__dirname),
};

export default nextConfig;
