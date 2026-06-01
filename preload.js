// preload.js — 在 Next.js 启动前加载环境变量
// Next.js 14+ 自动读取 .env 文件，此文件确保 dotenv 在最早阶段生效
try {
  require('dotenv').config()
} catch {
  // dotenv not installed — Next.js will handle .env loading natively
}
