const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "jszip",
      "exceljs",
      "xlsx-js-style",
    ],
  },
  webpack: (config, { isServer }) => {
    config.module.rules.push({
      test: /\.prompt\.txt$/,
      type: "asset/source",
    });

    if (isServer) {
      config.externals = [...(config.externals || []), "exceljs", "xlsx-js-style"];
    } else {
      config.resolve.alias = {
        ...config.resolve.alias,
        exceljs: path.resolve(__dirname, "node_modules/exceljs/dist/exceljs.min.js"),
      };
    }

    return config;
  },
};

module.exports = nextConfig;
