import type { NextConfig } from "next";

// Strip console calls from production bundles to prevent information
// disclosure (data counts, internal state, auth flow). Keeps `error`
// and `warn` so real issues stay visible in Vercel logs and the
// browser console for monitoring.
// Only affects production builds (`next build`); dev keeps full logs.
const nextConfig: NextConfig = {
  compiler: {
    removeConsole: { exclude: ["error", "warn"] },
  },
};

export default nextConfig;
