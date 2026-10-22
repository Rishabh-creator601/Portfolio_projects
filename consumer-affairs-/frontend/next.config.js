/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  // Dev and build must never share an output directory. When they do, a
  // `next build` overwrites the running dev server's chunks, and the dev
  // workers then die with "Jest worker encountered N child process exceptions".
  //
  // Next sets NODE_ENV before loading this file, so the split is automatic --
  // no cross-platform env-var juggling in the npm scripts, and `next start`
  // still serves the production build from .next.
  distDir:
    process.env.NEXT_DIST_DIR ||
    (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      }
    ],
  },
}
module.exports = nextConfig
