import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Export 100% statique : aucun serveur, aucune fonction, déployable sur n'importe quel CDN.
  output: "export",

  // Les scènes sont servies telles quelles depuis /public et affichées dans un viewer
  // zoom/pan maison (<img> brut), pas via next/image — l'optimiseur n'a rien à faire ici.
  images: { unoptimized: true },

  trailingSlash: true,
};

export default nextConfig;
