import { rapBrandMetadata } from "@/lib/rap/metadata";

export const metadata = rapBrandMetadata;

export default function RapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
