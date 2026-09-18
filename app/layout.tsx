import type { Metadata } from 'next';
import { PollarProvider } from '@pollar/react';
import '@pollar/react/styles.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Ọ̀nà — naira to bolivianos',
  description:
    'Send money from Nigeria to Bolivia. Local rails on both ends, Stellar in the middle.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/*
          A plain stylesheet link, not next/font/google. next/font fetches the
          font file during the dev-server *compile*, which hangs indefinitely
          if that network can't reach Google's CDN — no error, no timeout, it
          just never finishes. A runtime <link> can't block `npm run dev`: if
          it fails to load in the browser, the page just falls back to the
          system stack already defined for --font-ui in globals.css.
        */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&display=swap"
        />
      </head>
      <body>
        <PollarProvider client={{ apiKey: process.env.NEXT_PUBLIC_POLLAR_PUBLISHABLE_KEY! }}>
          {children}
        </PollarProvider>
      </body>
    </html>
  );
}
