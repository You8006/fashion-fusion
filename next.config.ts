import type { NextConfig } from "next";

// SSR (Route Handlers 有効) モード: output:'export' を削除し動的処理復活
// Azure Static Web Apps Standard プランで Next.js SSR ランタイムを利用
// Turbopack ルート警告 (複数 lockfile) は現状型定義上 root オプション未公開のため
// 明示設定はスキップし、警告は無害なのでコメントのみ。
const nextConfig: NextConfig = {
  images: { unoptimized: true },
};

export default nextConfig;
