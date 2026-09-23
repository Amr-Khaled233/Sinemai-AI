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
  images: {
    remotePatterns: [{ protocol: 'https', hostname: '**.public.blob.vercel-storage.com' }],
  },
};

export default withNextIntl(nextConfig);
