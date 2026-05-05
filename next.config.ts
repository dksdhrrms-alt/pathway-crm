import type { NextConfig } from "next";
import path from "path";

// Strip console calls from production bundles to prevent information
// disclosure (data counts, internal state, auth flow). Keeps `error`
// and `warn` so real issues stay visible in Vercel logs and the
// browser console for monitoring.
// Only affects production builds (`next build`); dev keeps full logs.
const nextConfig: NextConfig = {
  // Pin Turbopack's workspace root. Without this, Next walks up looking
  // for a lockfile and on Windows paths with spaces/Korean chars it has
  // resolved to the parent dir, breaking `@import "tailwindcss"` in dev.
  turbopack: {
    root: path.resolve("."),
  },
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
};

export default nextConfig;
