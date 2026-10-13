/* Modern Skills — shared language runtime for every public page.
 *
 * Five languages: English, Kinyarwanda, French, Swahili and Arabic. Arabic is
 * right-to-left, so the runtime owns the `dir` attribute as well as `lang`.
 * One storage key (`noorAdminLang`) is shared by all pages, so a language picked
 * anywhere is picked everywhere, including other open tabs (via the `storage`
 * event, which is wired up per page).
 *
 * The admin panel deliberately does NOT use this runtime: it is English and
 * Kinyarwanda only and keeps its own key (`noorAdminPanelLang`), so switching the
 * public site to another language never changes the admin UI.
 *
 * Markup contract
 * ---------------
 *   <span data-lang="rw">Amasomo</span>
 * Every span for the active language is shown and the rest are hidden. Because
 * all five variants live in the DOM at once, the text stays indexable by search
 * engines and the page needs no network round-trip to switch language.
 *
 * API
 * ---
 *   MS_I18N.getLang()            -> current language code
 *   MS_I18N.setLang(code, opts)  -> apply a language; opts.silent skips the event
 *   MS_I18N.normalise(code)      -> code if supported, otherwise 'en'
 *   MS_I18N.readStored()         -> validated stored preference, otherwise 'en'
 *   MS_I18N.applyLangNodes(root) -> re-apply spans inside a freshly injected node
 *   MS_I18N.compareText(a, b)    -> locale-correct collation for sorting
 */
(function (global) {
    'use strict';

    var LANGS = ['en', 'rw', 'fr', 'sw', 'ar'];
    var RTL = { ar: true };
    var STORAGE_KEY = 'noorAdminLang';
    /* `noorLang` predates the shared key. It is only ever read, never written,
       so an old preference still applies once and then gets overwritten. */
    var LEGACY_KEY = 'noorLang';

    function readStored() {
        var saved = localStorage.getItem(STORAGE_KEY);
        if (LANGS.indexOf(saved) > -1) return saved;
        var legacy = localStorage.getItem(LEGACY_KEY);
        return LANGS.indexOf(legacy) > -1 ? legacy : 'en';
    }

    var current = readStored();

    /* Hide every [data-lang] span except the active one. */
    function applyLangNodes(root) {
        var scope = root || document;
        if (!scope.querySelectorAll) return;
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
        localStorage.removeItem(LEGACY_KEY);
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
        localStorage.removeItem(LEGACY_KEY);
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
        compareText: compareText
    };
})(typeof window !== 'undefined' ? window : this);