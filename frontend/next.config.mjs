/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  distDir: process.env.NEXT_E2E === 'true' ? '.next-e2e' : '.next',
  async rewrites() {
    const gateway = (process.env.API_INTERNAL_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    return [
      // OAuth redirects and path-scoped cookies use Auth's canonical paths.
      // Keep the browser on the frontend origin throughout the handshake.
      { source: '/auth/google/:path*', destination: `${gateway}/auth/google/:path*` },
      { source: '/auth/oauth2/:path*', destination: `${gateway}/auth/oauth2/:path*` },
      { source: '/api/:path*', destination: `${gateway}/:path*` },
    ];
  },
};
