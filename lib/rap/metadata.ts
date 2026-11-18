import type { Metadata } from "next";

export const rapBrandMetadata: Metadata = {
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

const homeUrl = "https://rapvideomaker.pro/";
const homeTitle = "AI Rap Video Generator & AI Rap Video Maker for Two Photos";
const homeDescription = "RapVideoMaker is an AI rap video generator for two photos. Try sample photos in your browser. No app to install. Video generation is paused.";

export const rapHomeMetadata: Metadata = {
  ...rapBrandMetadata,
  metadataBase: new URL(homeUrl),
  title: homeTitle,
  description: homeDescription,
  alternates: { canonical: homeUrl },
  openGraph: {
    ...rapBrandMetadata.openGraph,
    title: homeTitle,
    description: homeDescription,
    url: homeUrl,
    locale: "en_US",
    type: "website",
  },
  twitter: {
    ...rapBrandMetadata.twitter,
    title: homeTitle,
    description: homeDescription,
  },
};
