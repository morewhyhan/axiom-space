import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Axiom — Cognitive Operating System',
  description: 'AI驱动的个性化知识构建系统',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang='zh-CN' suppressHydrationWarning>
      <head>
        <link href="https://fonts.googleapis.com/css2?family=Bodoni+Moda:ital,wght@0,700;1,700&family=JetBrains+Mono:wght@400;700&family=Noto+Sans+SC:wght@100;300;400;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        {children}
      </body>
    </html>
  )
}
