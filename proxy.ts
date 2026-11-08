import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale, localePrefix } from './i18n.config';
import { NextRequest, NextResponse } from 'next/server';

const localizedSite = createMiddleware({
  locales,
  defaultLocale,
  localePrefix
});

// The video home and Rap subpages are English-only. The preserved starter
// and other template pages retain the site's regular locale detection.
const englishProduct = createMiddleware({
  locales: ['en'], defaultLocale: 'en', localePrefix: 'as-needed',
  localeDetection: false, localeCookie: false, alternateLinks: false,
});

export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (/^\/(?:en|zh)\/?$/.test(path) || /^\/(?:(?:en|zh)\/)?rap\/?$/.test(path)) {
    const canonical = request.nextUrl.clone();
    canonical.pathname = '/';
    return NextResponse.redirect(canonical, 308);
  }
  if (/^\/(?:en|zh)\/rap(?:\/|$)/.test(path)) {
    const canonical = request.nextUrl.clone();
    canonical.pathname = path.replace(/^\/(?:en|zh)/, '');
    return NextResponse.redirect(canonical);
  }
  return path === '/' || /^\/rap(?:\/|$)/.test(path) ? englishProduct(request) : localizedSite(request);
}

export const config = {
  matcher: [
    '/',
    '/((?!api|_next|_vercel|.*\\..*).*)'
  ]
};
