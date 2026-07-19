import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlackBox — agent memory that survives the outage",
  description:
    "Survivable, hygienic agentic memory on CockroachDB — available through region failure, strongly consistent, region-pinned, and self-auditing. Demonstrated by an incident-response agent that keeps remembering mid-outage.",
  metadataBase: new URL("https://blackbox-web-eight.vercel.app"),
  openGraph: {
    title: "BlackBox — agent memory that survives the outage",
    description:
      "Survivable, self-auditing agentic memory on CockroachDB + AWS Bedrock, demonstrated under a live region failure.",
    type: "website",
  },
};

// Set the theme before first paint to avoid a flash of the wrong theme.
const themeScript = `(function(){try{var t=localStorage.getItem('bb-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
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
