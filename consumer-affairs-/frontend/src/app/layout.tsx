import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { AuthProvider } from '@/lib/auth';
import AppShell from '@/components/layout/AppShell';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });

export const metadata: Metadata = {
  title: {
    default: 'LM-Verify — Legal Metrology Compliance',
    template: '%s · LM-Verify',
  },
  description:
    'Automated compliance verification for packaged commodities under the Legal Metrology (Packaged Commodities) Rules, 2011.',
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#083344',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-inter">
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
