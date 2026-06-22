/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['three'],
  experimental: {
    // 双保险：serverComponentsExternalPackages 让 Next.js 知道这些包
    // 不应在 RSC 中被 bundle；但 App Router 的 Route Handler 走的是
    // webpack server build，所以还需要下面的 externals 函数兜底。
    serverComponentsExternalPackages: [
      '@mariozechner/pi-ai',
      '@mariozechner/pi-agent-core',
    ],
  },
  webpack: (config, { isServer }) => {
    config.watchOptions = {
      ...(config.watchOptions || {}),
      ignored: '**/test/artifacts/**',
    }

    config.resolve = config.resolve || {}
    config.resolve.fallback = {
      ...(config.resolve.fallback || {}),
      encoding: false,
    }

    if (isServer) {
      const fnExternals = [
        // pi-ai / pi-agent-core 内部用动态 require() 加载 provider 模块，
        // webpack 无法静态分析这些调用（会报 "Critical dependency: the
        // request of a dependency is an expression"），导致 node:fs/os/path
        // 等内置模块在打包后无法解析。
        // 解决：把整个 @mariozechner/* scope 标为 commonjs external，
        // 让 Node 原生 require 在运行时处理它们。
        ({ request }, callback) => {
          if (request && /^@mariozechner\//.test(request)) {
            // pi-ai 是纯 ESM 包（"type": "module"，只有 "import" 条件 exports，
            // 没有 "require"）。用 'commonjs' external 会让 Node 尝试 CJS
            // require() ESM 包，触发 ERR_PACKAGE_PATH_NOT_EXPORTED。
            // 改用 'import' external，webpack 会输出 await import(...)，
            // 命中 pi-ai 的 ESM exports 条件。
            return callback(null, 'import ' + request)
          }
          callback()
        },
      ]

      config.externals = [
        ...fnExternals,
        ...(Array.isArray(config.externals) ? config.externals : []),
        'archiver',
      ]
    }
    return config
  },
}

module.exports = nextConfig
