/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Native/WASM/server-only packages must not be bundled by webpack.
  serverExternalPackages: ["@electric-sql/pglite", "postgres", "pino", "pino-pretty", "drizzle-orm"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
