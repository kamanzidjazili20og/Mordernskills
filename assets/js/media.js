/* Modern Skills — shared media/image helpers.
   Fixes URL resolution for thumbnails, avatars and videos coming from
   Supabase Storage (absolute URLs), the API (/uploads/...) or the
   frontend's own static assets (Images/...). */
(function (global) {
    'use strict';

    var API_ORIGIN = (global.MODERN_SKILLS_CONFIG && global.MODERN_SKILLS_CONFIG.API_URL)
        || (location.protocol === 'file:' ? 'http://localhost:3001' : location.origin);

    API_ORIGIN = String(API_ORIGIN || '').replace(/\/+$/, '');

    /* Branded 16:9 placeholder used whenever a lesson has no usable image. */
    var PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">' +
        '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">' +
        '<stop offset="0" stop-color="#0b1a13"/><stop offset="1" stop-color="#3a5f4a"/>' +
        '</linearGradient></defs>' +
        '<rect width="640" height="360" fill="url(#g)"/>' +
        '<circle cx="320" cy="180" r="52" fill="none" stroke="#d4a853" stroke-width="3" opacity="0.7"/>' +
        '<polygon points="308,152 308,208 352,180" fill="#d4a853" opacity="0.9"/>' +
        '</svg>'
    );

    var CATEGORY_IMAGES = {
        'quran': 'Images/thumbnails/thumb_seed_11.jpg',
        'quran courses': 'Images/thumbnails/thumb_seed_11.jpg',
        "qur'an courses": 'Images/thumbnails/thumb_seed_11.jpg',
        'quran-course': 'Images/thumbnails/thumb_seed_11.jpg',
        'tajweed': 'Images/thumbnails/thumb_seed_11.jpg',
        'tafsir': 'Images/thumbnails/thumb_seed_5.jpg',
        'hifz': 'Images/thumbnails/thumb_seed_9.jpg',
        'arabic': 'Images/thumbnails/thumb_seed_3.jpg',
        'english': 'Images/thumbnails/thumb_seed_1.jpg',
        'english course': 'Images/thumbnails/thumb_seed_1.jpg',
        'video course': 'Images/thumbnails/thumb_seed_1.jpg',
        'video-course': 'Images/thumbnails/thumb_seed_1.jpg'
    };

    /* Last-resort artwork so a lesson never renders a broken image. */
    var DEFAULT_CATEGORY_IMAGE = 'Images/thumbnails/thumb_seed_11.jpg';

    function tidy(u) {
        return String(u == null ? '' : u).trim().replace(/\\/g, '/');
    }

    /* Turn any stored media path into a URL the browser can actually load. */
    function resolve(url) {
        var u = tidy(url);
        if (!u) return '';
        if (/^(https?:)?\/\//i.test(u)) return u;
        if (/^(data|blob):/i.test(u)) return u;
        /* API-served uploads must be absolute — the frontend may be on another host. */
        if (/^\/?uploads\//i.test(u)) return API_ORIGIN + '/' + u.replace(/^\/+/, '');
        /* Frontend static assets (Images/...) stay relative to this document. */
        return u;
    }

    function categoryImage(lesson) {
        if (!lesson) return DEFAULT_CATEGORY_IMAGE;
        var key = tidy(lesson.category_name || lesson.category || lesson.category_slug).toLowerCase();
        return CATEGORY_IMAGES[key] || DEFAULT_CATEGORY_IMAGE;
    }

    /* Best available image for a lesson: real thumbnail, then category art, then placeholder. */
    function thumb(lesson) {
        if (!lesson) return PLACEHOLDER;
        var raw = lesson.thumbnail_url || lesson.thumbnail || lesson.image_url || lesson.poster_url;
        var url = resolve(raw);
        if (url) return url;
        if (lesson.category_name || lesson.category_slug) return categoryImage(lesson);
        return PLACEHOLDER;
    }

    function avatar(person) {
        if (!person) return PLACEHOLDER;
        var url = resolve(person.avatar_url || person.photo_url || person.image_url);
        return url || PLACEHOLDER;
    }

    /* Attach to an <img> so a 404 never leaves a broken-image icon on screen. */
    function harden(img, fallback) {
        if (!img) return img;
        img.addEventListener('error', function onErr() {
            img.removeEventListener('error', onErr);
            var fb = fallback || PLACEHOLDER;
            if (img.src !== fb) img.src = fb;
        }, { once: true });
        if (!img.getAttribute('alt')) img.setAttribute('alt', '');
        img.setAttribute('loading', img.getAttribute('loading') || 'lazy');
        img.setAttribute('decoding', 'async');
        return img;
    }

    /* Build an <img> that is already hardened against broken sources. */
    function img(src, className, fallback) {
        var el = document.createElement('img');
        if (className) el.className = className;
        el.src = resolve(src) || fallback || PLACEHOLDER;
        return harden(el, fallback);
    }

    function escapeHtml(str) {
        return String(str == null ? '' : str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    global.MS_MEDIA = {
        API_ORIGIN: API_ORIGIN,
        PLACEHOLDER: PLACEHOLDER,
        CATEGORY_IMAGES: CATEGORY_IMAGES,
        resolve: resolve,
        categoryImage: categoryImage,
        thumb: thumb,
        avatar: avatar,
        harden: harden,
        img: img,
        escapeHtml: escapeHtml
    };
})(window);
