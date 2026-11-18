import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Gold Beach Youth Sports",
    short_name: "GBYS",
    description: "Youth sports registration, volunteer hours and team emergency sheets for Gold Beach, Oregon.",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#F4F3EF",
    theme_color: "#1C1C1E",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
