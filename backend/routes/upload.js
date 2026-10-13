const express = require('express');
const fs = require('fs');
const path = require('path');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { uploadVideo, uploadImage, uploadBook } = require('../middleware/upload');
const supabase = require('../services/supabase');

const router = express.Router();

// Returns the final public URL for a freshly uploaded file.
// When Supabase Storage is configured the file is mirrored there and the
// local copy is removed (keeps Render/Railway ephemeral disks small).
// Otherwise the relative /uploads/... path is returned (served by the API).
async function finalizeUploadedFile(file, folder) {
  const uploaders = {
    videos: () => supabase.uploadVideoToSupabase(file),
    thumbnails: () => supabase.uploadThumbnailToSupabase(file),
    books: () => supabase.uploadBookFileToSupabase(file)
  };
  const localUrl = `/uploads/${folder}/${file.filename}`;

  if (supabase.enabled && uploaders[folder]) {
    try {
      const publicUrl = await uploaders[folder]();
      if (publicUrl) {
        fs.unlink(file.path, () => {}); // remove local copy — file is safely in Supabase
        return { url: publicUrl, path: publicUrl, stored: 'supabase' };
      }
    } catch (err) {
      console.error(`Supabase upload (${folder}) failed, keeping local copy:`, err.message);
    }
  }

  return { url: localUrl, path: localUrl, stored: 'local', filename: file.filename };
}

router.post('/video', authenticate, requireAdmin, (req, res) => {
  uploadVideo.single('video')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Video exceeds maximum size of ${process.env.MAX_VIDEO_SIZE_MB || 500}MB` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No video file provided' });
    }

    try {
      const result = await finalizeUploadedFile(req.file, 'videos');
      res.json({
        message: 'Video uploaded successfully',
        file: {
          filename: path.basename(result.path).split('?')[0],
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          url: result.url,
          path: result.path,
          stored: result.stored
        }
      });
    } catch (uploadErr) {
      console.error('Video upload error:', uploadErr.message || uploadErr);
      res.status(500).json({ error: 'Video upload failed' });
    }
  });
});

router.post('/book-cover', authenticate, requireAdmin, (req, res) => {
  uploadImage.single('cover')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Image exceeds maximum size of ${process.env.MAX_IMAGE_SIZE_MB || 5}MB` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No cover image provided' });
    }

    try {
      const result = await finalizeUploadedFile(req.file, 'thumbnails');
      res.json({
        message: 'Book cover uploaded successfully',
        file: {
          filename: path.basename(result.path).split('?')[0],
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          url: result.url,
          path: result.path,
          stored: result.stored
        }
      });
    } catch (uploadErr) {
      console.error('Book cover upload error:', uploadErr.message || uploadErr);
      res.status(500).json({ error: 'Book cover upload failed' });
    }
  });
});

router.post('/book-file', authenticate, requireAdmin, (req, res) => {
  uploadBook.single('file')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Book file exceeds maximum size of ${process.env.MAX_BOOK_SIZE_MB || 50}MB` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No book file provided' });
    }

    try {
      const result = await finalizeUploadedFile(req.file, 'books');
      res.json({
        message: 'Book file uploaded successfully',
        file: {
          filename: path.basename(result.path).split('?')[0],
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          url: result.url,
          path: result.path,
          stored: result.stored
        }
      });
    } catch (uploadErr) {
      console.error('Book file upload error:', uploadErr.message || uploadErr);
      res.status(500).json({ error: 'Book file upload failed' });
    }
  });
});

router.post('/thumbnail', authenticate, requireAdmin, (req, res) => {
  uploadImage.single('thumbnail')(req, res, async (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: `Image exceeds maximum size of ${process.env.MAX_IMAGE_SIZE_MB || 5}MB` });
      }
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    try {
      const result = await finalizeUploadedFile(req.file, 'thumbnails');
      res.json({
        message: 'Thumbnail uploaded successfully',
        file: {
          filename: path.basename(result.path).split('?')[0],
          originalName: req.file.originalname,
          size: req.file.size,
          mimetype: req.file.mimetype,
          url: result.url,
          path: result.path,
          stored: result.stored
        }
      });
    } catch (uploadErr) {
      console.error('Thumbnail upload error:', uploadErr.message || uploadErr);
      res.status(500).json({ error: 'Thumbnail upload failed' });
    }
  });
});

module.exports = router;