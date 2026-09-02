import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fantastic Factories",
  description: "Solo play against an AI opponent",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
