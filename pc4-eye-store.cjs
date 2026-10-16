// PC4 only. Never reuse the IDE's other Supabase connections.
const BUCKET = 'pc4-eye-private';
function createPc4EyeStore({ env = process.env, createClient } = {}) {
  let client, ready = false, busy = false;
  async function save(bytes, mime) {
    if (busy) throw new Error('pc4_storage_busy');
    const jpeg = bytes?.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png = bytes?.length >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    if (!Buffer.isBuffer(bytes) || bytes.length > 4500000 ||
        !((mime === 'image/jpeg' && jpeg) || (mime === 'image/png' && png))) {
      throw new Error('pc4_invalid_image');
    }
    busy = true;
    try {
      if (!client) {
        const url = env.SUPABASE_URL_3;
        if (!url || !/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url) || !env.SUPABASE_SECRET_KEY_3) {
          throw new Error('pc4_storage_not_configured');
        }
        const factory = createClient || require('@supabase/supabase-js').createClient;
        client = factory(url, env.SUPABASE_SECRET_KEY_3, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) },
        });
      }
      if (!ready) {
        // Creation can fail when already provisioned; always verify the actual
        // bucket, and never accept a public bucket or change an existing policy.
        await client.storage.createBucket(BUCKET, {
          public: false, fileSizeLimit: 4500000, allowedMimeTypes: ['image/jpeg', 'image/png'],
        });
        const checked = await client.storage.getBucket(BUCKET);
        if (checked.error || !checked.data || checked.data.public !== false) {
          throw new Error('pc4_private_storage_unavailable');
        }
        ready = true;
      }
      const result = await client.storage.from(BUCKET).upload('PC4/latest', bytes, {
        upsert: true, contentType: mime, cacheControl: '0',
      });
      if (result.error) throw new Error('pc4_storage_write_failed');
      return { stored: true };
    } catch {
      // Never disclose provider response, images or credentials.
      throw new Error('pc4_storage_unavailable');
    } finally {
      busy = false;
    }
  }
  return { save };
}
module.exports = { createPc4EyeStore };
