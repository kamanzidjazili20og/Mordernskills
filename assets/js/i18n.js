/* Modern Skills — shared language runtime for every public page.
 *
 * Five languages: English, Kinyarwanda, French, Swahili and Arabic. Arabic is
 * right-to-left, so the runtime owns the `dir` attribute as well as `lang`.
 * One storage key (`msPublicLang`) is shared by every public page, so a
 * language picked anywhere is picked everywhere, including other open tabs
 * (via the `storage` event, which is wired up per page).
 *
 * admin.html also loads this file, but only for MS_I18N.compareText (locale-
 * aware sorting) — it does not read or write `msPublicLang` and does not
 * listen for the `ms:langchange` event this file emits. The admin panel keeps
 * its own separate key (`noorAdminPanelLang`) and its own full 5-language
 * toggle, so a visitor changing the public site's language, in this tab or
 * any other, never changes the signed-in admin's language, and the reverse
 * is also true.
 *
 * Markup contract
 * ---------------
 *   <span data-lang="rw">Amasomo</span>
 * Every span for the active language is shown and the rest are hidden. Because
 * all five variants live in the DOM at once, the text stays indexable by search
 * engines and the page needs no network round-trip to switch language.
 *
 * Central catalog
 * ---------------
 * `assets/js/translations.js` defines window.MS_TRANSLATIONS, keyed by the
 * English text of each string. When it is present this runtime replaces the
 * inline text of every [data-lang] variant from that catalog, so editing one
 * file changes the words on every page. When it is absent (or a key is missing)
 * the inline text is used unchanged, so the site never breaks.
 *
 * API
 * ---
 *   MS_I18N.getLang()                  -> current language code
 *   MS_I18N.setLang(code, opts)        -> apply a language; opts.silent skips the event
 *   MS_I18N.normalise(code)            -> code if supported, otherwise 'en'
 *   MS_I18N.readStored()               -> validated stored preference, otherwise 'en'
 *   MS_I18N.applyLangNodes(root)       -> re-apply spans inside a freshly injected node
 *   MS_I18N.applyTranslations(root)    -> overlay the central catalog onto spans (all langs)
 *   MS_I18N.t(strings, lang)           -> translate a {en,rw,fr,sw,ar} dict via the catalog
 *   MS_I18N.compareText(a, b)          -> locale-correct collation for sorting
 */
(function (global) {
    'use strict';

    var LANGS = ['en', 'rw', 'fr', 'sw', 'ar'];
    var RTL = { ar: true };
    var STORAGE_KEY = 'msPublicLang';
    /* `noorLang` and `noorAdminLang` predate the current key. `noorAdminLang` in
       particular invited confusion with the admin panel's own, separate
       `noorAdminPanelLang` key despite never being read by admin.html — renamed
       to avoid that mix-up. Both legacy keys are only ever read, never written,
       so an old preference still applies once and then gets overwritten. */
    var LEGACY_KEYS = ['noorAdminLang', 'noorLang'];

    function readStored() {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (LANGS.indexOf(saved) > -1) return saved;
        for (var i = 0; i < LEGACY_KEYS.length; i++) {
            var legacy = localStorage.getItem(LEGACY_KEYS[i]);
            if (LANGS.indexOf(legacy) > -1) return legacy;
        }
        return 'en';
    }

    var current = readStored();

    /* The editable word list, defined by assets/js/translations.js. It is keyed
       by the English text of each string; each value holds the other languages. */
    var CATALOG = (global.MS_TRANSLATIONS && typeof global.MS_TRANSLATIONS === 'object')
        ? global.MS_TRANSLATIONS : null;

    /* Whitespace is collapsed on both sides of a lookup so indented markup in the
       HTML still matches the plain-string keys in the catalog. */
    function normKey(value) {
        return String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    }

    /* Translation for one English phrase in one language, or null if the catalog
       has nothing (so callers can fall back to their built-in text). */
    function catalogLookup(englishText, lang) {
        if (!CATALOG || !englishText || lang === 'en') return null;
        var entry = CATALOG[normKey(englishText)];
        if (entry && typeof entry[lang] === 'string' && entry[lang] !== '') return entry[lang];
        return null;
    }

    /* Rewrite every [data-lang] variant of a group from the catalog. Groups are
       runs of sibling elements, each carrying a different language; the English
       sibling's text is the catalog key. Elements that contain nested markup are
       left alone, because replacing their text would drop that markup. */
    function collectGroup(enEl) {
        var nodes = [enEl];
        var seen = { en: true };
        /* Every group is authored English-first (en, rw, fr, sw, ar). Scanning
           forward only is deliberate: scanning backwards would walk into the
           tail of a *previous* group when two groups are adjacent siblings in
           the same parent, overwriting that group's translations. */
        var next = enEl.nextElementSibling;
        while (next && next.hasAttribute && next.hasAttribute('data-lang')) {
            var nl = next.getAttribute('data-lang');
            if (seen[nl]) break;
            seen[nl] = true;
            nodes.push(next);
            next = next.nextElementSibling;
        }
        return nodes;
    }

    function applyTranslations(root) {
        if (!CATALOG) return;
        var scope = root || document;
        if (!scope.querySelectorAll) return;
        scope.querySelectorAll('[data-lang="en"]').forEach(function (enEl) {
            if (enEl.children && enEl.children.length) return;
            var entry = CATALOG[normKey(enEl.textContent)];
            if (!entry) return;
            collectGroup(enEl).forEach(function (node) {
                var lang = node.getAttribute('data-lang');
                if (lang === 'en' || !entry[lang]) return;
                if (node.children && node.children.length) return;
                if (node.textContent !== entry[lang]) node.textContent = entry[lang];
            });
        });
    }

    /* Translate a {en,rw,fr,sw,ar} dictionary (or pill string) through the
       catalog first, then the dictionary itself. Used by the per-page dynamic
       strings (still-injected buttons, toasts, placeholders, …). */
    function translate(entry, lang) {
        lang = normalise(lang || current);
        if (entry == null) return '';
        if (typeof entry === 'string') {
            var direct = catalogLookup(entry, lang);
            return direct !== null ? direct : entry;
        }
        if (typeof entry.en === 'string') {
            var viaCatalog = catalogLookup(entry.en, lang);
            if (viaCatalog !== null) return viaCatalog;
        }
        return entry[lang] || entry.en || '';
    }

    /* Hide every [data-lang] span except the active one. */
    function applyLangNodes(root) {
        var scope = root || document;
        if (!scope.querySelectorAll) return;
        applyTranslations(scope);
        scope.querySelectorAll('[data-lang]').forEach(function (el) {
            el.style.display = el.getAttribute('data-lang') === current ? '' : 'none';
        });
    }

    /* The single place a language code is accepted or rejected. Pages call this
       instead of trusting localStorage, so a stale or hand-edited value can never
       leave the site in a language it has no UI for. */
    function normalise(lang) {
        return LANGS.indexOf(lang) > -1 ? lang : 'en';
    }

    function setLang(lang, opts) {
        current = normalise(lang);
        document.body.className = document.body.className.replace(/\blang-\w+/g, '').trim();
        document.body.classList.add('lang-' + current);
        document.documentElement.lang = current;
        document.documentElement.dir = RTL[current] ? 'rtl' : 'ltr';
        localStorage.setItem(STORAGE_KEY, current);
        LEGACY_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        applyLangNodes();
        document.querySelectorAll('[data-lang-code]').forEach(function (opt) {
            opt.classList.toggle('active', opt.getAttribute('data-lang-code') === current);
        });
        if (!opts || opts.silent !== true) emit();
        return current;
    }

    function emit() {
        document.dispatchEvent(new CustomEvent('ms:langchange', { detail: { lang: current } }));
    }

    /* Cross-tab sync. The `storage` event fires in every *other* tab, so each
       page can adopt a language chosen elsewhere without reloading. We only
       update local state and announce it — writing back here would be a no-op
       that still risks feedback loops between tabs. */
    window.addEventListener('storage', function (e) {
        if (e.key !== STORAGE_KEY || LANGS.indexOf(e.newValue) === -1) return;
        if (e.newValue === current) return;
        current = e.newValue;
        document.body.className = document.body.className.replace(/\blang-\w+/g, '').trim();
        document.body.classList.add('lang-' + current);
        document.documentElement.lang = current;
        document.documentElement.dir = RTL[current] ? 'rtl' : 'ltr';
        LEGACY_KEYS.forEach(function (k) { localStorage.removeItem(k); });
        applyLangNodes();
        document.querySelectorAll('[data-lang-code]').forEach(function (opt) {
            opt.classList.toggle('active', opt.getAttribute('data-lang-code') === current);
        });
        emit();
    });

    /* Collation-aware comparison so A → Z also behaves for accented scripts.
       The collator is cached per language, because Intl.Collator is not live:
       a collator built for one locale keeps using it after the language changes. */
    var collators = {};
    function getCollator(lang) {
        if (collators[lang] !== undefined) return collators[lang];
        try { collators[lang] = new Intl.Collator(lang, { sensitivity: 'base', numeric: true }); }
        catch (e) { collators[lang] = null; }
        return collators[lang];
    }
    function compareText(a, b) {
        a = String(a == null ? '' : a).trim();
        b = String(b == null ? '' : b).trim();
        var c = getCollator(current);
        if (c) return c.compare(a, b);
        return a.localeCompare(b);
    }

    global.MS_I18N = {
        LANGS: LANGS,
        STORAGE_KEY: STORAGE_KEY,
        getLang: function () { return current; },
        setLang: setLang,
        /* Pages use these two so they never invent their own accept/reject rules
           (and never disagree with each other about the current language). */
        normalise: normalise,
        readStored: readStored,
        applyLangNodes: applyLangNodes,
        applyTranslations: applyTranslations,
        t: translate,
        compareText: compareText
    };

    /* Overlay the catalog as soon as the document is parsed, so the very first
       paint already shows the edited words. */
    function applyOnReady() { applyTranslations(document); }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', applyOnReady, { once: true });
    } else {
        applyOnReady();
    }
})(typeof window !== 'undefined' ? window : this);