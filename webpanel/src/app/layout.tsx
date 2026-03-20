import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'BollaClaw — Web Panel',
  description: 'Painel de administração do BollaClaw',
  robots: 'noindex, nofollow',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="dark">
      <body className="min-h-screen overflow-hidden">{children}</body>
    </html>
  );
}
