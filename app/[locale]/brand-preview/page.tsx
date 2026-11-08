import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand/brand-logo";
import { rapBrandColors } from "@/lib/rap/brand-tokens";
import styles from "./preview.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "RapVideoMaker brand preview",
  robots: { index: false, follow: false },
};

const swatches = Object.entries(rapBrandColors);

export default function BrandPreview() {
  if (process.env.NODE_ENV !== "development") notFound();

  return <main className={styles.page}>
    <div className={styles.intro}><span>BRAND SYSTEM / 01</span><h1>RapVideoMaker</h1><p>Play in the silhouette. Beat in the negative space.</p></div>

    <section className={styles.grid} aria-label="Logo variants">
      <div className={`${styles.panel} ${styles.dark}`}><small>DARK BACKGROUND / PRIMARY</small><BrandLogo size="lg" /><BrandLogo variant="wordmark" size="md" /></div>
      <div className={`${styles.panel} ${styles.light}`}><small>LIGHT BACKGROUND / CONTRAST</small><BrandLogo tone="light" size="lg" /><BrandLogo variant="wordmark" tone="light" size="md" /></div>
      <div className={`${styles.panel} ${styles.dark}`}><small>SYMBOL / FULL AND COMPACT</small><div className={styles.row}><BrandLogo variant="symbol" size="lg" /><Image src="/brand/icon.svg" width={48} height={48} alt="Compact RapVideoMaker symbol" unoptimized /></div></div>
      <div className={`${styles.panel} ${styles.light}`}><small>MONOCHROME / BLACK AND WHITE</small><div className={styles.row}><BrandLogo variant="horizontal" tone="black" size="md" /></div><div className={styles.monoDark}><BrandLogo variant="horizontal" tone="white" size="md" /></div></div>
    </section>

    <section className={styles.section}><h2>At favicon sizes</h2><div className={styles.favicons}>{([16, 32, 64] as const).map(size => <div key={size}><span className={styles.faviconFrame}><Image src={size === 16 ? "/brand/icon.svg" : "/brand/logo-symbol.svg"} width={size} height={size} alt="" unoptimized /></span><small>{size} × {size}</small></div>)}</div></section>

    <section className={styles.section}><h2>Header context</h2><div className={styles.header}><Link href="/" aria-label="RapVideoMaker home"><BrandLogo size="sm" decorative /></Link><nav><span>How it works</span><span>The track</span><span>FAQs</span></nav><span className={styles.signIn}>Sign in ↗</span></div></section>

    <section className={styles.section}><h2>Color tokens</h2><div className={styles.swatches}>{swatches.map(([name, color]) => <div key={name}><span className={styles.swatch} style={{ backgroundColor: color }} /><strong>{name}</strong><small>{color}</small></div>)}</div></section>
  </main>;
}
