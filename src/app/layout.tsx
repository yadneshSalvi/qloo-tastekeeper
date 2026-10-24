import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.css';
const sans = localFont({
  src: '../../public/fonts/geist.woff2',
  variable: '--font-sans',
  display: 'swap',
  weight: '100 900',
});
const serif = localFont({
  src: '../../public/fonts/source-serif-4.woff2',
  variable: '--font-serif',
  display: 'swap',
  weight: '200 900',
});
export const metadata: Metadata = {
  title: { default: 'TASTEKEEPER — Thoughtful choices. Your terms.', template: '%s · TASTEKEEPER' },
  description:
    'Share a little context. Keep the rest yours. An isolated sample of recipient-owned gift recommendations and revocable access.',
  robots: { index: false, follow: false },
};
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable}`}>
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
