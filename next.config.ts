import type { NextConfig } from "next";

// Security headers for the panel and the privacy pages. tracker.js and
// /api/collect are called from the clients' landing pages, so they keep only
// the headers that do not affect cross-site use.
const common = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  // Netlify sometimes forwards a request under the deploy's own address
  // (x-forwarded-host) while the browser is on cadeolead.com.br; without this,
  // Next.js refuses the action as cross-site. Only our own addresses.
  experimental: {
    serverActions: {
      allowedOrigins: ["cadeolead.com.br", "www.cadeolead.com.br", "leadinghub.netlify.app"],
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: common },
      {
        source: "/((?!tracker\\.js|api/collect).*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        ],
      },
    ];
  },
};

export default nextConfig;
