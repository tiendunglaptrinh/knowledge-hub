/**
 * Next.js configuration for the Electron renderer.
 *
 * `output: 'export'` produces a static bundle in `renderer/out`, which the
 * app:// protocol handler serves. There is no Node server in the packaged
 * application, so Server Components, route handlers and `next/image`
 * optimisation are all unavailable by construction — the UI is a client
 * application that talks to the main process over IPC instead of HTTP.
 *
 * `experimental.externalDir` lets the renderer import `../src/shared/*`. Those
 * are type-only imports of the IPC contract; sharing the file is what keeps
 * the two processes from drifting.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  output: 'export',
  reactStrictMode: true,
  images: { unoptimized: true },
  experimental: { externalDir: true },
  // Emits `out/foo/index.html` instead of `out/foo.html`; irrelevant while the
  // app is a single route, but it keeps the protocol handler's mapping simple
  // if routes are added later.
  trailingSlash: true,
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // The dev overlay badge sits bottom-left, exactly on top of the sidebar's
  // last nav row. Compilation errors still surface in the terminal and in
  // DevTools, which is where they are read anyway.
  devIndicators: false,
}

export default nextConfig
