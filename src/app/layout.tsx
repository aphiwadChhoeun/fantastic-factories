import type { Metadata } from "next";
import { Cinzel, Inter, Oswald } from "next/font/google";
import "./globals.css";

/**
 * Three voices, and only three.
 *
 * Cinzel speaks for the Guild — Roman caps, used for the title and for the
 * things meant to outlast the concession. Oswald is the stencil on the
 * machinery: labels, buttons, the name stamped on a plate. Inter is everyone
 * else, and every number.
 *
 * All three are variable fonts loaded through next/font, so they are subset
 * and self-hosted at build time. That matters here: the game is a static
 * export served from Workers, and a runtime call out to Google would be the
 * only network request the board ever made.
 */
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-cinzel",
  display: "swap",
});

const oswald = Oswald({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-oswald",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * The tab icon is `icon.png` beside this file, not a `<link>` written here —
 * that filename is an App Router convention, and Next hashes it, emits the
 * tag and sets the type and size off the file itself.
 *
 * The name matters and is easy to get wrong: `favicon` is a convention only
 * as `favicon.ico`. A `favicon.png` is not one, and sits in `app/` doing
 * absolutely nothing. The source art it was cut from is `assets/`.
 */
export const metadata: Metadata = {
  title: "Fantastic Factories",
  description: "Solo play against an AI opponent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${cinzel.variable} ${oswald.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
