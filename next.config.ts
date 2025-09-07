import type { NextConfig } from "next";

// 静的サイト (SSG) / next export モード
// 注意:
//  - app/api/ 以下の Route Handler は使用できないため削除済み
//  - 動的サーバ処理やシークレット利用は行えません
//  - 生成系 API が必要な場合は Azure Functions 等を再導入してください
const nextConfig: NextConfig = {
  output: 'export',
  images: { unoptimized: true },
};

export default nextConfig;
