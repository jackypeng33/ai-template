import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale, localePrefix } from './i18n.config';
import { NextRequest, NextResponse } from 'next/server';

const localizedSite = createMiddleware({
  locales,
  defaultLocale,
  localePrefix
});

// BOOTH's confirmed MVP is English-only. Ignore browser locale and the
// starter's NEXT_LOCALE cookie here, without changing other product routes.
const englishProduct = createMiddleware({
  locales: ['en'], defaultLocale: 'en', localePrefix: 'as-needed',
  localeDetection: false, localeCookie: false, alternateLinks: false,
});

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (/^\/(?:en|zh)\/rap(?:\/|$)/.test(path)) {
    const canonical = request.nextUrl.clone();
    canonical.pathname = path.replace(/^\/(?:en|zh)/, '');
    return NextResponse.redirect(canonical);
  }
  return /^\/rap(?:\/|$)/.test(path) ? englishProduct(request) : localizedSite(request);
}

export const config = {
  matcher: [
    '/',
    '/((?!api|_next|_vercel|.*\\..*).*)'
  ]
};
