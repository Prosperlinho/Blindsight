import type { Metadata, Viewport } from "next";
import "@near-wallet-selector/modal-ui/styles.css";
import "./globals.css";
import WalletProvider from "@/components/WalletProvider";

export const metadata: Metadata = {
  title: "BlindSight | Confidential data marketplace",
  description: "A marketplace of private data vaults. Owners set a price per question; buyers pay in NEAR for insights while the source data stays private.",
};

export const viewport: Viewport = {
  themeColor: "#0B0F17",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#0B0F17] text-[#F0FDF4]">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
