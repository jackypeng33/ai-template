import { permanentRedirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function LegacyRapPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) query.append(key, item);
  }
  permanentRedirect(query.size ? `/?${query}` : "/");
}
