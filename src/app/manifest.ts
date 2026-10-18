import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Cadê o Lead",
    short_name: "Cadê o Lead",
    description: "Leads da Landing Page, do anúncio ao atendimento.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#18181b",
    lang: "pt-BR",
    icons: [
      { src: "/app-icon/192?v=2", sizes: "192x192", type: "image/png" },
      { src: "/app-icon/512?v=2", sizes: "512x512", type: "image/png" },
      { src: "/app-icon/512?v=2", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
