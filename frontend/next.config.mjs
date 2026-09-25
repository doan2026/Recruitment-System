/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  // Gateway collections only exist as `/jobs/`, `/applications/`, `/companies/`;
  // Next's default 308 would strip the slash before the /api proxy runs.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    const gateway = (process.env.API_INTERNAL_BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
    return [
      // `:path*` drops a trailing slash, so collection roots need their own rule.
      { source: '/api/:path*/', destination: `${gateway}/:path*/` },
      { source: '/api/:path*', destination: `${gateway}/:path*` },
    ];
  },
};
