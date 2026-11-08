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

export const rapHomeMetadata: Metadata = {
  ...rapBrandMetadata,
  title: "RapVideoMaker — AI Rap Video Generator",
  description: "Put you and your friend in the booth. Create a 10-second duo rap video from two photos. One video, one payment.",
  alternates: { canonical: "/" },
  openGraph: {
    ...rapBrandMetadata.openGraph,
    title: "RapVideoMaker — AI Rap Video Generator",
    description: "Create a 10-second duo rap video from two photos. One video, one payment.",
    url: "/",
    locale: "en_US",
    type: "website",
  },
  // Moving the preview to the home URL does not approve it for search launch.
  robots: { index: false, follow: false },
};
