import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const proto = request.headers.get('x-forwarded-proto');
  if (
    proto === 'http' &&
    request.nextUrl.hostname !== 'localhost' &&
    !request.nextUrl.hostname.startsWith('127.')
  ) {
    const httpsUrl = request.nextUrl.clone();
    httpsUrl.protocol = 'https';
    return NextResponse.redirect(httpsUrl, 301);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|spots/|venues/).*)'],
};
