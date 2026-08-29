import type { MetadataRoute } from "next";

// Web App Manifest — makes the app installable on Android + iOS.
// Site engineers can then "Add to Home Screen" and launch Siddhi as a
// standalone app icon (no browser chrome).

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Siddhi · White Lotus",
    short_name: "Siddhi",
    description: "Site engineer + planner tool for White Lotus construction projects",
    start_url: "/mobile",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF7EE",
    theme_color: "#161926",
    lang: "en",
    icons: [
      { src: "/icon", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png", purpose: "any" },
    ],
    categories: ["business", "productivity"],
  };
}
