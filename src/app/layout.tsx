import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import { Providers } from '@/components/providers';
import './globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' });

const description = 'Trésorerie, contrôle bancaire et reporting pour SEC SARL et l’École.';

// Les images de partage (opengraph-image, twitter-image) et les icônes (icon.svg, favicon.ico, apple-icon) viennent des
// fichiers de src/app. metadataBase rend leurs adresses absolues, ce que WhatsApp, Facebook ou Slack exigent.
export const metadata: Metadata = {
  metadataBase: new URL(process.env.SITE_URL ?? 'https://www.fintrax.site'),
  title: 'SEC Finance Control',
  description,
  openGraph: { title: 'SEC Finance Control', description, siteName: 'SEC Finance Control', locale: 'fr_FR', type: 'website' },
  twitter: { card: 'summary_large_image', title: 'SEC Finance Control', description },
};

export const viewport: Viewport = { themeColor: '#0e9f6e' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr" className={inter.variable}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
