import { NextResponse, type NextRequest } from 'next/server';

// Redirection uniquement. La vraie vérification de session est faite dans handler() et les layouts serveur.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('sfc_session')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|_next/static|_next/image|favicon.ico).*)'],
};
