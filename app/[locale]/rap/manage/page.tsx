import { requireAdmin } from "@/lib/auth/admin";
import { RapManager } from "@/features/rap/rap-manager";
export const dynamic = "force-dynamic";
export const metadata = { title: "BOOTH Operations", robots: { index: false, follow: false } };
export default async function ManagePage() { await requireAdmin(); return <RapManager />; }
