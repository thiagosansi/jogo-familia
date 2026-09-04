import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import "./globals.css";
import { DesbloqueioAudio } from "@/components/DesbloqueioAudio";
import { Sincronia } from "@/components/Sincronia";
import { AvisoVoz } from "@/components/AvisoVoz";

// Fonte arredondada, peso alto: legível de longe e amigável para criança.
const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["700", "800"],
});

export const metadata: Metadata = {
  title: "Fundo do Mar — Jogo da Família",
  description:
    "Jogo educativo offline para crianças pequenas, com as fotos e as vozes da própria família. Tudo fica no dispositivo.",
  applicationName: "Fundo do Mar",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Fundo do Mar",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // Mesma cor do theme_color em public/manifest.json.
  themeColor: "#062a4a",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR" className={nunito.variable}>
      <body>
        <DesbloqueioAudio />
        <Sincronia />
        <AvisoVoz />
        {children}
      </body>
    </html>
  );
}
