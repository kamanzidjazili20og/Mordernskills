const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const VIDEO_DIR = path.join(__dirname, '..', 'uploads', 'videos');
const THUMBNAIL_DIR = path.join(__dirname, '..', 'uploads', 'thumbnails');
const AVATAR_DIR = path.join(__dirname, '..', 'uploads', 'avatars');
const BOOK_DIR = path.join(__dirname, '..', 'uploads', 'books');

// Recitations are private: this directory is NOT under uploads/, so
// express.static can never expose a recording without an auth check.
const RECITATION_DIR = path.join(__dirname, '..', 'private', 'recitations');

for (const dir of [VIDEO_DIR, THUMBNAIL_DIR, AVATAR_DIR, BOOK_DIR, RECITATION_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
}

const videoStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(VIDEO_DIR, { recursive: true });
        cb(null, VIDEO_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `video_${uuidv4()}${ext}`);
    }
});

const imageStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(THUMBNAIL_DIR, { recursive: true });
        cb(null, THUMBNAIL_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `thumb_${uuidv4()}${ext}`);
    }
});

const avatarStorage = multer.memoryStorage();

// Book documents (PDFs) are stored on disk like videos/thumbnails and then
// mirrored to Supabase Storage when it is configured.
const bookStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        fs.mkdirSync(BOOK_DIR, { recursive: true });
        cb(null, BOOK_DIR);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `book_${uuidv4()}${ext}`);
    }
});

const avatarFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Invalid avatar format. Allowed: ${allowed.join(', ')}`));
};

const videoFilter = (req, file, cb) => {
    const allowed = ['.mp4', '.mov', '.webm', '.avi', '.mkv'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid video format. Allowed: ${allowed.join(', ')}`));
    }
};

const imageFilter = (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid image format. Allowed: ${allowed.join(', ')}`));
    }
};

const bookFilter = (req, file, cb) => {
    const allowed = ['.pdf'];
    const ext = path.extname(file.originalname).toLowerCase();
    // Accept by extension or by MIME type — some browsers send an empty/odd
    // extension but still report application/pdf.
    if (allowed.includes(ext) || (file.mimetype || '').toLowerCase() === 'application/pdf') {
        cb(null, true);
    } else {
        cb(new Error(`Invalid book format. Allowed: ${allowed.join(', ')}`));
    }
};

// MediaRecorder emits "audio/webm;codecs=opus" in Chrome, "audio/mp4" in
// Safari and "audio/ogg;codecs=opus" in Firefox. Match on the base MIME type
// as well as the extension so all three browsers are accepted.
const RECITATION_EXTENSIONS = ['.webm', '.ogg', '.oga', '.mp3', '.m4a', '.mp4', '.wav', '.aac'];
const RECITATION_MIME_PREFIXES = ['audio/', 'video/webm'];

const recitationFilter = (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase();
    const mimeOk = RECITATION_MIME_PREFIXES.some(prefix => mime.startsWith(prefix));
    if (RECITATION_EXTENSIONS.includes(ext) || mimeOk) {
        cb(null, true);
    } else {
        cb(new Error(`Invalid recording format. Allowed: ${RECITATION_EXTENSIONS.join(', ')}`));
    }
};

const MAX_VIDEO_SIZE = (parseInt(process.env.MAX_VIDEO_SIZE_MB) || 500) * 1024 * 1024;
const MAX_IMAGE_SIZE = (parseInt(process.env.MAX_IMAGE_SIZE_MB) || 5) * 1024 * 1024;
const MAX_BOOK_SIZE = (parseInt(process.env.MAX_BOOK_SIZE_MB) || 50) * 1024 * 1024;
const MAX_RECITATION_SIZE = (parseInt(process.env.MAX_RECITATION_SIZE_MB) || 25) * 1024 * 1024;

const uploadVideo = multer({
    storage: videoStorage,
    fileFilter: videoFilter,
    limits: { fileSize: MAX_VIDEO_SIZE }
});

const uploadImage = multer({
    storage: imageStorage,
    fileFilter: imageFilter,
    limits: { fileSize: MAX_IMAGE_SIZE }
});

const uploadAvatar = multer({
    storage: avatarStorage,
    fileFilter: avatarFilter,
    limits: { fileSize: MAX_IMAGE_SIZE }
});

const uploadBook = multer({
    storage: bookStorage,
    fileFilter: bookFilter,
    limits: { fileSize: MAX_BOOK_SIZE }
});

// Keep the recording in memory: it is either mirrored to Supabase Storage or
// written to the private local folder by the route after ownership checks.
const uploadRecitation = multer({
    storage: multer.memoryStorage(),
    fileFilter: recitationFilter,
    limits: { fileSize: MAX_RECITATION_SIZE }
});

module.exports = {
    uploadVideo,
    uploadImage,
    uploadAvatar,
    uploadBook,
    uploadRecitation,
    RECITATION_DIR,
    MAX_RECITATION_SIZE
};
