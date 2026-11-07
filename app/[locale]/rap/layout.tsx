import type { Metadata } from "next";

export const metadata: Metadata = {
  applicationName: "RapVideoMaker",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  icons: {
    icon: [
      { url: "/brand/favicon.ico", sizes: "any", type: "image/x-icon" },
      { url: "/brand/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    siteName: "RapVideoMaker",
    images: [{ url: "/brand/og-rapvideomaker.png", width: 1200, height: 630, alt: "RapVideoMaker — AI Rap Video Generator" }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/brand/og-rapvideomaker.png"],
  },
};

export default function RapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
