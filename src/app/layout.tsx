import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SpotsProvider } from "@/contexts/SpotsContext";
import { VenuesProvider } from "@/contexts/VenuesContext";
import { ActivitiesProvider } from "@/contexts/ActivitiesContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Charleston Local Spots",
  description: "Crowdsourced map for the best of Daniel Island life",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <SpotsProvider>
          <VenuesProvider>
            <ActivitiesProvider>
              {children}
            </ActivitiesProvider>
          </VenuesProvider>
        </SpotsProvider>
      </body>
    </html>
  );
}
