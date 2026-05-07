import type { MetadataRoute } from "next";

/**
 * PWA manifest. Lets users "Add to Home Screen" / "Install app" and
 * launch Siddhi fullscreen like a native app.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Siddhi · White Lotus",
    short_name: "Siddhi",
    description: "Construction PM dashboard for White Lotus projects",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FBF7EE",
    theme_color: "#FBF7EE",
    icons: [
      {
        src: "/icon",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icon",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        sizes: "180x180",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
