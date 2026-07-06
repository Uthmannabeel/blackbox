import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlackBox — incident memory that survives the outage",
  description:
    "An SRE incident-response agent whose memory stays available, consistent, and region-pinned on CockroachDB — so when a region fails mid-incident, the agent keeps remembering.",
  metadataBase: new URL("https://blackbox-web-eight.vercel.app"),
  openGraph: {
    title: "BlackBox — incident memory that survives the outage",
    description:
      "An SRE agent with globally-distributed, survivable memory on CockroachDB + AWS Bedrock.",
    type: "website",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
