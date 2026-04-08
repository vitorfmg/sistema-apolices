import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Sistema de Acompanhamento de Seguros',
  description: 'Controle manual e importação básica de apólices',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
