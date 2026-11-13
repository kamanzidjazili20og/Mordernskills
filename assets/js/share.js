/* Modern Skills — professional share menu.
   Turns a plain share button into a share sheet with native share,
   copy-link and the common social targets. Self-contained: it injects
   its own styles, its own toast and its own positioning logic so any
   page can opt in by rendering a button with id="shareLessonBtn". */
(function (global) {
    'use strict';

    var MENU_ID = 'msShareMenu';
    var TOAST_ID = 'msShareToast';
    var GAP = 10;

    function onReady(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', fn, { once: true });
        } else {
            fn();
        }
    }

    function esc(s) {
        return String(s == null ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function pageUrl() {
        return location.href;
    }

    function pageTitle() {
        var el = document.getElementById('videoTitle');
        var t = el && el.textContent ? el.textContent.trim() : '';
        if (t) return t;
        var og = document.querySelector('meta[property="og:title"]');
        if (og && og.content) return og.content;
        return document.title || 'Modern Skills';
    }

    /* ---------- styles ---------- */
    function injectStyles() {
        if (document.getElementById('msShareStyles')) return;
        var css = '' +
            '#' + MENU_ID + '{position:fixed;z-index:2147483000;min-width:236px;padding:8px;' +
            'background:#101c15;background:linear-gradient(180deg,#13231a,#0d1712);' +
            'border:1px solid rgba(212,168,83,.28);border-radius:16px;' +
            'box-shadow:0 24px 60px -18px rgba(0,0,0,.72),0 4px 14px rgba(0,0,0,.4);' +
            'opacity:0;transform:translateY(6px) scale(.97);pointer-events:none;' +
            'transition:opacity .16s ease,transform .16s ease;font-family:inherit}' +
            '#' + MENU_ID + '.open{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}' +
            '#' + MENU_ID + ' .msh-title{padding:6px 10px 10px;font-size:11px;letter-spacing:.14em;' +
            'text-transform:uppercase;color:#8aa394;font-weight:700}' +
            '#' + MENU_ID + ' .msh-item{display:flex;align-items:center;gap:12px;width:100%;' +
            'padding:10px 11px;border:0;border-radius:11px;background:transparent;cursor:pointer;' +
            'color:#e9f1eb;font-size:14.5px;font-weight:600;text-align:left;font-family:inherit;' +
            'transition:background .14s ease,transform .14s ease}' +
            '#' + MENU_ID + ' .msh-item:hover{background:rgba(212,168,83,.12)}' +
            '#' + MENU_ID + ' .msh-item:active{transform:scale(.98)}' +
            '#' + MENU_ID + ' .msh-ico{display:flex;align-items:center;justify-content:center;' +
            'width:34px;height:34px;flex:0 0 34px;border-radius:10px;font-size:15px;' +
            'background:rgba(255,255,255,.06);color:#d4a853}' +
            '#' + MENU_ID + ' .msh-item[data-brand="whatsapp"] .msh-ico{background:rgba(37,211,102,.14);color:#25d366}' +
            '#' + MENU_ID + ' .msh-item[data-brand="telegram"] .msh-ico{background:rgba(34,158,217,.14);color:#229ed9}' +
            '#' + MENU_ID + ' .msh-item[data-brand="facebook"] .msh-ico{background:rgba(24,119,242,.14);color:#4a97ff}' +
            '#' + MENU_ID + ' .msh-item[data-brand="x"] .msh-ico{background:rgba(255,255,255,.08);color:#e9f1eb}' +
            '#' + MENU_ID + ' .msh-item[data-brand="email"] .msh-ico{background:rgba(212,168,83,.14);color:#d4a853}' +
            '#' + MENU_ID + ' .msh-sep{height:1px;margin:6px 8px;background:rgba(255,255,255,.07)}' +
            '#' + MENU_ID + ' .msh-check{margin-left:auto;color:#7fd6a0;font-size:13px;opacity:0;transition:opacity .15s}' +
            '#' + MENU_ID + ' .msh-item.copied .msh-check{opacity:1}' +
            '#' + TOAST_ID + '{position:fixed;left:50%;bottom:28px;transform:translate(-50%,14px);' +
            'z-index:2147483001;display:flex;align-items:center;gap:10px;padding:12px 18px;' +
            'background:#12241b;border:1px solid rgba(212,168,83,.35);border-radius:14px;' +
            'color:#eaf3ec;font-size:14px;font-weight:600;box-shadow:0 18px 44px -14px rgba(0,0,0,.7);' +
            'opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease;font-family:inherit}' +
            '#' + TOAST_ID + '.show{opacity:1;transform:translate(-50%,0)}' +
            '#' + TOAST_ID + ' i{color:#7fd6a0;font-size:16px}' +
            '@media (max-width:520px){#' + MENU_ID + '{left:12px !important;right:12px;min-width:0}}';
        var style = document.createElement('style');
        style.id = 'msShareStyles';
        style.textContent = css;
        document.head.appendChild(style);
    }

    /* ---------- toast ---------- */
    var toastTimer = null;
    function toast(msg) {
        var el = document.getElementById(TOAST_ID);
        if (!el) {
            el = document.createElement('div');
            el.id = TOAST_ID;
            el.setAttribute('role', 'status');
            el.setAttribute('aria-live', 'polite');
            document.body.appendChild(el);
        }
        el.innerHTML = '<i class="fas fa-circle-check"></i><span>' + esc(msg) + '</span>';
        void el.offsetWidth;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
    }

    /* ---------- copy ---------- */
    function copyLink(text) {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function (resolve, reject) {
            try {
                var ta = document.createElement('textarea');
                ta.value = text;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.opacity = '0';
                document.body.appendChild(ta);
                ta.select();
                ta.setSelectionRange(0, ta.value.length);
                var ok = document.execCommand('copy');
                document.body.removeChild(ta);
                ok ? resolve() : reject(new Error('copy-failed'));
            } catch (e) { reject(e); }
        });
    }

    /* ---------- share targets ---------- */
    function targets(url, title) {
        var u = encodeURIComponent(url);
        var t = encodeURIComponent(title);
        var list = [];
        if (navigator.share) {
            list.push({ brand: 'native', icon: 'fa-share-nodes', label: 'Share\u2026', action: 'native' });
        }
        list.push({ brand: 'copy', icon: 'fa-link', label: 'Copy link', action: 'copy' });
        list.push({ brand: 'whatsapp', icon: 'fa-whatsapp', label: 'WhatsApp', href: 'https://wa.me/?text=' + t + '%20' + u });
        list.push({ brand: 'telegram', icon: 'fa-telegram', label: 'Telegram', href: 'https://t.me/share/url?url=' + u + '&text=' + t });
        list.push({ brand: 'facebook', icon: 'fa-facebook-f', label: 'Facebook', href: 'https://www.facebook.com/sharer/sharer.php?u=' + u });
        list.push({ brand: 'x', icon: 'fa-x-twitter', label: 'X', href: 'https://twitter.com/intent/tweet?url=' + u + '&text=' + t });
        list.push({ brand: 'email', icon: 'fa-envelope', label: 'Email', href: 'mailto:?subject=' + t + '&body=' + u });
        return list;
    }

    function popup(href) {
        var w = 640, h = 620;
        var y = (screen.height - h) / 2, x = (screen.width - w) / 2;
        window.open(href, 'ms-share', 'noopener,noreferrer,width=' + w + ',height=' + h + ',top=' + y + ',left=' + x);
    }

    /* ---------- menu ---------- */
    var menu = null;
    var trigger = null;

    function buildMenu() {
        menu = document.createElement('div');
        menu.id = MENU_ID;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Share this lesson');
        document.body.appendChild(menu);
        menu.addEventListener('click', function (e) {
            var item = e.target.closest ? e.target.closest('.msh-item') : null;
            if (!item) return;
            var url = pageUrl();
            var title = pageTitle();
            var action = item.getAttribute('data-action');
            if (action === 'copy') {
                e.preventDefault();
                copyLink(url).then(function () {
                    item.classList.add('copied');
                    toast('Link copied to clipboard');
                    setTimeout(function () { close(); }, 650);
                }).catch(function () {
                    toast('Could not copy the link');
                });
                return;
            }
            if (action === 'native') {
                e.preventDefault();
                navigator.share({ title: title, url: url }).catch(function () {});
                close();
                return;
            }
            var href = item.getAttribute('data-href');
            if (href) {
                e.preventDefault();
                popup(href);
                close();
            }
        });
    }

    function fillMenu() {
        var url = pageUrl();
        var title = pageTitle();
        var list = targets(url, title);
        var html = '<div class="msh-title">Share</div>';
        list.forEach(function (item) {
            html += '<button type="button" class="msh-item" role="menuitem" data-brand="' + item.brand + '"' +
                (item.action ? ' data-action="' + item.action + '"' : '') +
                (item.href ? ' data-href="' + esc(item.href) + '"' : '') + '>' +
                '<span class="msh-ico"><i class="' + (item.brand === 'x' ? 'fab' : (item.brand === 'copy' || item.brand === 'native' ? 'fas' : 'fab')) + ' ' + item.icon + '"></i></span>' +
                '<span class="msh-label">' + esc(item.label) + '</span>' +
                '<i class="fas fa-check msh-check"></i></button>';
            if (item.brand === 'copy') html += '<div class="msh-sep"></div>';
        });
        menu.innerHTML = html;
    }

    function position() {
        if (!menu || !trigger) return;
        var r = trigger.getBoundingClientRect();
        var mw = menu.offsetWidth || 236;
        var mh = menu.offsetHeight || 300;
        var left = r.right - mw;
        if (left < 8) left = 8;
        if (left + mw > window.innerWidth - 8) left = window.innerWidth - mw - 8;
        var top = r.bottom + GAP;
        if (top + mh > window.innerHeight - 8 && r.top - GAP - mh > 8) {
            top = r.top - GAP - mh;
        }
        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
    }

    function open() {
        if (!menu) buildMenu();
        fillMenu();
        menu.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        position();
        var first = menu.querySelector('.msh-item');
        if (first) first.focus({ preventScroll: true });
    }

    function close() {
        if (!menu) return;
        menu.classList.remove('open');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }

    function toggle() {
        if (menu && menu.classList.contains('open')) close();
        else open();
    }

    function init() {
        trigger = document.getElementById('shareLessonBtn');
        if (!trigger) return;
        injectStyles();
        trigger.setAttribute('aria-haspopup', 'menu');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.addEventListener('click', function (e) {
            e.preventDefault();
            toggle();
        });
        document.addEventListener('click', function (e) {
            if (!menu || !menu.classList.contains('open')) return;
            if (menu.contains(e.target) || trigger.contains(e.target)) return;
            close();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') close();
        });
        window.addEventListener('resize', position);
        window.addEventListener('scroll', function () {
            if (menu && menu.classList.contains('open')) position();
        }, true);
    }

    onReady(init);

    global.MSShare = { open: open, close: close, copy: copyLink };
})(window);
