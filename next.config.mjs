/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "bwcnllhflumxdwuqxmjc.supabase.co",
      },
    ],
  },
};

export default nextConfig;
