import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LabBeacon",
  description: "Shared GPU lab PC shift tracker",
  applicationName: "LabBeacon",
  appleWebApp: {
    capable: true,
    title: "LabBeacon",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#126d5b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
