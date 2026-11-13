// Shared helpers for the recitation pages (recite.html, teacher.html).
// Keeps auth, API calls and formatting in one place so both pages enforce the
// same rules: a token from localStorage, a verified /auth/me call, and the
// role the backend actually reports (not just what localStorage remembers).
(function () {
    var API_ORIGIN = (window.MODERN_SKILLS_CONFIG && window.MODERN_SKILLS_CONFIG.API_URL)
        || (location.protocol === 'file:' ? 'http://localhost:3001' : location.origin);
    var API = API_ORIGIN + '/api';
    var STATUS = {
        pending: { label: 'Pending review', cls: 'pending', icon: 'fa-hourglass-half' },
        reviewed: { label: 'Reviewed', cls: 'reviewed', icon: 'fa-circle-check' },
        needs_improvement: { label: 'Needs improvement', cls: 'improve', icon: 'fa-rotate-left' }
    };

    function token() { return localStorage.getItem('ms_token'); }

    function storedUser() {
        try { return JSON.parse(localStorage.getItem('ms_user')); }
        catch (e) { return null; }
    }

    function saveUser(user) {
        try {
            if (user) localStorage.setItem('ms_user', JSON.stringify(user));
            else localStorage.removeItem('ms_user');
        } catch (e) { /* storage can be disabled */ }
    }

    function currentFile() {
        var file = location.pathname.split('/').pop() || 'index.html';
        return file + location.search;
    }

    function clearSession() {
        localStorage.removeItem('ms_token');
        saveUser(null);
    }

    async function me() {
        var t = token();
        if (!t) return null;
        var res = await fetch(API + '/auth/me', { headers: { Authorization: 'Bearer ' + t } });
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) clearSession();
            return null;
        }
        var data = await res.json().catch(function () { return {}; });
        var user = data && data.user;
        if (user && user.id) saveUser(user);
        return user || null;
    }

    // Resolves with the verified user or navigates away. Never let a page
    // render a dashboard from stale localStorage alone.
    async function guard(allowedRoles) {
        var user = await me().catch(function () { return null; });
        if (!user) {
            location.replace('login.html?next=' + encodeURIComponent(currentFile()));
            throw new Error('redirecting');
        }
        if (allowedRoles && allowedRoles.indexOf(user.role) === -1) {
            var fallback = (user.role === 'teacher' || user.role === 'admin') ? 'teacher.html' : 'index.html';
            if (currentFile().indexOf(fallback) === 0) fallback = 'index.html';
            location.replace(fallback);
            throw new Error('redirecting');
        }
        return user;
    }

    async function api(path, options) {
        options = options || {};
        var headers = new Headers(options.headers || {});
        var t = token();
        if (t) headers.set('Authorization', 'Bearer ' + t);

        var body = options.body;
        if (body && !(body instanceof FormData) && typeof body !== 'string') {
            headers.set('Content-Type', 'application/json');
            body = JSON.stringify(body);
        }

        var res = await fetch(API + '/recitations' + path, {
            method: options.method || 'GET',
            headers: headers,
            body: body
        });

        var data = null;
        var type = res.headers.get('content-type') || '';
        if (type.indexOf('application/json') !== -1) {
            data = await res.json().catch(function () { return {}; });
        }

        if (!res.ok) {
            if (res.status === 401) clearSession();
            var err = new Error((data && (data.error || (data.errors && data.errors[0] && data.errors[0].msg))) || 'Request failed.');
            err.status = res.status;
            err.data = data;
            throw err;
        }
        return data || {};
    }

    async function fetchAudioBlob(path, fallbackMessage) {
        var t = token();
        var res = await fetch(API + path, {
            headers: t ? { Authorization: 'Bearer ' + t } : {}
        });
        if (!res.ok) {
            if (res.status === 401) clearSession();
            var payload = await res.json().catch(function () { return {}; });
            throw new Error(payload.error || fallbackMessage || 'Could not load the recording.');
        }
        return res.blob();
    }

    function fetchAudio(submissionId) {
        return fetchAudioBlob('/recitations/submissions/' + submissionId + '/audio');
    }

    function fetchFeedbackAudio(submissionId) {
        return fetchAudioBlob('/recitations/submissions/' + submissionId + '/feedback-audio', 'Could not load the voice feedback.');
    }

    function statusMeta(status) {
        return STATUS[status] || { label: 'Not started', cls: 'none', icon: 'fa-microphone' };
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return '';
        var date;
        // Date-only values (due dates) must not be shifted by the timezone.
        var dayOnly = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
        if (dayOnly) date = new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]));
        else date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function formatDateTime(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    }

    function formatDuration(seconds) {
        var total = Math.max(0, Math.round(Number(seconds) || 0));
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        return mins + ':' + String(secs).padStart(2, '0');
    }

    function formatBytes(bytes) {
        var value = Number(bytes) || 0;
        if (value < 1024) return value + ' B';
        if (value < 1024 * 1024) return (value / 1024).toFixed(0) + ' KB';
        return (value / (1024 * 1024)).toFixed(1) + ' MB';
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/);
        return (parts[0] ? parts[0][0] : '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '');
    }

    function avatarHtml(name, url, size) {
        var cls = 'rec-avatar' + (size ? ' ' + size : '');
        if (url) {
            return '<span class="' + cls + '"><img src="' + escapeHtml(url) + '" alt=""></span>';
        }
        return '<span class="' + cls + '">' + escapeHtml(initials(name).toUpperCase()) + '</span>';
    }

    function toast(message, type) {
        var host = document.getElementById('recToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'recToastHost';
            host.className = 'rec-toast-host';
            document.body.appendChild(host);
        }
        var item = document.createElement('div');
        item.className = 'rec-toast ' + (type || 'info');
        var icon = type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
        item.innerHTML = '<i class="fas ' + icon + '"></i><span></span>';
        item.querySelector('span').textContent = message;
        host.appendChild(item);
        setTimeout(function () {
            item.classList.add('leaving');
            setTimeout(function () { item.remove(); }, 220);
        }, 4200);
    }

    function surahLabel(number, name) {
        return (name || 'Surah') + ' (' + number + ')';
    }

    function ayahLabel(from, to) {
        if (!from) return '';
        return from === to ? 'Ayah ' + from : 'Ayahs ' + from + '–' + to;
    }

    function logout() {
        clearSession();
        location.href = 'index.html';
    }

    window.Recitation = {
        API_ORIGIN: API_ORIGIN,
        API: API,
        STATUS: STATUS,
        token: token,
        storedUser: storedUser,
        saveUser: saveUser,
        me: me,
        guard: guard,
        api: api,
        fetchAudio: fetchAudio,
        fetchFeedbackAudio: fetchFeedbackAudio,
        statusMeta: statusMeta,
        escapeHtml: escapeHtml,
        formatDate: formatDate,
        formatDateTime: formatDateTime,
        formatDuration: formatDuration,
        formatBytes: formatBytes,
        avatarHtml: avatarHtml,
        toast: toast,
        surahLabel: surahLabel,
        ayahLabel: ayahLabel,
        logout: logout
    };
})();
