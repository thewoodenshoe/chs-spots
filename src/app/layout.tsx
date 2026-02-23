import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { SpotsProvider } from "@/contexts/SpotsContext";
import { VenuesProvider } from "@/contexts/VenuesContext";
import { ActivitiesProvider } from "@/contexts/ActivitiesContext";
import { ToastProvider } from "@/components/Toast";
import ErrorBoundary from "@/components/ErrorBoundary";
import CookieConsent from "@/components/CookieConsent";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CHS Finds",
  description: "Discover the best of Charleston — happy hours, brunch, fishing, and more.",
  metadataBase: new URL("https://chsfinds.com"),
  openGraph: {
    title: "CHS Finds",
    description: "Discover the best of Charleston — happy hours, brunch, fishing, and more.",
    url: "https://chsfinds.com",
    siteName: "CHS Finds",
    type: "website",
    locale: "en_US",
    images: [
      {
        url: "/og-image.jpg",
        width: 960,
        height: 960,
        alt: "CHS Finds — Discover the best of Charleston",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "CHS Finds",
    description: "Discover the best of Charleston — happy hours, brunch, fishing, and more.",
    images: ["/og-image.jpg"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
    ],
    apple: "/favicon.svg",
  },
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

  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <ErrorBoundary>
          <ToastProvider>
            <SpotsProvider>
              <VenuesProvider>
                <ActivitiesProvider>
                  {children}
                  <CookieConsent />
                </ActivitiesProvider>
              </VenuesProvider>
            </SpotsProvider>
          </ToastProvider>
        </ErrorBoundary>
        {umamiWebsiteId && (
          <Script
            src={`${umamiHost}/script.js`}
            data-website-id={umamiWebsiteId}
            data-auto-track="false"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
