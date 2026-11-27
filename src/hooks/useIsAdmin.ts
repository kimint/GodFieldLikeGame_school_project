import { useEffect, useState } from "react";
import { supabase, onlineAvailable } from "../online/supabaseClient.ts";

/**
 * True when the logged-in account is in the `public.admins` table (checked by
 * the `is_admin()` database function). Re-checks whenever the account changes.
 * This only decides what the UI shows: anything an admin tool changes must be
 * checked again on the server.
 */
export function useIsAdmin(accountId: string | null): boolean {
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    setIsAdmin(false);
    if (!onlineAvailable || !accountId) return;
    let cancelled = false;
    void supabase.rpc("is_admin").then(({ data, error }) => {
      if (error) console.warn("is_admin check failed:", error.message);
      if (!cancelled) setIsAdmin(data === true);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  return isAdmin;
}
