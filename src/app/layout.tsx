import type { Metadata } from "next";
import "./globals.css";
import CoachNav from "./CoachNav";

export const metadata: Metadata = {
  title: "YLL Call Copilot",
  description: "Call copilot for Yule Love Lights reps",
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
