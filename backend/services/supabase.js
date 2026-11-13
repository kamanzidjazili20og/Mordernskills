const { createClient } = require('@supabase/supabase-js');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const avatarBucket = process.env.SUPABASE_AVATAR_BUCKET || 'avatars';
const videoBucket = process.env.SUPABASE_VIDEO_BUCKET || 'videos';
const thumbnailBucket = process.env.SUPABASE_THUMBNAIL_BUCKET || 'thumbnails';
const bookBucket = process.env.SUPABASE_BOOK_BUCKET || 'books';
const recitationBucket = process.env.SUPABASE_RECITATION_BUCKET || 'recitations';
const enabled = Boolean(url && serviceKey);
const supabase = enabled ? createClient(url, serviceKey, { auth: { persistSession: false } }) : null;

// Browsers label MediaRecorder output inconsistently; prefer a real extension
// but fall back to one inferred from the MIME type.
function recordingExtension(file) {
  const fromName = (String(file.originalname || '').match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
  const allowed = ['.webm', '.ogg', '.oga', '.mp3', '.m4a', '.mp4', '.wav', '.aac'];
  if (allowed.includes(fromName)) return fromName;
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.includes('ogg')) return '.ogg';
  if (mime.includes('mp4') || mime.includes('m4a')) return '.m4a';
  if (mime.includes('mpeg')) return '.mp3';
  if (mime.includes('wav')) return '.wav';
  if (mime.includes('aac')) return '.aac';
  return '.webm';
}

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

// Private recitation upload. No public URL is generated: playback goes
// through the API so every request can be authorized first.
async function uploadRecitationToSupabase(file) {
  if (!enabled || !file) return null;
  const ext = recordingExtension(file);
  const objectPath = `submissions/${uuidv4()}${ext}`;
  // MediaRecorder reports "audio/webm;codecs=opus"; Storage's allowlist only
  // matches the base type, so strip the codec parameters here. If the browser
  // sent a generic type, fall back to the extension.
  const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
  const inferred = { '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac' }[ext] || 'audio/webm';
  const contentType = declared.startsWith('audio/') || declared === 'video/webm' ? declared : inferred;
  const { error } = await supabase.storage.from(recitationBucket).upload(objectPath, file.buffer, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw error;
  return { bucket: recitationBucket, path: objectPath };
}

// Download a private recording with the service-role client. The HTTP route
// streams the returned bytes only after it has checked who is asking.
async function downloadRecitationFromSupabase(objectPath) {
  if (!enabled) throw new Error('Supabase Storage is not configured');
  const { data, error } = await supabase.storage.from(recitationBucket).download(objectPath);
  if (error) throw error;
  if (!data) throw new Error('Recording not found in storage');
  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: data.type || 'application/octet-stream'
  };
}

// Private comment voice notes. They live in the same private "recitations"
// bucket under a comments/ prefix so no extra bucket has to be provisioned.
async function uploadCommentAudioToSupabase(file) {
  if (!enabled || !file) return null;
  const ext = recordingExtension(file);
  const objectPath = `comments/${uuidv4()}${ext}`;
  const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
  const inferred = { '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac' }[ext] || 'audio/webm';
  const contentType = declared.startsWith('audio/') || declared === 'video/webm' ? declared : inferred;
  const { error } = await supabase.storage.from(recitationBucket).upload(objectPath, file.buffer, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw error;
  return { bucket: recitationBucket, path: objectPath };
}

// Private teacher voice feedback. Same private bucket, feedback/ prefix.
async function uploadFeedbackAudioToSupabase(file) {
  if (!enabled || !file) return null;
  const ext = recordingExtension(file);
  const objectPath = `feedback/${uuidv4()}${ext}`;
  const declared = String(file.mimetype || '').split(';')[0].trim().toLowerCase();
  const inferred = { '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.wav': 'audio/wav', '.aac': 'audio/aac' }[ext] || 'audio/webm';
  const contentType = declared.startsWith('audio/') || declared === 'video/webm' ? declared : inferred;
  const { error } = await supabase.storage.from(recitationBucket).upload(objectPath, file.buffer, {
    contentType,
    upsert: false,
    cacheControl: '3600',
  });
  if (error) throw error;
  return { bucket: recitationBucket, path: objectPath };
}

async function downloadFeedbackAudioFromSupabase(objectPath) {
  if (!enabled) throw new Error('Supabase Storage is not configured');
  const { data, error } = await supabase.storage.from(recitationBucket).download(objectPath);
  if (error) throw error;
  if (!data) throw new Error('Voice feedback not found in storage');
  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: data.type || 'application/octet-stream'
  };
}

// Best-effort cleanup for replaced or cleared private audio.
async function deletePrivateAudioFromSupabase(objectPath) {
  if (!enabled || !objectPath) return false;
  try {
    const { error } = await supabase.storage.from(recitationBucket).remove([objectPath]);
    return !error;
  } catch (err) {
    return false;
  }
}

async function downloadCommentAudioFromSupabase(objectPath) {
  if (!enabled) throw new Error('Supabase Storage is not configured');
  const { data, error } = await supabase.storage.from(recitationBucket).download(objectPath);
  if (error) throw error;
  if (!data) throw new Error('Voice note not found in storage');
  const arrayBuffer = await data.arrayBuffer();
  return {
    buffer: Buffer.from(arrayBuffer),
    contentType: data.type || 'application/octet-stream'
  };
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
    { id: bookBucket, public: true },
    { id: recitationBucket, public: false }
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
  recitationBucket,
  uploadAvatarToSupabase,
  uploadVideoToSupabase,
  uploadThumbnailToSupabase,
  uploadBookFileToSupabase,
  uploadRecitationToSupabase,
  downloadRecitationFromSupabase,
  uploadFeedbackAudioToSupabase,
  downloadFeedbackAudioFromSupabase,
  deletePrivateAudioFromSupabase,
  uploadCommentAudioToSupabase,
  downloadCommentAudioFromSupabase
};