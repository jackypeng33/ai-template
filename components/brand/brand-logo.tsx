import Image from "next/image";
import styles from "./brand-logo.module.css";

export type BrandLogoVariant = "horizontal" | "wordmark" | "symbol";
export type BrandLogoTone = "dark" | "light" | "white" | "black";
export type BrandLogoSize = "sm" | "md" | "lg";

export interface BrandLogoProps {
  variant?: BrandLogoVariant;
  tone?: BrandLogoTone;
  size?: BrandLogoSize;
  className?: string;
  decorative?: boolean;
}

const dimensions = {
  horizontal: { width: 446, height: 64 },
  wordmark: { width: 368, height: 64 },
  symbol: { width: 64, height: 64 },
} as const;

/** Vector assets are outlined from the bundled Geist font for portable branding. */
export function BrandLogo({
  variant = "horizontal",
  tone = "dark",
  size = "md",
  className,
  decorative = false,
}: BrandLogoProps) {
  const source = `/brand/logo-${variant}-${tone}.svg`;
  const box = dimensions[variant];
  return (
    <span
      className={[styles.logo, styles[size], className].filter(Boolean).join(" ")}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "RapVideoMaker"}
      aria-hidden={decorative || undefined}
    >
      <Image src={source} alt="" width={box.width} height={box.height} unoptimized priority={false} />
    </span>
  );
}
