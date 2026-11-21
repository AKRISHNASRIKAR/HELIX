import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  // Compile the shared workspace UI package from source rather than requiring
  // it to be pre-built — keeps the monorepo dev loop to a single `pnpm dev`.
  transpilePackages: ['@helix/ui', '@helix/contracts', '@helix/types'],
};

export default nextConfig;
