import type { Metadata } from "next";
import { QrQrApp } from "./QrQrApp";

export const metadata: Metadata = {
  title: "QR·QR — обмен файлами рядом",
  description:
    "Передавайте файлы и текст между компьютером и телефоном в одной локальной сети.",
};

export default function Home() {
  return <QrQrApp />;
}

