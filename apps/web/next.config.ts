import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@onereal/ui',
    '@onereal/database',
    '@onereal/auth',
    '@onereal/types',
    '@onereal/portfolio',
  ],
};

export default nextConfig;
