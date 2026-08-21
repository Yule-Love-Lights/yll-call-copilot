import type { Metadata } from "next";
import "./globals.css";
import CoachNav from "./CoachNav";

export const metadata: Metadata = {
  title: "Yule Love Lights Operations Hub",
  description: "Office call and coaching tools for Yule Love Lights",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <CoachNav />
        {children}
      </body>
    </html>
  );
}
