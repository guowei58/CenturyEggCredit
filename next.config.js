/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["exceljs"],
  experimental: {
    serverComponentsExternalPackages: [
      "pdf-parse",
      "pdfjs-dist",
      "mammoth",
      "jszip",
      /**
       * PDFKit reads standard-font metrics via `__dirname + '/data/*.afm'`.
       * If bundled into `.next/server/chunks`, `__dirname` points at chunks/ and ENOENT on Helvetica.afm (Vercel/Lambda).
       */
      "pdfkit",
    ],
    outputFileTracingIncludes: {
      "/api/save-filing-link/**/*": ["./node_modules/pdfkit/js/data/**/*"],
      "/api/saved-documents/**/*": ["./node_modules/pdfkit/js/data/**/*"],
    },
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
