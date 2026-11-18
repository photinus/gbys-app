import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import "@fontsource-variable/plus-jakarta-sans";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";
import { getBranding } from "@/lib/dal/settings";

export async function generateMetadata(): Promise<Metadata> {
  // Branding is editable at runtime: never bake it in at build time.
  await connection();
  const { orgName, shortName } = await getBranding();
  return {
    title: { default: orgName, template: `%s · ${shortName}` },
    description: `Households, volunteer credentials and program operations for ${orgName}.`,
  };
}

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
