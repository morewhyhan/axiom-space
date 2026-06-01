import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  // Protected routes check
  const { pathname } = request.nextUrl

  // Only protect dashboard routes
  if (pathname.startsWith('/dashboard')) {
    const sessionToken = request.cookies.get('hononext.session_token')?.value
    if (!sessionToken) {
      return NextResponse.redirect(new URL('/', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
