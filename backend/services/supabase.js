const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const avatarBucket = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';
const videoBucket = process.env.SUPABASE_VIDEO_BUCKET || 'videos';
const thumbnailBucket = process.env.SUPABASE_THUMBNAIL_BUCKET || 'thumbnails';
const bookBucket = process.env.SUPABASE_BOOK_BUCKET || 'books';
const enabled = Boolean(url && serviceKey);
const supabase = enabled ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

// Upload a local file (saved to disk by multer) to a Supabase Storage bucket.
// The stored object gets a public URL that the frontend can stream directly.
async function uploadFileToSupabase(file, destBucket, folder) {
  if (!enabled || !file) return null;
  if (!fs.existsSync(file.path)) return null;

  const ext = (file.originalname.match(/\.[^.]+$/) || ['.bin'])[0].toLowerCase();
  const objectPath = `${folder}/${uuidv4()}${ext}`;
  const data = fs.readFileSync(file.path);

  const { error } = await supabase.storage.from(destBucket).upload(objectPath, data, {
    contentType: file.mimetype || 'application/octet-stream',
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw error;

  const { data: pub } = supabase.storage.from(destBucket).getPublicUrl(objectPath);
  return pub.publicUrl;
}

async function uploadVideoToSupabase(file) {
  return uploadFileToSupabase(file, videoBucket, 'lessons');
}

async function uploadThumbnailToSupabase(file) {
  return uploadFileToSupabase(file, thumbnailBucket, 'lessons');
}

// Book documents (PDFs). Objects land under books/ in the "books" bucket and
// get a public URL the reader embeds inline.
async function uploadBookFileToSupabase(file) {
  return uploadFileToSupabase(file, bookBucket, 'books');
}

async function uploadAvatarToSupabase(file) {
  if (!enabled || !file) return null;
  const ext = (file.originalname.match(/\.[^.]+$/) || ['.jpg'])[0].toLowerCase();
  const objectPath = `profiles/${uuidv4()}${ext}`;
  const { error } = await supabase.storage.from(avatarBucket).upload(objectPath, file.buffer, {
    contentType: file.mimetype,
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from(avatarBucket).getPublicUrl(objectPath);
  return data.publicUrl;
}

// Ensure the storage buckets we rely on exist. Idempotent and non-blocking:
// if Supabase is unreachable at boot we still serve uploads from local disk,
// and uploadFileToSupabase will surface any per-call error to the caller.
async function ensureBuckets() {
  if (!enabled) return;
  const specs = [
    { id: avatarBucket, public: true },
    { id: videoBucket, public: true },
    { id: thumbnailBucket, public: true },
    { id: bookBucket, public: true }
  ];
  for (const spec of specs) {
    try {
      const { error } = await supabase.storage.getBucket(spec.id);
      if (error && error.message && /not found|does not exist|404/i.test(String(error.message))) {
        const { error: createErr } = await supabase.storage.createBucket(spec.id, { public: spec.public });
        if (createErr) console.warn(`[supabase] could not auto-create bucket "${spec.id}":`, createErr.message);
        else console.log(`[supabase] created storage bucket "${spec.id}"`);
      }
    } catch (err) {
      console.warn(`[supabase] bucket check skipped for "${spec.id}":`, err.message);
    }
  }
}
if (enabled) {
  ensureBuckets().catch(() => {}); // never let boot fail on storage setup
}

module.exports = {
  enabled,
  uploadAvatarToSupabase,
  uploadVideoToSupabase,
  uploadThumbnailToSupabase,
  uploadBookFileToSupabase
};