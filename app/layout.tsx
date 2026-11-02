import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { BRAND } from '@/lib/contracts';
import './globals.css';

const pretendard = localFont({
  src: '../node_modules/pretendard/dist/web/variable/woff2/PretendardVariable.woff2',
  variable: '--font-pretendard',
  weight: '45 920',
  display: 'swap',
  adjustFontFallback: false,
});

export const metadata: Metadata = {
  title: BRAND.name,
  description: BRAND.tagline,
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#e6eef8' },
    { media: '(prefers-color-scheme: dark)', color: '#0a1220' },
  ],
};

/** 첫 페인트 전에 테마와 투명도를 정해 깜빡임을 막는다. AppContext가 같은 키에 값을 캐시한다. */
const themeScript = `(function(){try{
var s=localStorage.getItem('illionaire_theme')||'system';
var d=s==='dark'||(s==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
var t=localStorage.getItem('illionaire_transparency')==='1'||matchMedia('(prefers-reduced-transparency: reduce)').matches||matchMedia('(prefers-contrast: more)').matches;
var r=document.documentElement;r.dataset.theme=d?'dark':'light';r.dataset.transparency=t?'reduced':'full';
}catch(e){document.documentElement.dataset.theme='light';}})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className={pretendard.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
