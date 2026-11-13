/* Modern Skills - navbar lesson search.
 *
 * Drop an element with [data-nav-search] into a page header and this module
 * self-mounts: a debounced search box that queries GET /api/lessons?search=
 * and navigates to video.html?id=<lesson id> when a result is chosen.
 *
 * Optional attributes on the host element:
 *   data-placeholder="Search lessons..."   (default: "Search lessons")
 *   data-limit="8"                         (default: 8, max 20)
 *
 * Manual use:  MSSearch.mount(document.querySelector('#mySearch'), opts)
 */
(function () {
    'use strict';

    var API_ORIGIN = (window.MODERN_SKILLS_CONFIG && window.MODERN_SKILLS_CONFIG.API_URL)
        || (location.protocol === 'file:' ? 'http://localhost:3001' : location.origin);
    var API = API_ORIGIN + '/api';
    var MIN_CHARS = 2;
    var DEBOUNCE_MS = 220;

    var STYLES = [
        '.nav-search{position:relative;display:flex;align-items:center;width:min(300px,38vw);min-width:150px;}',
        '.nav-search .nav-search-icon{position:absolute;left:13px;font-size:12px;color:var(--text-muted,#7e958a);pointer-events:none;}',
        '.nav-search-input{width:100%;height:40px;padding:0 34px 0 34px;border-radius:999px;border:1px solid rgba(212,168,83,0.25);',
        'background:rgba(8,24,17,0.72);color:var(--text,#e9f2ec);font-size:13px;font-family:inherit;outline:none;transition:border-color .15s ease,box-shadow .15s ease,background .15s ease;}',
        '.nav-search-input::placeholder{color:var(--text-muted,#7e958a);}',
        '.nav-search-input:focus{border-color:var(--gold,#d4a853);box-shadow:0 0 0 3px rgba(212,168,83,0.16);background:rgba(8,24,17,0.95);}',
        '.nav-search-clear{position:absolute;right:8px;width:26px;height:26px;border:none;border-radius:50%;cursor:pointer;',
        'background:rgba(255,255,255,0.06);color:var(--text-sec,#9db4a9);display:flex;align-items:center;justify-content:center;font-size:11px;}',
        '.nav-search-clear:hover{background:rgba(255,255,255,0.12);color:var(--text,#e9f2ec);}',
        '.nav-search-results{position:absolute;top:calc(100% + 8px);left:0;right:0;z-index:1200;max-height:min(70vh,440px);overflow-y:auto;',
        'border-radius:16px;border:1px solid rgba(212,168,83,0.22);background:linear-gradient(180deg,rgba(10,26,19,0.99),rgba(7,19,14,0.99));',
        'box-shadow:0 30px 70px -30px rgba(0,0,0,0.85);padding:6px;}',
        '.nav-search-results[hidden]{display:none;}',
        '.nav-search-item{display:flex;align-items:center;gap:11px;padding:9px 10px;border-radius:11px;cursor:pointer;text-decoration:none;color:inherit;}',
        '.nav-search-item:hover,.nav-search-item.active{background:rgba(212,168,83,0.12);}',
        '.nav-search-thumb{width:52px;height:36px;border-radius:9px;object-fit:cover;flex:0 0 auto;background:rgba(212,168,83,0.14);}',
        '.nav-search-meta{min-width:0;flex:1;}',
        '.nav-search-title{font-size:13.5px;font-weight:700;color:var(--text,#e9f2ec);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.nav-search-sub{font-size:11px;color:var(--text-muted,#7e958a);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px;}',
        '.nav-search-state{padding:16px 12px;text-align:center;font-size:12.5px;color:var(--text-muted,#7e958a);}',
        '.nav-search-state .fa-spin{color:var(--gold,#d4a853);}',
        '@media (max-width:820px){.nav-search{width:100%;order:3;margin-top:6px;}}'
    ].join('\n');

    var cssDone = false;
    function injectCss() {
        if (cssDone || document.getElementById('mss-style')) { cssDone = true; return; }
        var style = document.createElement('style');
        style.id = 'mss-style';
        style.textContent = STYLES;
        document.head.appendChild(style);
        cssDone = true;
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function thumbFor(lesson) {
        if (!lesson) return '';
        if (window.MS_MEDIA && typeof MS_MEDIA.thumb === 'function') {
            try { return MS_MEDIA.thumb(lesson); } catch (e) { /* fall through */ }
        }
        return lesson.thumbnail_url || 'Images/thumbnails/thumb_seed_1.jpg';
    }

    function mount(host, opts) {
        if (!host || host.dataset.mssMounted === '1') return null;
        injectCss();
        opts = opts || {};
        host.dataset.mssMounted = '1';
        host.classList.add('nav-search');

        var limit = Math.min(Math.max(parseInt(opts.limit || host.dataset.limit, 10) || 8, 1), 20);
        var placeholder = opts.placeholder || host.dataset.placeholder || 'Search lessons';

        host.innerHTML = ''
            + '<i class="fas fa-search nav-search-icon"></i>'
            + '<input type="search" class="nav-search-input" placeholder="' + esc(placeholder) + '" '
            + 'aria-label="' + esc(placeholder) + '" autocomplete="off" spellcheck="false">'
            + '<button type="button" class="nav-search-clear" aria-label="Clear search" hidden><i class="fas fa-times"></i></button>'
            + '<div class="nav-search-results" role="listbox" hidden></div>';

        var input = host.querySelector('.nav-search-input');
        var clearBtn = host.querySelector('.nav-search-clear');
        var results = host.querySelector('.nav-search-results');

        var timer = 0;
        var seq = 0;
        var items = [];
        var activeIndex = -1;

        function close() {
            results.hidden = true;
            results.innerHTML = '';
            items = [];
            activeIndex = -1;
        }

        function setState(html) {
            results.hidden = false;
            results.innerHTML = '<div class="nav-search-state">' + html + '</div>';
            items = [];
            activeIndex = -1;
        }

        function paintActive() {
            var nodes = results.querySelectorAll('.nav-search-item');
            nodes.forEach(function (node, index) {
                node.classList.toggle('active', index === activeIndex);
            });
            if (activeIndex >= 0 && nodes[activeIndex]) {
                nodes[activeIndex].scrollIntoView({ block: 'nearest' });
            }
        }

        function go(lesson) {
            if (!lesson || !lesson.id) return;
            window.location.href = 'video.html?id=' + encodeURIComponent(lesson.id);
        }

        function render(lessons) {
            if (!lessons.length) {
                setState('No lessons match that search.');
                return;
            }
            results.hidden = false;
            results.innerHTML = lessons.map(function (lesson, index) {
                var sub = [lesson.category_name, lesson.difficulty].filter(Boolean).join(' \u00b7 ');
                return '<a class="nav-search-item" role="option" data-index="' + index + '" href="video.html?id=' + encodeURIComponent(lesson.id) + '">'
                    + '<img class="nav-search-thumb" src="' + esc(thumbFor(lesson)) + '" alt="" loading="lazy">'
                    + '<span class="nav-search-meta">'
                    + '<span class="nav-search-title">' + esc(lesson.title || 'Untitled lesson') + '</span>'
                    + '<span class="nav-search-sub">' + esc(sub || 'Lesson') + '</span>'
                    + '</span></a>';
            }).join('');
            items = lessons.slice();
            activeIndex = -1;

            results.querySelectorAll('.nav-search-item').forEach(function (node) {
                node.addEventListener('click', function (e) {
                    e.preventDefault();
                    go(items[Number(node.dataset.index)]);
                });
            });
        }

        function search(term) {
            var query = String(term || '').trim();
            if (query.length < MIN_CHARS) { close(); return; }
            var mine = ++seq;
            setState('<i class="fas fa-circle-notch fa-spin"></i> Searching...');
            fetch(API + '/lessons?search=' + encodeURIComponent(query) + '&limit=' + limit)
                .then(function (res) { return res.ok ? res.json() : { lessons: [] }; })
                .then(function (data) {
                    if (mine !== seq) return;
                    render((data && data.lessons) || []);
                })
                .catch(function () {
                    if (mine !== seq) return;
                    setState('Search is unavailable right now.');
                });
        }

        input.addEventListener('input', function () {
            clearBtn.hidden = !input.value;
            window.clearTimeout(timer);
            var value = input.value;
            timer = window.setTimeout(function () { search(value); }, DEBOUNCE_MS);
        });

        input.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowDown') {
                if (!items.length) return;
                e.preventDefault();
                activeIndex = (activeIndex + 1) % items.length;
                paintActive();
            } else if (e.key === 'ArrowUp') {
                if (!items.length) return;
                e.preventDefault();
                activeIndex = (activeIndex - 1 + items.length) % items.length;
                paintActive();
            } else if (e.key === 'Enter') {
                if (activeIndex >= 0 && items[activeIndex]) {
                    e.preventDefault();
                    go(items[activeIndex]);
                } else if (items.length === 1) {
                    e.preventDefault();
                    go(items[0]);
                }
            } else if (e.key === 'Escape') {
                close();
                input.blur();
            }
        });

        clearBtn.addEventListener('click', function () {
            input.value = '';
            clearBtn.hidden = true;
            close();
            input.focus();
        });

        input.addEventListener('focus', function () {
            if (input.value.trim().length >= MIN_CHARS && items.length) results.hidden = false;
        });

        document.addEventListener('click', function (e) {
            if (!host.contains(e.target)) close();
        });

        return { host: host, input: input };
    }

    function initAll(root) {
        (root || document).querySelectorAll('[data-nav-search]').forEach(function (node) {
            mount(node);
        });
    }

    window.MSSearch = { mount: mount, init: initAll };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initAll(); });
    } else {
        initAll();
    }
})();
