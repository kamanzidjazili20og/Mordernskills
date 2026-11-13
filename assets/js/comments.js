/* Modern Skills - lesson discussion + like button.
 *
 * Self-mounts on any page that contains:
 *   [data-lesson-comments]   -> the discussion panel (text + voice comments,
 *                               threaded replies, teacher replies highlighted)
 *   #likeLessonBtn           -> the like toggle (with #likeCount for the total)
 *
 * The lesson id is read from data-lesson-id on the comments host, falling back
 * to the ?id= query string (the same param video.html uses).
 *
 * Voice notes reuse MSRecorder (assets/js/ms-recorder.js) and MSVoice
 * (assets/js/voice-ui.js); both degrade gracefully when absent.
 */
(function () {
    'use strict';

    var API_ORIGIN = (window.MODERN_SKILLS_CONFIG && window.MODERN_SKILLS_CONFIG.API_URL)
        || (location.protocol === 'file:' ? 'http://localhost:3001' : location.origin);
    var API = API_ORIGIN + '/api';

    var STYLES = [
        '.lcmt{margin-top:26px;border-radius:18px;border:1px solid rgba(212,168,83,0.2);',
        'background:linear-gradient(180deg,rgba(9,25,18,0.9),rgba(6,18,13,0.94));padding:22px;}',
        '.lcmt *{box-sizing:border-box;}',
        '.lcmt-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:4px;}',
        '.lcmt-head h3{margin:0;font-size:18px;letter-spacing:-0.01em;color:var(--text,#e9f2ec);display:flex;align-items:center;gap:9px;}',
        '.lcmt-head h3 i{color:var(--gold,#d4a853);font-size:16px;}',
        '.lcmt-count{display:inline-flex;align-items:center;justify-content:center;min-width:24px;height:22px;padding:0 8px;',
        'border-radius:999px;background:rgba(212,168,83,0.15);border:1px solid rgba(212,168,83,0.3);color:var(--gold-light,#e9c876);font-size:12px;font-weight:800;}',
        '.lcmt-sub{margin:0 0 16px;color:var(--text-sec,#9db4a9);font-size:12.5px;}',
        '.lcmt-signin{margin:6px 0 18px;padding:16px;border-radius:14px;border:1px dashed rgba(212,168,83,0.3);',
        'background:rgba(212,168,83,0.05);color:var(--text-sec,#9db4a9);font-size:13.5px;text-align:center;}',
        '.lcmt-signin a{color:var(--gold,#d4a853);font-weight:800;text-decoration:none;}',
        '.lcmt-signin a:hover{text-decoration:underline;}',
        '.lcmt-composer{margin-bottom:20px;}',
        '.lcmt-input-row{display:flex;gap:12px;align-items:flex-start;}',
        '.lcmt-avatar{width:40px;height:40px;border-radius:50%;flex:0 0 auto;overflow:hidden;display:flex;align-items:center;',
        'justify-content:center;font-size:13px;font-weight:800;color:#14100a;background:linear-gradient(135deg,#e9c876,#c99b3a);}',
        '.lcmt-avatar img{width:100%;height:100%;object-fit:cover;display:block;}',
        '.lcmt-avatar.sm{width:34px;height:34px;font-size:11.5px;}',
        '.lcmt-text{flex:1;min-height:52px;max-height:200px;resize:vertical;padding:12px 14px;border-radius:14px;',
        'border:1px solid rgba(212,168,83,0.22);background:rgba(8,24,17,0.85);color:var(--text,#e9f2ec);font-family:inherit;font-size:13.5px;outline:none;}',
        '.lcmt-text:focus{border-color:var(--gold,#d4a853);box-shadow:0 0 0 3px rgba(212,168,83,0.14);}',
        '.lcmt-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-top:10px;padding-left:52px;}',
        '.lcmt-btn{display:inline-flex;align-items:center;gap:8px;padding:9px 16px;border-radius:999px;border:1px solid rgba(212,168,83,0.28);',
        'background:rgba(255,255,255,0.03);color:var(--text,#e9f2ec);font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;transition:transform .12s ease,background .15s ease;}',
        '.lcmt-btn:hover{transform:translateY(-1px);background:rgba(212,168,83,0.12);}',
        '.lcmt-btn.primary{border:none;background:linear-gradient(135deg,#e9c876,#c99b3a);color:#14100a;}',
        '.lcmt-btn:disabled{opacity:.5;cursor:default;transform:none;}',
        '.lcmt-reply-chip{display:inline-flex;align-items:center;gap:8px;margin:0 0 10px 52px;padding:6px 10px;border-radius:999px;',
        'background:rgba(212,168,83,0.12);border:1px solid rgba(212,168,83,0.3);font-size:11.5px;color:var(--gold-light,#e9c876);}',
        '.lcmt-reply-chip[hidden]{display:none;}',
        '.lcmt-reply-chip button{border:none;background:transparent;color:inherit;cursor:pointer;font-size:11px;padding:0 2px;}',
        '.lcmt-recorder{margin-top:12px;}',
        '.lcmt-recorder[hidden]{display:none;}',
        '.lcmt-list{display:flex;flex-direction:column;gap:16px;}',
        '.lcmt-empty{padding:22px;text-align:center;color:var(--text-muted,#7e958a);font-size:13px;border:1px dashed rgba(255,255,255,0.08);border-radius:14px;}',
        '.lcmt-card{display:flex;gap:12px;align-items:flex-start;}',
        '.lcmt-body{flex:1;min-width:0;}',
        '.lcmt-card-inner{padding:13px 15px;border-radius:14px;border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);}',
        '.lcmt-card.teacher .lcmt-card-inner{border-color:rgba(212,168,83,0.35);background:linear-gradient(145deg,rgba(212,168,83,0.1),rgba(8,24,17,0.6));}',
        '.lcmt-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;}',
        '.lcmt-name{font-size:13.5px;font-weight:800;color:var(--text,#e9f2ec);}',
        '.lcmt-badge{padding:2px 8px;border-radius:999px;font-size:9.5px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;',
        'background:rgba(212,168,83,0.16);border:1px solid rgba(212,168,83,0.4);color:var(--gold-light,#e9c876);}',
        '.lcmt-time{font-size:11px;color:var(--text-muted,#7e958a);margin-left:auto;}',
        '.lcmt-textbody{margin-top:7px;font-size:13.5px;line-height:1.6;color:var(--text,#e9f2ec);white-space:pre-wrap;word-break:break-word;}',
        '.lcmt-audio{margin-top:9px;}',
        '.lcmt-audio .vsu-bubble{max-width:min(420px,100%);}',
        '.lcmt-tools{display:flex;align-items:center;gap:14px;margin-top:9px;}',
        '.lcmt-tool{border:none;background:transparent;color:var(--text-muted,#7e958a);font-family:inherit;font-size:11.5px;font-weight:700;',
        'cursor:pointer;padding:2px 0;display:inline-flex;align-items:center;gap:6px;transition:color .15s ease;}',
        '.lcmt-tool:hover{color:var(--gold,#d4a853);}',
        '.lcmt-tool.danger:hover{color:#fca5a5;}',
        '.lcmt-replies{margin-top:14px;padding-left:16px;border-left:2px solid rgba(212,168,83,0.18);display:flex;flex-direction:column;gap:14px;}',
        '.lcmt-loading{padding:22px;text-align:center;color:var(--text-muted,#7e958a);font-size:13px;}',
        '.lcmt-loading .fa-spin{color:var(--gold,#d4a853);}',
        '.lcmt-toast-host{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:4000;display:flex;flex-direction:column;gap:10px;align-items:center;pointer-events:none;}',
        '.lcmt-toast{display:flex;align-items:center;gap:10px;padding:11px 18px;border-radius:999px;font-size:13px;font-weight:700;',
        'background:rgba(10,26,19,0.97);border:1px solid rgba(212,168,83,0.35);color:var(--text,#e9f2ec);box-shadow:0 18px 44px -18px rgba(0,0,0,0.8);',
        'opacity:0;transform:translateY(10px);transition:opacity .2s ease,transform .2s ease;pointer-events:auto;}',
        '.lcmt-toast.show{opacity:1;transform:none;}',
        '.lcmt-toast.success{border-color:rgba(52,211,153,0.5);} .lcmt-toast.success i{color:#34d399;}',
        '.lcmt-toast.error{border-color:rgba(248,113,113,0.5);} .lcmt-toast.error i{color:#f87171;}',
        '.lcmt-toast i{color:var(--gold,#d4a853);}',
        '.like-btn{position:relative;}',
        '.like-btn.liked{border-color:rgba(248,113,113,0.55);color:#fca5a5;background:rgba(248,113,113,0.12);}',
        '.like-btn.liked i{color:#f87171;}',
        '.like-btn.pop i{animation:lcmtPop .4s ease;}',
        '@keyframes lcmtPop{0%{transform:scale(1);}40%{transform:scale(1.5);}70%{transform:scale(.9);}100%{transform:scale(1);}}',
        '@media (max-width:560px){.lcmt{padding:16px;}.lcmt-actions{padding-left:0;}.lcmt-reply-chip{margin-left:0;}}'
    ].join('\n');

    var cssDone = false;
    function injectCss() {
        if (cssDone || document.getElementById('lcmt-style')) { cssDone = true; return; }
        var style = document.createElement('style');
        style.id = 'lcmt-style';
        style.textContent = STYLES;
        document.head.appendChild(style);
        cssDone = true;
    }

    function token() { return localStorage.getItem('ms_token'); }

    function currentUser() {
        try { return JSON.parse(localStorage.getItem('ms_user')); }
        catch (e) { return null; }
    }

    function esc(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function initials(name) {
        var parts = String(name || '?').trim().split(/\s+/);
        return ((parts[0] ? parts[0][0] : '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    }

    function avatarHtml(comment, small) {
        var cls = 'lcmt-avatar' + (small ? ' sm' : '');
        if (comment.author_avatar) {
            var url = (window.MS_MEDIA && typeof MS_MEDIA.resolve === 'function')
                ? MS_MEDIA.resolve(comment.author_avatar) : comment.author_avatar;
            return '<span class="' + cls + '"><img src="' + esc(url) + '" alt="" loading="lazy"></span>';
        }
        return '<span class="' + cls + '">' + esc(initials(comment.author_name)) + '</span>';
    }

    function formatCount(n) {
        var value = Number(n) || 0;
        if (value < 1000) return String(value);
        if (value < 1000000) return (value / 1000).toFixed(value < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
        return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
    }

    function relTime(value) {
        if (!value) return '';
        var then = new Date(value).getTime();
        if (Number.isNaN(then)) return '';
        var diff = Math.max(0, Date.now() - then);
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + 'm ago';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        var days = Math.floor(hours / 24);
        if (days < 7) return days + 'd ago';
        var date = new Date(value);
        return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
    }

    function toast(message, type) {
        injectCss();
        var host = document.getElementById('lcmtToastHost');
        if (!host) {
            host = document.createElement('div');
            host.id = 'lcmtToastHost';
            host.className = 'lcmt-toast-host';
            document.body.appendChild(host);
        }
        var item = document.createElement('div');
        item.className = 'lcmt-toast ' + (type || 'info');
        var icon = type === 'error' ? 'fa-circle-exclamation' : type === 'success' ? 'fa-circle-check' : 'fa-circle-info';
        item.innerHTML = '<i class="fas ' + icon + '"></i><span></span>';
        item.querySelector('span').textContent = message;
        host.appendChild(item);
        requestAnimationFrame(function () { item.classList.add('show'); });
        setTimeout(function () {
            item.classList.remove('show');
            setTimeout(function () { item.remove(); }, 240);
        }, 4000);
    }

    function lessonIdFrom(host) {
        var raw = host && host.dataset ? host.dataset.lessonId : null;
        var id = parseInt(raw, 10);
        if (Number.isInteger(id)) return id;
        id = parseInt(new URLSearchParams(location.search).get('id'), 10);
        return Number.isInteger(id) ? id : null;
    }

    function fetchCommentAudio(id) {
        var headers = {};
        if (token()) headers['Authorization'] = 'Bearer ' + token();
        return fetch(API + '/comments/' + id + '/audio', { headers: headers }).then(function (res) {
            if (!res.ok) throw new Error('Could not load the voice note.');
            return res.blob();
        });
    }

    // ----------------------------------------------------------------
    // Comments panel
    // ----------------------------------------------------------------
    function initComments(host) {
        if (!host || host.dataset.lcmtMounted === '1') return;
        var lessonId = lessonIdFrom(host);
        if (!lessonId) return;
        host.dataset.lcmtMounted = '1';
        injectCss();
        host.classList.add('lcmt');

        var me = currentUser();
        var comments = [];
        var canModerate = false;
        var replyTo = null;

        host.innerHTML = ''
            + '<div class="lcmt-head">'
            + '  <h3><i class="fas fa-comments"></i> Discussion <span class="lcmt-count">0</span></h3>'
            + '</div>'
            + '<p class="lcmt-sub">Share a thought or record a voice note. Teachers reply here too.</p>'
            + '<div class="lcmt-composer-slot"></div>'
            + '<div class="lcmt-list"><div class="lcmt-loading"><i class="fas fa-circle-notch fa-spin"></i> Loading discussion...</div></div>';

        var countEl = host.querySelector('.lcmt-count');
        var composerSlot = host.querySelector('.lcmt-composer-slot');
        var listEl = host.querySelector('.lcmt-list');

        if (!token()) {
            composerSlot.innerHTML = '<div class="lcmt-signin">Sign in to join the discussion and leave a voice comment. '
                + '<a href="login.html?next=' + encodeURIComponent(location.pathname + location.search) + '">Sign in</a></div>';
            listEl.innerHTML = '<div class="lcmt-empty">Sign in to read what other students are saying about this lesson.</div>';
            return;
        }

        composerSlot.innerHTML = buildComposer();
        var textarea = composerSlot.querySelector('.lcmt-text');
        var replyChip = composerSlot.querySelector('.lcmt-reply-chip');
        var replyChipText = composerSlot.querySelector('.lcmt-reply-chip span');
        var sendBtn = composerSlot.querySelector('.lcmt-send');
        var voiceBtn = composerSlot.querySelector('.lcmt-voice');
        var recorderHost = composerSlot.querySelector('.lcmt-recorder');

        var recorder = null;

        function buildComposer() {
            return ''
                + '<div class="lcmt-composer">'
                + '  <div class="lcmt-reply-chip" hidden><i class="fas fa-reply"></i><span></span>'
                + '    <button type="button" class="lcmt-reply-cancel" aria-label="Cancel reply"><i class="fas fa-times"></i></button></div>'
                + '  <div class="lcmt-input-row">'
                + '    <span class="lcmt-avatar">' + esc(initials((me && (me.full_name || me.username)) || 'You')) + '</span>'
                + '    <textarea class="lcmt-text" placeholder="Add a comment..." maxlength="2000"></textarea>'
                + '  </div>'
                + '  <div class="lcmt-actions">'
                + '    <button type="button" class="lcmt-btn lcmt-voice"><i class="fas fa-microphone"></i> Voice note</button>'
                + '    <button type="button" class="lcmt-btn primary lcmt-send"><i class="fas fa-paper-plane"></i> Post</button>'
                + '  </div>'
                + '  <div class="lcmt-recorder" hidden></div>'
                + '</div>';
        }

        function setReply(comment) {
            replyTo = comment ? comment.id : null;
            if (!comment) { replyChip.hidden = true; return; }
            replyChipText.textContent = 'Replying to ' + (comment.author_name || 'comment');
            replyChip.hidden = false;
            textarea.focus();
        }

        composerSlot.querySelector('.lcmt-reply-cancel').addEventListener('click', function () { setReply(null); });

        function postComment(payload) {
            var headers = {};
            if (token()) headers['Authorization'] = 'Bearer ' + token();
            var body;
            if (payload instanceof FormData) {
                body = payload;
            } else {
                headers['Content-Type'] = 'application/json';
                body = JSON.stringify(payload);
            }
            return fetch(API + '/comments/lesson/' + lessonId, {
                method: 'POST', headers: headers, body: body
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok) throw new Error(data.error || 'Could not post the comment.');
                    return data.comment;
                });
            });
        }

        sendBtn.addEventListener('click', function () {
            var text = textarea.value.trim();
            if (!text) { toast('Write a message first, or record a voice note.', 'error'); return; }
            sendBtn.disabled = true;
            var payload = { body: text };
            if (replyTo) payload.parentId = replyTo;
            postComment(payload)
                .then(function () {
                    textarea.value = '';
                    setReply(null);
                    toast('Comment posted.', 'success');
                    return load();
                })
                .catch(function (err) { toast(err.message, 'error'); })
                .finally(function () { sendBtn.disabled = false; });
        });

        textarea.addEventListener('keydown', function (e) {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); sendBtn.click(); }
        });

        function ensureRecorder() {
            if (recorder) return recorder;
            if (!window.MSRecorder) { toast('Recording is not available on this page.', 'error'); return null; }
            recorder = window.MSRecorder.mount(recorderHost, {
                lessonId: lessonId,
                title: 'Voice comment',
                note: 'Record a short voice note and post it to the discussion.',
                sentTitle: 'Comment posted',
                sentToast: 'Your voice comment was posted.',
                toast: toast,
                send: function (form) {
                    if (replyTo) form.append('parentId', String(replyTo));
                    var text = textarea.value.trim();
                    if (text) form.append('body', text);
                    return postComment(form).then(function () {
                        textarea.value = '';
                        setReply(null);
                        return load();
                    });
                }
            });
            return recorder;
        }

        voiceBtn.addEventListener('click', function () {
            var rec = ensureRecorder();
            if (!rec) return;
            var showing = !recorderHost.hidden;
            recorderHost.hidden = showing;
            voiceBtn.classList.toggle('primary', !showing);
            if (!showing) {
                try { recorderHost.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e) { /* noop */ }
            }
        });

        function renderComment(comment, nested) {
            var article = document.createElement('article');
            article.className = 'lcmt-card' + (comment.is_teacher ? ' teacher' : '');
            article.dataset.id = comment.id;

            var canDelete = canModerate || (me && me.id === comment.user_id);
            article.innerHTML = ''
                + avatarHtml(comment, nested)
                + '<div class="lcmt-body">'
                + '  <div class="lcmt-card-inner">'
                + '    <div class="lcmt-line">'
                + '      <span class="lcmt-name">' + esc(comment.author_name) + '</span>'
                + (comment.is_teacher ? '<span class="lcmt-badge">' + esc(comment.author_role === 'admin' ? 'Admin' : 'Teacher') + '</span>' : '')
                + '      <span class="lcmt-time">' + esc(relTime(comment.created_at)) + '</span>'
                + '    </div>'
                + (comment.body ? '<div class="lcmt-textbody"></div>' : '')
                + '    <div class="lcmt-audio"></div>'
                + '    <div class="lcmt-tools">'
                + '      <button type="button" class="lcmt-tool lcmt-reply"><i class="fas fa-reply"></i> Reply</button>'
                + (canDelete ? '<button type="button" class="lcmt-tool danger lcmt-delete"><i class="fas fa-trash"></i> Delete</button>' : '')
                + '    </div>'
                + '  </div>'
                + '  <div class="lcmt-replies"></div>'
                + '</div>';

            if (comment.body) {
                article.querySelector('.lcmt-textbody').textContent = comment.body;
            }

            if (comment.audio_url && window.MSVoice) {
                window.MSVoice.bubble(article.querySelector('.lcmt-audio'), {
                    id: 'lcmt-' + comment.id,
                    duration: comment.duration_seconds,
                    compact: nested,
                    loader: function () { return fetchCommentAudio(comment.id); }
                });
            }

            article.querySelector('.lcmt-reply').addEventListener('click', function () { setReply(comment); });

            var delBtn = article.querySelector('.lcmt-delete');
            if (delBtn) {
                delBtn.addEventListener('click', function () {
                    if (!window.confirm('Delete this comment' + (comment.parent_id ? '' : ' and its replies') + '?')) return;
                    delBtn.disabled = true;
                    fetch(API + '/comments/' + comment.id, {
                        method: 'DELETE',
                        headers: { 'Authorization': 'Bearer ' + token() }
                    }).then(function (res) {
                        return res.json().catch(function () { return {}; }).then(function (data) {
                            if (!res.ok) throw new Error(data.error || 'Could not delete the comment.');
                        });
                    }).then(function () {
                        toast('Comment deleted.', 'success');
                        return load();
                    }).catch(function (err) {
                        delBtn.disabled = false;
                        toast(err.message, 'error');
                    });
                });
            }

            return article;
        }

        function render() {
            listEl.innerHTML = '';
            countEl.textContent = formatCount(comments.length);
            if (!comments.length) {
                listEl.innerHTML = '<div class="lcmt-empty">No comments yet. Be the first to start the discussion.</div>';
                return;
            }

            var byParent = {};
            var tops = [];
            comments.forEach(function (c) {
                if (c.parent_id) {
                    (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
                } else {
                    tops.push(c);
                }
            });

            tops.forEach(function (top) {
                var node = renderComment(top, false);
                var repliesEl = node.querySelector('.lcmt-replies');
                var replies = byParent[top.id] || [];
                if (replies.length) {
                    replies.forEach(function (reply) { repliesEl.appendChild(renderComment(reply, true)); });
                } else {
                    repliesEl.remove();
                }
                listEl.appendChild(node);
            });
        }

        function load() {
            var headers = { 'Authorization': 'Bearer ' + token() };
            return fetch(API + '/comments/lesson/' + lessonId, { headers: headers })
                .then(function (res) {
                    return res.json().catch(function () { return {}; }).then(function (data) {
                        if (res.status === 401) { localStorage.removeItem('ms_token'); }
                        if (!res.ok) throw new Error(data.error || 'Could not load comments.');
                        return data;
                    });
                })
                .then(function (data) {
                    comments = data.comments || [];
                    canModerate = Boolean(data.canModerate);
                    if (data.currentUserId != null) {
                        me = me || {};
                        me.id = data.currentUserId;
                    }
                    render();
                })
                .catch(function (err) {
                    listEl.innerHTML = '<div class="lcmt-empty">' + esc(err.message || 'Could not load the discussion.') + '</div>';
                });
        }

        load();
    }

    // ----------------------------------------------------------------
    // Like button
    // ----------------------------------------------------------------
    function initLike(btn) {
        if (!btn || btn.dataset.lcmtLikeMounted === '1') return;
        var lessonId = parseInt(new URLSearchParams(location.search).get('id'), 10);
        if (!Number.isInteger(lessonId)) return;
        btn.dataset.lcmtLikeMounted = '1';
        injectCss();

        var countEl = document.getElementById('likeCount') || btn.querySelector('[data-like-count]');

        function setCount(n) { if (countEl && n != null) countEl.textContent = formatCount(n); }
        function setLiked(liked) {
            btn.classList.toggle('liked', Boolean(liked));
            btn.setAttribute('aria-pressed', liked ? 'true' : 'false');
        }

        // Seed the public total from the lesson detail (works for guests too).
        fetch(API + '/lessons/' + lessonId)
            .then(function (res) { return res.ok ? res.json() : null; })
            .then(function (data) {
                if (data && data.lesson && data.lesson.likes != null) setCount(data.lesson.likes);
            })
            .catch(function () { /* leave the default */ });

        if (token()) {
            fetch(API + '/lessons/' + lessonId + '/like', { headers: { 'Authorization': 'Bearer ' + token() } })
                .then(function (res) { return res.ok ? res.json() : null; })
                .then(function (data) {
                    if (!data) return;
                    setLiked(data.liked);
                    setCount(data.likes);
                })
                .catch(function () { /* ignore */ });
        }

        btn.addEventListener('click', function () {
            if (!token()) {
                location.href = 'login.html?next=' + encodeURIComponent(location.pathname + location.search);
                return;
            }
            if (btn.disabled) return;
            btn.disabled = true;
            fetch(API + '/lessons/' + lessonId + '/like', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token() }
            }).then(function (res) {
                return res.json().catch(function () { return {}; }).then(function (data) {
                    if (!res.ok) throw new Error(data.error || 'Could not update the like.');
                    return data;
                });
            }).then(function (data) {
                setLiked(data.liked);
                setCount(data.likes);
                if (data.liked) {
                    btn.classList.remove('pop');
                    void btn.offsetWidth;
                    btn.classList.add('pop');
                }
            }).catch(function (err) {
                toast(err.message, 'error');
            }).finally(function () { btn.disabled = false; });
        });
    }

    function initAll(root) {
        (root || document).querySelectorAll('[data-lesson-comments]').forEach(initComments);
        (root || document).querySelectorAll('#likeLessonBtn').forEach(initLike);
    }

    window.MSComments = { init: initAll, toast: toast };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { initAll(); });
    } else {
        initAll();
    }
})();
