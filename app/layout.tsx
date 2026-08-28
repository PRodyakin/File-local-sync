import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "QR·QR — обмен файлами рядом",
  description:
    "Локальный обмен файлами и текстом между компьютером и телефоном.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}

