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

const seoDescription = "Discover 600+ verified deals across 1,000+ Charleston SC venues — real-time happy hours, brunch, rooftop bars, live music & more. Updated daily with 'Active Right Now' map. Free, no ads.";

export const metadata: Metadata = {
  title: {
    default: "CHS Finds – Real-Time Happy Hours, Brunch, Rooftops & Live Music in Charleston SC",
    template: "%s | CHS Finds",
  },
  description: seoDescription,
  keywords: [
    "Charleston SC happy hours", "Charleston brunch", "Charleston live music",
    "Charleston rooftop bars", "Charleston deals map", "Charleston restaurants",
    "Charleston coffee shops", "things to do in Charleston SC",
    "active right now Charleston", "best happy hour Charleston SC",
  ],
  metadataBase: new URL("https://chsfinds.com"),
  openGraph: {
    title: "CHS Finds – Real-Time Happy Hours, Brunch, Rooftops & Live Music in Charleston SC",
    description: seoDescription,
    url: "https://chsfinds.com",
    siteName: "Charleston Finds",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "https://chsfinds.com/og-image.png",
        width: 1200,
        height: 630,
        alt: "CHS Finds – Real-Time Happy Hours, Brunch, Rooftops & Live Music in Charleston SC",
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CHS Finds – Real-Time Happy Hours, Brunch, Rooftops & Live Music in Charleston SC",
    description: seoDescription,
    images: ["https://chsfinds.com/og-image.png"],
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

  const today = new Date().toISOString().split('T')[0];
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'CHS Finds',
    url: 'https://chsfinds.com',
    description: 'Hyper-local Charleston discovery platform – real-time deals, maps, and hidden gems',
    datePublished: '2025-01-15',
    dateModified: today,
    keywords: 'Charleston happy hour map, real-time deals Charleston, rooftop bars Charleston SC, brunch Charleston updated daily',
    potentialAction: {
      '@type': 'SearchAction',
      target: 'https://chsfinds.com/?search={search_term_string}',
      'query-input': 'required name=search_term_string',
    },
  };

  return (
    <html lang="en">
      <head>
        <meta name="revisit-after" content="1 day" />
        <meta name="last-modified" content={today} />
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
