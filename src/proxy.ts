import { NextResponse, type NextRequest } from 'next/server';

// Les icônes et images de partage restent publiques : les robots d'aperçu de lien n'ont pas de session.
// Redirection uniquement. La vraie vérification de session est faite dans handler() et les layouts serveur.
export function proxy(request: NextRequest) {
  if (!request.cookies.has('sfc_session')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|login|mot-de-passe-oublie|reinitialiser-mot-de-passe|_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|opengraph-image.png|twitter-image.png).*)'],
};
