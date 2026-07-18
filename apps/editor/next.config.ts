import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  logging: {
    browserToTerminal: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  transpilePackages: [
    'three',
    '@pascal-app/viewer',
    '@pascal-app/core',
    '@pascal-app/editor',
    '@pascal-app/mcp',
  ],
  turbopack: {
    root: path.join(__dirname, '..', '..'),
    resolveAlias: {
      react: './node_modules/react',
      three: './node_modules/three',
      '@react-three/fiber': './node_modules/@react-three/fiber',
      '@react-three/drei': './node_modules/@react-three/drei',
    },
  },
  experimental: {
    // The repo pins `typescript` to the TS7 native preview (tsgo), which ships
    // no JS language API. Without this, Next loads TS via the JS API, fails to
    // find it, and shells out to pnpm to auto-install a real TS — which crashes
    // the dev server. This flag makes Next invoke the installed `tsc` directly.
    useTypeScriptCli: true,
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },
  images: {
    unoptimized: process.env.NEXT_PUBLIC_ASSETS_CDN_URL?.startsWith('http://localhost') ?? false,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
      {
        protocol: 'http',
        hostname: '**',
      },
    ],
  },
}

export default nextConfig
