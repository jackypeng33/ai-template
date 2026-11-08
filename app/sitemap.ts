import { MetadataRoute } from 'next'

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

  // Static routes
  const staticRoutes = [
    '/starter',
    '/pricing',
    '/blog',
    '/contact',
    '/privacy',
    '/terms',
    '/cookies',
    '/refund',
  ]

  // The English-only video home remains noindex during preview. List the
  // preserved starter and template pages using their as-needed locale URLs.
  const locales = ['zh', 'en']
  const sitemapEntries: MetadataRoute.Sitemap = []

  locales.forEach((locale) => {
    staticRoutes.forEach((route) => {
      sitemapEntries.push({
        url: new URL(`${locale === 'en' ? '' : '/zh'}${route}`, baseUrl).toString(),
        lastModified: new Date(),
        changeFrequency: 'weekly',
        priority: 0.8,
        alternates: {
          languages: {
            zh: new URL(`/zh${route}`, baseUrl).toString(),
            en: new URL(route, baseUrl).toString(),
          },
        },
      })
    })
  })

  return sitemapEntries
}
