import type { Metadata, Viewport } from "next";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

export const metadata: Metadata = {
  title: {
    default: "Gold Beach Youth Sports",
    template: "%s | Gold Beach Youth Sports",
  },
  description:
    "Households, volunteer credentials and program operations for Gold Beach Youth Sports, a volunteer-run 501(c)(3) in Gold Beach, Oregon.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#F4F3EF",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased selection:bg-periwinkle/30">
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
