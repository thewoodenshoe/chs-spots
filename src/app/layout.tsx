import type { Metadata, Viewport } from "next";

import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SpotsProvider } from "@/contexts/SpotsContext";
import { VenuesProvider } from "@/contexts/VenuesContext";
import { ActivitiesProvider } from "@/contexts/ActivitiesContext";
import { ToastProvider } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const seoDescription = "Discover over 1,000 Charleston, SC venues updated daily — happy hours, brunches, live music, newly opened restaurants, coffee shops, and more. Verified from venue sites and curated by locals.";

export const metadata: Metadata = {
  title: {
    default: "Charleston Finds — Happy Hours, Brunches, Live Music & Deals",
    template: "%s | Charleston Finds",
  },
  description: seoDescription,
  keywords: [
    "Charleston SC happy hours", "Charleston brunch", "Charleston live music",
    "Charleston deals", "Charleston restaurants", "Charleston coffee shops",
    "Charleston new restaurants", "Charleston nightlife", "Charleston food deals",
    "things to do in Charleston SC",
  ],
  metadataBase: new URL("https://chsfinds.com"),
  alternates: {
    canonical: "https://chsfinds.com",
  },
  openGraph: {
    title: "Charleston Finds — Happy Hours, Brunches, Live Music & Deals",
    description: seoDescription,
    url: "https://chsfinds.com",
    siteName: "Charleston Finds",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/api/og-image",
        width: 1024,
        height: 1024,
        alt: "Charleston Finds — Discover the best of Charleston",
        type: "image/jpeg",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Charleston Finds — Happy Hours, Brunches, Live Music & Deals",
    description: seoDescription,
    images: ["/api/og-image"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/manifest.json",
  robots: {
    index: true,
    follow: true,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0d9488",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const umamiWebsiteId = process.env.NEXT_PUBLIC_UMAMI_WEBSITE_ID;
  const umamiHost = process.env.NEXT_PUBLIC_UMAMI_HOST || '/u';

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Charleston Finds',
    url: 'https://chsfinds.com',
    description: seoDescription,
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://chsfinds.com/?search={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          <ToastProvider>
            <SpotsProvider>
              <VenuesProvider>
                <ActivitiesProvider>
                  {children}
                </ActivitiesProvider>
              </VenuesProvider>
            </SpotsProvider>
          </ToastProvider>
        </ErrorBoundary>
        {umamiWebsiteId && (
          <Script
            src={`${umamiHost}/script.js`}
            data-website-id={umamiWebsiteId}
            data-auto-track="true"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
