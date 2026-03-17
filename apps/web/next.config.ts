import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  transpilePackages: [
    '@onereal/ui',
    '@onereal/database',
    '@onereal/auth',
    '@onereal/types',
    '@onereal/portfolio',
  ],
  experimental: {
    optimizePackageImports: ['recharts'],
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
};

export default nextConfig;
