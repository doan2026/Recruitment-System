/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  distDir: process.env.NEXT_E2E === 'true' ? '.next-e2e' : '.next',
  async rewrites() {
    const gateway = (process.env.API_INTERNAL_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${gateway}/:path*` }];
  },
};
