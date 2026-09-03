import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";

// Service Role Key を使う特権クライアント。RLSを完全にバイパスするため、
// Seedスクリプトや管理系バッチなど、サーバー専用コードからのみ import すること。
// NEXT_PUBLIC_* にしない・クライアントバンドルに含めないこと。
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL が設定されていません"
    );
  }

  return createSupabaseClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
