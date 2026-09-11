/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  async rewrites() {
    const gateway = (process.env.API_INTERNAL_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    return [{ source: '/api/:path*', destination: `${gateway}/:path*` }];
  },
};
