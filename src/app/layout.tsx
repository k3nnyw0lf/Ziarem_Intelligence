import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ziarem.com — AI Sales Floor",
  description: "Bilingual (EN/ES) AI sales floor & enterprise CRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased min-h-screen bg-background text-foreground">
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
