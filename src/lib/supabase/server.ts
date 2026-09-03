import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// RLSが効く匿名/authenticatedクライアント。Server Component / Server Action / Route Handlerから使用する。
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Componentからの呼び出しではCookie書込ができないため無視する
          }
        },
      },
    }
  );
}
