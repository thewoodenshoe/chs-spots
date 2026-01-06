import type { Metadata } from "next";
import "./globals.css";
import { SpotsProvider } from "@/contexts/SpotsContext";

export const metadata: Metadata = {
  title: "Charleston Local Spots",
  description: "Crowdsourced map for the best of Daniel Island life",
  viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">
        <SpotsProvider>
          {children}
        </SpotsProvider>
      </body>
    </html>
  );
}
