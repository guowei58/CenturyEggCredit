/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["exceljs"],
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "pdfjs-dist", "mammoth", "jszip"],
  },
  webpack: (config) => {
    config.module.rules.push({
      test: /\.prompt\.txt$/,
      type: "asset/source",
    });
    return config;
  },
};

module.exports = nextConfig;
