import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono, Cormorant_Garamond } from "next/font/google";
import { SwRegister } from "@/components/sw-register";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://app-atalaia.vercel.app";

export const viewport: Viewport = {
  themeColor: "#0A0A0A",
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SOLOMON — Seu Consultor Privado de Seguros de Vida",
    template: "%s — SOLOMON",
  },
  description:
    "IA oráculo para corretores de seguros de vida. Certeza absoluta. Em segundos. Consulte condições gerais, coberturas, exclusões e carências de todas as seguradoras com citação da fonte.",
  applicationName: "SOLOMON",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "SOLOMON",
    startupImage: [
      // Generic splash — full device-specific set is a design follow-up
      "/icon-512.png",
    ],
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: { url: "/apple-icon.png", sizes: "180x180", type: "image/png" },
  },
  manifest: "/manifest.json",
  openGraph: {
    title: "SOLOMON — Certeza absoluta. Em segundos.",
    description:
      "Consultor privado de IA para corretores de seguros de vida. Respostas com citação exata da fonte.",
    images: [{ url: "/solomon-avatar.png", width: 512, height: 512 }],
    type: "website",
    locale: "pt_BR",
  },
  twitter: {
    card: "summary_large_image",
    title: "SOLOMON — Certeza absoluta. Em segundos.",
    description: "IA oráculo para corretores de seguros de vida.",
    images: ["/solomon-avatar.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="pt-BR"
      className={`${inter.variable} ${jetbrainsMono.variable} ${cormorant.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-dvh bg-background text-foreground font-sans">
        <SwRegister />
        {children}
      </body>
    </html>
  );
}
