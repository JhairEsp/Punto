import bcrypt from 'bcryptjs';
import { getSupabase, unwrap, PHOTO_BUCKET } from '../server/supabase.js';

const supabase = getSupabase();
const emailSafeName = 'Velcco';
const password = 'Velcco2026@';

const bucket = await supabase.storage.createBucket(PHOTO_BUCKET, {
  public: false,
  fileSizeLimit: 4 * 1024 * 1024,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
});
if (bucket.error && !/already exists/i.test(bucket.error.message)) throw bucket.error;

const user = unwrap(await supabase.from('users').upsert({
  name: emailSafeName,
  username: emailSafeName,
  password_hash: bcrypt.hashSync(password, 12),
  position: 'SuperAdmin',
  role: 'superadmin',
  active: true,
  avatar_color: '#C9F27C',
  scheduled_entry: '08:00',
  scheduled_exit: '17:00',
}, { onConflict: 'username' }).select('id,username,role,scheduled_entry,scheduled_exit').single());

console.log('✓ SuperAdmin listo:', user);
console.log('✓ Bucket privado listo:', PHOTO_BUCKET);
console.log('✓ Credenciales: Velcco / Velcco2026@');
