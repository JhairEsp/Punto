import { createClient } from '@supabase/supabase-js';

let client;
export const supabaseConfigured = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
export const PHOTO_BUCKET = process.env.SUPABASE_BUCKET || 'attendance-photos';

export function getSupabase() {
  if (!supabaseConfigured()) {
    const error = new Error('Supabase no está configurado. Define SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY en Vercel o en .env.');
    error.status = 503;
    throw error;
  }
  if (!client) {
    client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }
  return client;
}

export function unwrap(result) {
  if (result.error) throw result.error;
  return result.data;
}
