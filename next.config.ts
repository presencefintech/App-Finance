import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['argon2', 'pdfkit', 'exceljs', 'pg'],
  poweredByHeader: false,
};

export default nextConfig;
