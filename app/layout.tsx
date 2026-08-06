import type { Metadata, Viewport } from 'next'
import { Poppins, Raleway } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
  variable: '--font-poppins',
})

const raleway = Raleway({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-raleway',
})

export const metadata: Metadata = {
  title: 'Rorn Mony — MooNyDev | Full-Stack & QA Engineer',
  description:
    'Portfolio of Rorn Mony (MooNyDev), a full-stack web & mobile developer and QA Engineer from Phnom Penh, Cambodia. Skills in Next.js, React, NestJS, and automation testing.',
  generator: 'v0.app',
  icons: {
    icon: [
      { url: 'https://avatars.githubusercontent.com/u/165788540?v=4', type: 'image/png' },
      { url: 'https://avatars.githubusercontent.com/u/165788540?v=4', type: 'image/svg+xml' },
    ],
    apple: 'https://avatars.githubusercontent.com/u/165788540?v=4',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light dark',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#1a2230' },
  ],
}

const themeScript = `
(function() {
  try {
    var stored = localStorage.getItem('theme');
    var theme = stored === 'dark' || stored === 'light' ? stored : 'light';
    document.documentElement.classList.add(theme);
  } catch (e) {
    document.documentElement.classList.add('light');
  }
})();
`

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${poppins.variable} ${raleway.variable} bg-background`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <Script
          id="theme-script"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: themeScript }}
        />
        {children}
        {process.env.NODE_ENV === 'production' && ''}
      </body>
    </html>
  )
}