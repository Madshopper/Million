// {% block structured_data %} fra category.html/search_results.html: BreadcrumbList.
import { tojson } from '../jinja'

export function BreadcrumbJsonLd({ siteUrl, name }: { siteUrl: string; name: string }) {
  const json = `
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    {"@type": "ListItem", "position": 1, "name": "Forside", "item": ${tojson(siteUrl + '/')}},
    {"@type": "ListItem", "position": 2, "name": ${tojson(name)}}
  ]
}
`
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
