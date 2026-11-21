import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Compile the shared workspace UI package from source rather than requiring
  // it to be pre-built, which keeps the monorepo dev loop to a single `pnpm dev`.
  transpilePackages: ['@helix/ui', '@helix/contracts', '@helix/types'],
  experimental: {
    // CSV uploads go through a server action (API limit is 50MB); leave
    // headroom for multipart overhead. Middleware buffers bodies too.
    serverActions: { bodySizeLimit: '52mb' },
    middlewareClientMaxBodySize: '52mb',
  },
};

export default nextConfig;
