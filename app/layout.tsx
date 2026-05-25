import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./_components/providers";
import { NightTheme } from "./_components/night-theme";

// Runs before paint to set the night palette without a bright flash (matters
// for light-sensitive use at night). Kept in sync afterwards by <NightTheme/>.
const NIGHT_INIT = `(function(){try{var h=new Date().getHours();if(h>=20||h<8)document.documentElement.setAttribute('data-theme','night');}catch(e){}})();`;

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Medicamento",
  description: "Lembrete simples dos seus horários de medicamento",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f3ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1a17" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${fraunces.variable} ${inter.variable}`}>
      <body className="min-h-dvh">
        <script dangerouslySetInnerHTML={{ __html: NIGHT_INIT }} />
        <Providers>{children}</Providers>
        <NightTheme />
      </body>
    </html>
  );
}
