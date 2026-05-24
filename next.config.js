/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = [
        ...(Array.isArray(config.externals) ? config.externals : []),
        'archiver',
        // Node.js builtins — pi-ai/pi-agent-core use node:fs etc.
        // Must be external so webpack doesn't try to bundle them
        { 'node:fs': 'commonjs fs' },
        { 'node:path': 'commonjs path' },
        { 'node:os': 'commonjs os' },
        { 'node:crypto': 'commonjs crypto' },
        { 'node:stream': 'commonjs stream' },
        { 'node:util': 'commonjs util' },
        { 'node:buffer': 'commonjs buffer' },
        { 'node:events': 'commonjs events' },
        { 'node:url': 'commonjs url' },
        { 'node:http': 'commonjs http' },
        { 'node:https': 'commonjs https' },
        { 'node:net': 'commonjs net' },
        { 'node:tls': 'commonjs tls' },
        { 'node:child_process': 'commonjs child_process' },
        { 'node:zlib': 'commonjs zlib' },
      ]
    }
    return config
  },
}

module.exports = nextConfig
