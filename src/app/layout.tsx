import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Early Trend Radar",
  description: "Offline social trend monitoring dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}