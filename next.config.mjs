import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // @react-pdf/renderer and unpdf are node-only; keep them out of the client bundle.
    serverActions: { bodySizeLimit: '8mb' },
  },
  // The Arabic PDF font is read from disk at render time, so it has to be
  // traced into the serverless bundle.
  outputFileTracingIncludes: {
    '/api/projects/**': ['./src/pdf/fonts/**'],
  },
  serverExternalPackages: ['@react-pdf/renderer', 'unpdf'],
  /**
   * Baseline security headers.
   *
   * A full CSP is deliberately not set here: the app ships one inline script
   * (the theme bootstrap) plus Next's own inline runtime, so a useful policy
   * needs per-request nonces through middleware. frame-ancestors is the part
   * that actually matters against clickjacking, and it works standalone.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
      {
        // Sheets and exports must never be cached by a shared proxy.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
};

export default withNextIntl(nextConfig);
