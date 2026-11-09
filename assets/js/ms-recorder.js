/* ==========================================================================
   MSRecorder — Telegram-style hold-to-record component (official take).
   Depends on Font Awesome 6 and MSVoice (assets/js/voice-ui.js) for the
   live meter + preview bubble; both degrade gracefully when absent.

   Usage:
     var rec = MSRecorder.mount(hostElement, {
         title: 'Lesson recitation',
         note: 'Sent to the admin panel for review.',
         lessonId: 12,
         toast: function (msg, type) {},
         send: async function (form) {},   // POST FormData -> resolves
         onSent: function () {},
         reset: function () {}
     });
     rec.open() / rec.close() / rec.reset() / rec.destroy()
   ========================================================================== */
(function () {
    'use strict';

    var MAX_BYTES = 25 * 1024 * 1024;
    var SOFT_BYTES = 23.5 * 1024 * 1024;
    var DEFAULT_MAX_MS = 7200 * 1000;
    var MIN_MS = 700;
    var CLICK_GUARD_MS = 260;   // block re-presses right after a stop

    var STYLES = [
        '.msr{border-radius:18px;border:1px solid rgba(212,168,83,0.22);',
        'background:linear-gradient(180deg,rgba(8,24,17,0.92),rgba(6,19,14,0.95));',
        'box-shadow:0 24px 60px -30px rgba(0,0,0,0.7);color:var(--text,#e9f2ec);overflow:hidden;}',
        '.msr-head{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid rgba(212,168,83,0.13);}',
        '.msr-mark{width:38px;height:38px;border-radius:12px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;',
        'background:rgba(212,168,83,0.14);border:1px solid rgba(212,168,83,0.3);color:#d4a853;font-size:15px;}',
        '.msr-head-titles{min-width:0;}',
        '.msr-title{font-size:14px;font-weight:800;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.msr-sub{margin-top:2px;font-size:11.5px;color:var(--text-sec,#9db4a9);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
        '.msr-live{margin-left:auto;display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;font-size:9.5px;font-weight:800;',
        'letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted,#7e958a);}',
        '.msr-live .dot{width:8px;height:8px;border-radius:50%;background:#7e958a;opacity:.7;}',
        '.msr.live .msr-live{color:#f87171;}',
        '.msr.live .msr-live .dot{background:#f87171;box-shadow:0 0 10px rgba(248,113,113,0.85);animation:msrPulseDot 1.1s ease-in-out infinite;}',
        '.msr.paused .msr-live{color:#fbbf24;}',
        '.msr.paused .msr-live .dot{background:#fbbf24;animation:none;}',
        '@keyframes msrPulseDot{0%,100%{transform:scale(1);opacity:1;}50%{transform:scale(1.45);opacity:.55;}}',
        '.msr-body{padding:18px 18px 20px;}',
        '.msr-idle{text-align:center;}',
        '.msr-mic{width:76px;height:76px;border-radius:50%;border:none;cursor:pointer;position:relative;',
        'background:linear-gradient(135deg,#e9c876,#c99b3a);color:#14100a;font-size:27px;',
        'box-shadow:0 18px 40px -14px rgba(212,168,83,0.8),inset 0 1px 0 rgba(255,255,255,0.45);',
        'transition:transform .12s ease,box-shadow .2s ease;touch-action:none;-webkit-tap-highlight-color:transparent;}',
        '.msr-mic:hover{transform:translateY(-2px);}',
        '.msr-mic::after{content:"";position:absolute;inset:-10px;border-radius:50%;border:2px solid rgba(212,168,83,0.35);',
        'animation:msrHalo 2.4s ease-in-out infinite;pointer-events:none;}',
        '@keyframes msrHalo{0%{transform:scale(.9);opacity:.8;}70%{transform:scale(1.18);opacity:0;}100%{opacity:0;}}',
        '.msr-mic.holding{background:#f87171;color:#2b0707;transform:scale(1.06);',
        'box-shadow:0 18px 46px -12px rgba(248,113,113,0.8);animation:msrMicBeat .85s ease-in-out infinite;}',
        '.msr-mic.holding::after,.msr-mic.locked::after{display:none;}',
        '@keyframes msrMicBeat{0%,100%{transform:scale(1.06);}50%{transform:scale(.97);}}',
        '.msr-mic.locked{background:#60a5fa;color:#0b1c33;animation:none;transform:scale(1.06);',
        'box-shadow:0 18px 46px -12px rgba(96,165,250,0.8);}',
        '.msr-caption{margin:14px 0 0;font-size:12.5px;color:var(--text-sec,#9db4a9);}',
        '.msr-caption strong{color:var(--text,#e9f2ec);}',
        '.msr-kb{margin:6px 0 0;font-size:11px;color:var(--text-muted,#7e958a);}',
        '.msr-kb kbd{padding:2px 7px;border-radius:6px;border:1px solid rgba(255,255,255,0.16);background:rgba(255,255,255,0.05);font-family:inherit;font-size:10.5px;}',
        '.msr-warn{margin:12px auto 0;max-width:420px;font-size:12.5px;color:#fbbf24;}',
        '.msr-timer{text-align:center;font-size:32px;font-weight:800;letter-spacing:0.04em;font-variant-numeric:tabular-nums;}',
        '.msr-wave{display:flex;align-items:center;justify-content:center;gap:3px;height:58px;margin:8px auto 4px;}',
        '.msr-wave span{width:3.5px;border-radius:999px;background:linear-gradient(180deg,#d4a853,rgba(212,168,83,0.35));}',
        '.msr-status{text-align:center;font-size:12px;color:var(--text-muted,#7e958a);min-height:30px;',
        'display:flex;align-items:center;justify-content:center;gap:8px;flex-wrap:wrap;}',
        '.msr-status .dot{display:none;width:11px;height:11px;border-radius:50%;background:#f87171;',
        'box-shadow:0 0 12px rgba(248,113,113,0.9);animation:msrPulseDot 1.1s ease-in-out infinite;}',
        '.msr-status.rec .dot{display:inline-block;}',
        '.msr-standing{position:relative;height:118px;}',
        '.msr-staging{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:38px;}',
        '.msr-cancel{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,0.09);cursor:pointer;',
        'display:flex;align-items:center;justify-content:center;font-size:15px;color:var(--text-sec,#9db4a9);',
        'background:rgba(255,255,255,0.05);opacity:0;transform:scale(.55);transition:all .18s ease;touch-action:none;}',
        '.msr-cancel.show{opacity:1;transform:none;}',
        '.msr-cancel.armed{background:#f87171;color:#2b0707;transform:scale(1.12);box-shadow:0 10px 26px -10px rgba(248,113,113,0.85);}',
        '.msr-hold-hint{position:absolute;top:12px;font-size:11px;color:var(--text-muted,#7e958a);white-space:nowrap;',
        'opacity:0;transition:opacity .15s ease;pointer-events:none;}',
        '.msr-hold-hint.left{left:34px;}',
        '.msr-hold-hint.right{right:34px;}',
        '.msr-hold-hint.show{opacity:1;}',
        '.msr-hold-hint.danger{color:#f87171;font-weight:700;}',
        '.msr-hold-hint.lock-on{color:#60a5fa;font-weight:700;}',
        '.msr-progress{position:absolute;left:50%;bottom:-6px;transform:translateX(-50%);height:4px;border-radius:999px;',
        'background:rgba(255,255,255,0.07);width:min(300px,64%);overflow:hidden;opacity:0;transition:opacity .2s ease;}',
        '.msr-progress.on{opacity:1;}',
        '.msr-progress span{display:block;height:100%;width:0%;border-radius:999px;background:linear-gradient(90deg,#d4a853,#34d399);}',
        '.msr-locked{display:flex;align-items:center;justify-content:center;gap:20px;min-height:118px;}',
        '.msr-ctl{width:46px;height:46px;border-radius:50%;border:1px solid rgba(255,255,255,0.1);cursor:pointer;font-size:14px;',
        'color:#e9f2ec;background:rgba(255,255,255,0.06);display:flex;align-items:center;justify-content:center;',
        'transition:transform .15s ease,background .15s ease;touch-action:none;-webkit-tap-highlight-color:transparent;}',
        '.msr-ctl:hover{transform:scale(1.07);background:rgba(255,255,255,0.11);}',
        '.msr-ctl.finish{width:60px;height:60px;font-size:17px;border:none;background:linear-gradient(135deg,#34d399,#10b981);color:#062012;',
        'box-shadow:0 14px 34px -12px rgba(52,211,153,0.8);}',
        '.msr-ready{text-align:center;}',
        '.msr-ready-title{margin:0 0 12px;font-size:15px;font-weight:800;letter-spacing:0.02em;}',
        '.msr-preview{display:flex;justify-content:center;margin-bottom:10px;}',
        '.msr-preview .vsu-bubble{max-width:min(420px,96%);}',
        '.msr-ready-status{margin:0 0 14px;font-size:12.5px;color:var(--text-muted,#7e958a);}',
        '.msr-ready-actions{display:flex;align-items:center;justify-content:center;gap:12px;flex-wrap:wrap;}',
        '.msr-btn{display:inline-flex;align-items:center;gap:9px;padding:11px 22px;border-radius:999px;border:none;cursor:pointer;',
        'font-size:13px;font-weight:800;transition:transform .12s ease,opacity .15s ease;touch-action:none;-webkit-tap-highlight-color:transparent;}',
        '.msr-btn:hover{transform:translateY(-1px);}',
        '.msr-btn:disabled{opacity:.5;cursor:default;transform:none;}',
        '.msr-btn.gold{background:linear-gradient(135deg,#e9c876,#c99b3a);color:#14100a;box-shadow:0 16px 36px -16px rgba(212,168,83,0.9);}',
        '.msr-btn.red{background:rgba(248,113,113,0.12);color:#fca5a5;border:1px solid rgba(248,113,113,0.4);}',
        '.msr-sent{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:8px;padding:14px 0 8px;text-align:center;}',
        '.msr-sent .ok{width:54px;height:54px;border-radius:50%;display:flex;align-items:center;justify-content:center;',
        'background:rgba(52,211,153,0.16);border:1px solid rgba(52,211,153,0.45);color:#34d399;font-size:20px;}',
        '.msr-sent strong{font-size:14.5px;}',
        '.msr-hidden{display:none!important;}'
    ].join('\n');

    var cssDone = false;
    function injectCss() {
        if (cssDone) return;
        var style = document.createElement('style');
        style.id = 'msr-runtime-style';
        style.textContent = STYLES;
        document.head.appendChild(style);
        cssDone = true;
    }

    function extensionForMime(mime) {
        mime = String(mime || '').toLowerCase();
        if (mime.indexOf('ogg') !== -1) return '.ogg';
        if (mime.indexOf('mp4') !== -1 || mime.indexOf('m4a') !== -1) return '.m4a';
        if (mime.indexOf('mpeg') !== -1) return '.mp3';
        if (mime.indexOf('wav') !== -1) return '.wav';
        if (mime.indexOf('aac') !== -1) return '.aac';
        return '.webm';
    }

    function pickMime() {
        if (!window.MediaRecorder || typeof MediaRecorder.isTypeSupported !== 'function') return '';
        var options = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
        for (var i = 0; i < options.length; i++) {
            if (MediaRecorder.isTypeSupported(options[i])) return options[i];
        }
        return '';
    }

    function fmtTime(sec) {
        sec = Math.max(0, Math.round(sec));
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function mount(host, opts) {
        if (!host) throw new Error('MSRecorder.mount: host element required');
        injectCss();
        opts = opts || {};

        var toast = opts.toast || function () {};
        var minMs = opts.minMs || MIN_MS;
        var maxMs = opts.maxMs || DEFAULT_MAX_MS;
        var softBytes = opts.softBytes || SOFT_BYTES;
        var maxBytes = opts.maxBytes || MAX_BYTES;
        var title = opts.title || 'Lesson recitation';
        var note = opts.note || 'Tap the mic and recite — your take is sent for review.';

        var ui = document.createElement('div');
        ui.className = 'msr open';
        ui.innerHTML = [
            '<div class="msr-head">',
            '  <span class="msr-mark"><i class="fas fa-microphone-lines"></i></span>',
            '  <div class="msr-head-titles"><div class="msr-title"></div><div class="msr-sub"></div></div>',
            '  <span class="msr-live"><span class="dot"></span><span class="lbl">Standby</span></span>',
            '</div>',
            '<div class="msr-body">',
            '  <div class="msr-idle">',
            '    <button type="button" class="msr-mic msr-idle-mic" aria-label="Tap to start recording"><i class="fas fa-microphone"></i></button>',
            '    <p class="msr-caption"><strong>Tap</strong> the mic to start &mdash; then tap <strong>stop</strong> when you finish. Hold and slide <strong>left</strong> to cancel.</p>',
            '    <p class="msr-kb">or press <kbd>Space</kbd> to start &amp; stop</p>',
            '  </div>',
            '  <div class="msr-stage msr-hidden">',
            '    <div class="msr-timer">0:00</div>',
            '    <div class="msr-wave"></div>',
            '    <div class="msr-status" aria-live="polite"><span class="dot"></span><span class="msg"></span></div>',
            '    <div class="msr-standing">',
            '      <div class="msr-staging">',
            '        <button type="button" class="msr-cancel" aria-label="Cancel"><i class="fas fa-trash"></i></button>',
            '        <div class="msr-hold-hint left"><strong>Starting</strong>&hellip;</div>',
            '        <button type="button" class="msr-mic msr-live-mic" aria-label="Tap to stop recording"><i class="fas fa-stop"></i></button>',
            '        <div class="msr-hold-hint right"></div>',
            '      </div>',
            '      <div class="msr-progress"><span></span></div>',
            '    </div>',
            '  </div>',
            '  <div class="msr-locked msr-hidden">',
            '    <button type="button" class="msr-ctl" data-locked-cancel aria-label="Discard the take"><i class="fas fa-trash"></i></button>',
            '    <button type="button" class="msr-ctl" data-locked-pause aria-label="Pause"><i class="fas fa-pause"></i></button>',
            '    <button type="button" class="msr-ctl finish" data-locked-finish aria-label="Finish the take"><i class="fas fa-stop"></i></button>',
            '  </div>',
            '  <div class="msr-ready msr-hidden">',
            '    <p class="msr-ready-title">Ready to send</p>',
            '    <div class="msr-preview"></div>',
            '    <p class="msr-ready-status"></p>',
            '    <div class="msr-ready-actions">',
            '      <button type="button" class="msr-btn red" data-discard><i class="fas fa-rotate-left"></i> Discard</button>',
            '      <button type="button" class="msr-btn gold" data-send><i class="fas fa-paper-plane"></i> Send</button>',
            '    </div>',
            '  </div>',
            '  <div class="msr-sent msr-hidden">',
            '    <span class="ok"><i class="fas fa-check"></i></span>',
            '    <strong>Sent for review</strong>',
            '  </div>',
            '</div>'
        ].join('');
        host.appendChild(ui);

        var q = function (sel) { return ui.querySelector(sel); };
        var els = {
            live: q('.msr-live'),
            liveLbl: q('.msr-live .lbl'),
            idle: q('.msr-idle'),
            idleMic: q('.msr-idle-mic'),
            warn: q('.msr-warn'),
            stage: q('.msr-stage'),
            timer: q('.msr-timer'),
            wave: q('.msr-wave'),
            status: q('.msr-status'),
            statusMsg: q('.msr-status .msg'),
            standing: q('.msr-standing'),
            staging: q('.msr-staging'),
            cancelBtn: q('.msr-cancel'),
            micBtn: q('.msr-live-mic'),
            holdHintLeft: q('.msr-hold-hint.left'),
            holdHintRight: q('.msr-hold-hint.right'),
            progress: q('.msr-progress'),
            progressFill: q('.msr-progress span'),
            locked: q('.msr-locked'),
            lockedCancel: q('[data-locked-cancel]'),
            lockedPause: q('[data-locked-pause]'),
            lockedFinish: q('[data-locked-finish]'),
            ready: q('.msr-ready'),
            preview: q('.msr-preview'),
            readyStatus: q('.msr-ready-status'),
            discard: q('[data-discard]'),
            submit: q('[data-send]'),
            sent: q('.msr-sent')
        };

        ui.querySelector('.msr-title').textContent = title;
        ui.querySelector('.msr-sub').textContent = note;

        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            var warn = ui.querySelector('.msr-warn') || els.idle.appendChild(document.createElement('p'));
            warn.className = 'msr-warn';
            warn.classList.remove('msr-hidden');
            warn.textContent = 'This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.';
            els.idleMic.disabled = true;
        }

        var meter = (window.MSVoice && MSVoice.liveMeter) ? MSVoice.liveMeter(els.wave, 22) : null;

        var state = 'idle';            // idle | hold | locked | stopping | ready | sending | sent
        var mediaRecorder = null;
        var stream = null;
        var wakeLock = null;
        var chunks = [];
        var recordedBlob = null;
        var recordedBytes = 0;
        var discardOnStop = false;
        var pausedFlag = false;
        var startedAt = 0;
        var accumulatedMs = 0;
        var timerId = 0;
        var sizeStopTriggered = false;
        var draftBubble = null;
        var pointerHeld = false;
        var kbHeld = false;
        var holdActive = false;
        var starting = false;
        var captureSeq = 0;
        var lastInteractionAt = 0;
        var lastPointerAt = 0;
        var drag = { active: false, x0: 0, y0: 0, cancel: false, locked: false };
        var lastStopAt = 0;

        function setHead(liveLabel, mode) {
            if (liveLabel) els.liveLbl.textContent = liveLabel;
            ui.classList.toggle('live', mode === 'rec');
            ui.classList.toggle('paused', mode === 'paused');
        }

        function elapsedMs() {
            var ms = accumulatedMs;
            if ((state === 'hold' || (state === 'locked' && !pausedFlag)) && startedAt) ms += Date.now() - startedAt;
            return ms;
        }

        /* Total recorded time across pauses — shown live and sent on upload. */
        function totalRecordedMs() {
            return Math.max(elapsedMs(), accumulatedMs);
        }

        function renderTimer() {
            els.timer.textContent = fmtTime(totalRecordedMs() / 1000);
            if ((state === 'hold' || (state === 'locked' && !pausedFlag)) && totalRecordedMs() >= maxMs) {
                finish('You reached the maximum recording length — finishing your take now.');
            }
        }

        function startTimer() { stopTimer(); timerId = window.setInterval(renderTimer, 100); }
        function stopTimer() { if (timerId) { window.clearInterval(timerId); timerId = 0; } }

        function setStatus(html, rec) {
            els.statusMsg.innerHTML = html;
            els.status.classList.toggle('rec', Boolean(rec));
        }

        function stopStream() {
            if (stream) {
                try { stream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                stream = null;
            }
            if (wakeLock) {
                try { wakeLock.release(); } catch (e) {}
                wakeLock = null;
            }
        }

        function requestWakeLock() {
            if (!navigator.wakeLock || !navigator.wakeLock.request) return;
            try {
                navigator.wakeLock.request('screen').then(function (lock) {
                    wakeLock = lock;
                    lock.addEventListener('release', function () { wakeLock = null; });
                }).catch(function () {});
            } catch (e) {}
        }

        document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible' && (state === 'hold' || state === 'locked') && !wakeLock) requestWakeLock();
        });

        function pauseStudyVideos() {
            try { document.querySelectorAll('video').forEach(function (v) { try { v.pause(); } catch (e) {} }); } catch (e) {}
        }

        function micErrorMessage(err) {
            var name = err && err.name ? err.name : '';
            if (name === 'NotAllowedError' || name === 'SecurityError') return 'Microphone was blocked. Tap the lock/camera icon in the browser address bar, allow the mic, then try again.';
            if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') return 'No microphone was found. Connect one and try again.';
            if (name === 'NotReadableError' || name === 'AbortError') return 'Microphone is busy in another app or tab. Close it there, then try again.';
            if (window.isSecureContext === false) return 'Microphone needs a secure connection (HTTPS). Ask the admin to open the site over HTTPS and try again.';
            return 'Microphone access was blocked. Allow it in your browser settings and try again.';
        }

        function acquireMic() {
            var constraints = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } };
            return navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
                if (err && (err.name === 'OverconstrainedError' || err.name === 'NotFoundError')) {
                    return navigator.mediaDevices.getUserMedia({ audio: true });
                }
                throw err;
            });
        }

        function paintMic() {
            els.idleMic.classList.toggle('holding', state === 'hold');
            els.micBtn.classList.toggle('holding', state === 'hold');
            els.micBtn.classList.toggle('locked', state === 'locked');
        }

        function updateUI() {
            var liveView = state === 'hold' || state === 'locked' || state === 'stopping';
            els.idle.classList.toggle('msr-hidden', state !== 'idle');
            els.stage.classList.toggle('msr-hidden', !liveView);
            els.locked.classList.toggle('msr-hidden', state !== 'locked');
            els.staging.classList.toggle('msr-hidden', state === 'locked');
            els.standing.classList.toggle('msr-hidden', state === 'locked');
            els.ready.classList.toggle('msr-hidden', state !== 'ready' && state !== 'sending');
            els.sent.classList.toggle('msr-hidden', state !== 'sent');
            paintMic();
            els.cancelBtn.classList.toggle('show', state !== 'idle' && liveView);
            els.cancelBtn.classList.toggle('armed', Boolean(drag.cancel));
            els.holdHintLeft.classList.toggle('show', (state === 'hold' && !drag.locked) || Boolean(drag.cancel));
            els.holdHintLeft.classList.toggle('danger', Boolean(drag.cancel));
            var rightText = '';
            if (drag.locked) rightText = 'Hands-free — tap stop when you finish';
            els.holdHintRight.innerHTML = rightText;
            els.holdHintRight.classList.toggle('show', Boolean(drag.locked));
            els.holdHintRight.classList.toggle('lock-on', Boolean(drag.locked));
            els.holdHintLeft.innerHTML = drag.cancel
                ? 'Release to <strong>discard</strong>'
                : '<strong>Recording</strong>&hellip;';
            els.progress.classList.toggle('on', state === 'hold' || state === 'locked');
            var fill = Math.min(100, Math.round(recordedBytes / softBytes * 100));
            els.progressFill.style.width = fill + '%';

            if (state === 'hold') { setHead('Recording', 'rec'); if (!els.status.classList.contains('rec')) setStatus('Recording&hellip;', true); }
            else if (state === 'locked' && !pausedFlag) { setHead('Recording', 'rec'); }
            else if (state === 'locked' && pausedFlag) { setHead('Paused', 'paused'); setStatus('Paused &mdash; resume or stop when ready.', false); }
            else if (state === 'stopping') { setHead('Finishing', 'idle'); }
            else { setHead('Standby', 'idle'); }
            renderTimer();
        }

        function beginCapture() {
            if (starting) return Promise.resolve(false);
            if (window.isSecureContext === false) {
                toast('Microphone needs a secure connection (HTTPS). Ask the admin to open the site over HTTPS and try again.', 'error');
                return Promise.resolve(false);
            }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
                toast('This browser cannot record audio. Try Chrome, Edge, Firefox or Safari.', 'error');
                return Promise.resolve(false);
            }
            starting = true;
            var captureId = ++captureSeq;
            var replacesPreview = state === 'ready';
            recordedBlob = null;
            discardOnStop = false;
            recordedBytes = 0;
            sizeStopTriggered = false;
            accumulatedMs = 0;
            startedAt = 0;
            pausedFlag = false;

            return acquireMic().then(function (cstream) {
                if (captureId !== captureSeq) {
                    try { cstream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
                    return false;
                }
                if (replacesPreview) clearDraft();
                stream = cstream;
                pauseStudyVideos();
                requestWakeLock();
                var mime = pickMime();
                try {
                    mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
                } catch (err) {
                    try { mediaRecorder = new MediaRecorder(stream); }
                    catch (err2) {
                        starting = false;
                        stopStream();
                        state = 'idle';
                        updateUI();
                        toast('This browser could not start the recorder.', 'error');
                        return false;
                    }
                }
                if (stream && stream.getAudioTracks && stream.getAudioTracks()[0]) {
                    stream.getAudioTracks()[0].onended = function () {
                        if (state === 'hold' || state === 'locked') {
                            toast('Microphone stopped. Tap the mic to record again.', 'error');
                            cancel(true);
                        }
                    };
                }

                chunks = [];
                mediaRecorder.ondataavailable = function (event) {
                    if (event.data && event.data.size) {
                        chunks.push(event.data);
                        recordedBytes += event.data.size;
                        if (recordedBytes > softBytes && !sizeStopTriggered && !discardOnStop) {
                            sizeStopTriggered = true;
                            toast('Recording is nearly at the size limit — finishing your take now.', 'info');
                            finish('');
                        }
                    }
                };
                mediaRecorder.onstop = handleStop;
                mediaRecorder.onerror = function () {
                    toast('The recorder stopped unexpectedly. Please try again.', 'error');
                    cancel(true);
                };

                mediaRecorder.start(250);
                starting = false;
                startedAt = Date.now();
                state = 'hold';
                if (meter) meter.start(stream);
                updateUI();
                // One tap starts a hands-free take; the stop control finishes it.
                enterLocked();
                return true;
            }).catch(function (err) {
                starting = false;
                toast(micErrorMessage(err), 'error');
                pointerHeld = false;
                kbHeld = false;
                holdActive = false;
                state = 'idle';
                updateUI();
                return false;
            });
        }

        function enterLocked() {
            state = 'locked';
            drag.locked = true;
            drag.cancel = false;
            updateUI();
            setStatus('Recording hands-free &mdash; pause or stop when finished.', true);
        }

        function pauseToggle() {
            if (state !== 'locked' || !mediaRecorder) return;
            if (!pausedFlag) {
                accumulatedMs += Date.now() - startedAt;
                try { mediaRecorder.pause(); } catch (e) {}
                pausedFlag = true;
                stopTimer();
                if (meter) meter.pause();
            } else {
                try { mediaRecorder.resume(); } catch (e) {}
                pausedFlag = false;
                startedAt = Date.now();
                startTimer();
                if (meter) meter.resume();
            }
            var icon = els.lockedPause.querySelector('i');
            if (icon) icon.className = pausedFlag ? 'fas fa-play' : 'fas fa-pause';
            els.lockedPause.setAttribute('aria-label', pausedFlag ? 'Resume' : 'Pause');
            updateUI();
        }

        function stopInternals() {
            if (meter) meter.stop();
            stopTimer();
            els.liveLbl.textContent = 'Finishing';
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                try { mediaRecorder.stop(); } catch (e) { handleStop(); }
            } else {
                handleStop();
            }
        }

        function cancel(silent) {
            if (state !== 'hold' && state !== 'locked') return;
            discardOnStop = true;
            state = 'stopping';
            updateUI();
            setStatus('Discarding&hellip;', false);
            stopInternals();
            if (!silent) toast('Recording discarded. Tap the mic to try again.', 'info');
        }

        function finish(note) {
            if (state !== 'hold' && state !== 'locked') return;
            if (elapsedMs() < minMs) {
                discardOnStop = true;
                state = 'stopping';
                updateUI();
                stopInternals();
                toast('Too short — tap the mic and recite a little longer.', 'info');
                return;
            }
            if (note) toast(note, 'info');
            state = 'stopping';
            updateUI();
            setStatus('Finishing your take&hellip;', false);
            stopInternals();
        }

        function handleStop() {
            stopStream();
            var type = (mediaRecorder && mediaRecorder.mimeType) || 'audio/webm';
            mediaRecorder = null;
            accumulatedMs = totalRecordedMs();
            startedAt = 0;
            stopTimer();
            lastStopAt = Date.now();
            renderTimer();

            if (discardOnStop) {
                discardOnStop = false;
                chunks = [];
                recordedBlob = null;
                accumulatedMs = 0;
                state = 'idle';
                updateUI();
                setStatus('Ready when you are — tap the mic to start.', false);
                return;
            }

            if (!chunks.length) {
                accumulatedMs = 0;
                state = 'idle';
                updateUI();
                setStatus('Nothing was captured. Tap the mic and try again.', false);
                return;
            }

            recordedBlob = new Blob(chunks, { type: type });
            chunks = [];
            state = 'ready';
            updateUI();
            buildPreview();
        }

        function clearDraft() {
            if (draftBubble) { draftBubble.destroy(); draftBubble = null; }
            recordedBlob = null;
        }

        function buildPreview() {
            els.preview.innerHTML = '';
            if (!recordedBlob) { els.readyStatus.textContent = ''; return; }
            var duration = Math.max(1, Math.round(totalRecordedMs() / 1000));
            if (window.MSVoice && MSVoice.bubble) {
                draftBubble = MSVoice.bubble(els.preview, {
                    id: 'msr-draft-' + Date.now(),
                    duration: duration,
                    loader: function () { return Promise.resolve(recordedBlob); }
                });
            } else {
                els.preview.innerHTML = '<em style="color:#7e958a">Voice note ready — ' + fmtTime(duration) + '</em>';
            }
            var tooBig = recordedBlob.size > maxBytes;
            els.readyStatus.textContent = tooBig
                ? 'This take is over the ' + Math.round(maxBytes / (1024 * 1024)) + ' MB limit. Discard it and record a shorter passage.'
                : 'Listen back — send it to the review queue when it sounds right.';
            els.submit.disabled = Boolean(tooBig);
        }

        function discardDraft() {
            if (state === 'sending') return;
            clearDraft();
            accumulatedMs = 0;
            recordedBytes = 0;
            state = 'idle';
            updateUI();
            setStatus('Ready when you are — tap the mic to start.', false);
            toast('Take discarded. Tap the mic when ready.', 'info');
        }

        function reset() {
            captureSeq++;
            starting = false;
            discardOnStop = true;
            if (mediaRecorder) {
                mediaRecorder.onstop = null;
                mediaRecorder.ondataavailable = null;
                if (mediaRecorder.state !== 'inactive') {
                    try { mediaRecorder.stop(); } catch (e) {}
                }
            }
            mediaRecorder = null;
            stopStream();
            if (meter) meter.stop();
            stopTimer();
            chunks = [];
            clearDraft();
            recordedBytes = 0;
            accumulatedMs = 0;
            startedAt = 0;
            pausedFlag = false;
            state = 'idle';
            var pauseIcon = els.lockedPause.querySelector('i');
            if (pauseIcon) pauseIcon.className = 'fas fa-pause';
            els.lockedPause.setAttribute('aria-label', 'Pause');
            updateUI();
            setStatus('Ready when you are — tap the mic to start.', false);
        }

        /* ---------- tap / hold wiring ---------- */
        function pressStart(event) {
            var isKey = event.type === 'keydown';
            if (!isKey && Date.now() - lastStopAt < CLICK_GUARD_MS) return;
            if (starting) return;
            if (state !== 'idle' && state !== 'ready') return;
            if (event.preventDefault) event.preventDefault();
            event.stopPropagation && event.stopPropagation();
            lastInteractionAt = Date.now();
            if (!isKey) lastPointerAt = lastInteractionAt;
            if (isKey) kbHeld = true;
            else pointerHeld = true;
            holdActive = true;
            drag = { active: true, x0: event.clientX || 0, y0: event.clientY || 0, cancel: false, locked: false };
            var node = event.currentTarget;
            if (node && node.setPointerCapture && !isKey && event.pointerId !== undefined) {
                try { node.setPointerCapture(event.pointerId); } catch (e) {}
            }
            beginCapture();
        }

        function pointerMove(event) {
            if ((state !== 'hold' && state !== 'locked') || !drag.active) return;
            if (event.clientX === undefined && event.clientY === undefined) return;
            var dx = drag.x0 - (event.clientX || 0);
            var dy = drag.y0 - (event.clientY || 0);
            if (dx > 64) { drag.cancel = true; drag.locked = false; }
            else {
                drag.cancel = false;
                if (dy > 46 && state === 'hold' && !drag.locked) enterLocked();
            }
            updateUI();
        }

        function finishHold() {
            if (!pointerHeld && !kbHeld) return;
            pointerHeld = false;
            kbHeld = false;
            holdActive = false;
            lastPointerAt = Date.now();
            var wasCancel = drag.cancel;
            drag = { active: false, x0: 0, y0: 0, cancel: false, locked: false };
            if (wasCancel && (state === 'hold' || state === 'locked')) { cancel(false); return; }
            updateUI();
        }

        function bindHold(node) {
            if (!node) return;
            node.addEventListener('pointerdown', pressStart);
            node.addEventListener('pointermove', pointerMove);
            node.addEventListener('pointerup', finishHold);
            node.addEventListener('contextmenu', function (e) { e.preventDefault(); });
        }

        document.addEventListener('pointerup', function () { if (pointerHeld) finishHold(); });
        document.addEventListener('pointercancel', function () { if (pointerHeld) finishHold(); });

        bindHold(els.idleMic);
        bindHold(els.micBtn);

        function toggleViaClick() {
            var now = Date.now();
            if (now - lastInteractionAt < 600 || now - lastPointerAt < 1000) return;
            if (state === 'locked') { finish(''); return; }
            if (state !== 'idle' && state !== 'ready') return;
            lastInteractionAt = now;
            beginCapture();
        }
        els.idleMic.addEventListener('click', toggleViaClick);
        els.micBtn.addEventListener('click', toggleViaClick);

        document.addEventListener('keydown', function (event) {
            if (!ui.classList.contains('open')) return;
            var tag = ((event.target && event.target.tagName) || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select' || (event.target && event.target.isContentEditable)) return;
            var key = event.key || '';
            var code = event.code || '';
            if (key === 'Escape') {
                if (state === 'hold' || state === 'locked') {
                    event.preventDefault();
                    cancel(false);
                }
                return;
            }
            if (key !== ' ' && code !== 'Space' && key !== 'Spacebar') return;
            if (event.repeat || kbHeld) return;
            event.preventDefault();
            if (state === 'locked') { finish(''); return; }
            if (state !== 'idle' && state !== 'ready') return;
            pressStart({ type: 'keydown', clientX: 0, clientY: 0, preventDefault: function () {} });
        });
        document.addEventListener('keyup', function (event) {
            if (!kbHeld) return;
            var key = event.key || '';
            var code = event.code || '';
            if (key !== ' ' && code !== 'Space' && key !== 'Spacebar') return;
            kbHeld = false;
            lastInteractionAt = Date.now();
            drag.cancel = false;
            updateUI();
        });

        els.cancelBtn.addEventListener('click', function () {
            if (state === 'hold' || state === 'locked') cancel(false);
        });
        els.lockedCancel.addEventListener('click', function () { if (state === 'locked') cancel(false); });
        els.lockedPause.addEventListener('click', pauseToggle);
        els.lockedFinish.addEventListener('click', function () { if (state === 'locked') finish(''); });
        els.discard.addEventListener('click', discardDraft);

        els.submit.addEventListener('click', function () {
            if (!recordedBlob || state === 'sending') return;
            if (typeof opts.send !== 'function') {
                toast('Recording storage is not wired on this page.', 'error');
                return;
            }
            if (recordedBlob.size > maxBytes) {
                toast('This take is too large — discard it and record a shorter passage.', 'error');
                return;
            }
            var form = new FormData();
            if (opts.assignmentId) form.append('assignmentId', String(opts.assignmentId));
            else form.append('lessonId', String(opts.lessonId || ''));
            form.append('durationSeconds', String(Math.max(1, Math.round(totalRecordedMs() / 1000))));
            form.append('audio', recordedBlob, 'recitation' + extensionForMime(recordedBlob.type));

            state = 'sending';
            els.submit.disabled = true;
            var sendLabel = els.submit.innerHTML;
            els.submit.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Sending&hellip;';
            els.discard.disabled = true;
            setHead('Sending', 'idle');

            Promise.resolve()
                .then(function () { return opts.send(form); })
                .then(function () {
                    state = 'sent';
                    clearDraft();
                    updateUI();
                    setHead('Sent', 'idle');
                    toast('Recording sent for review.', 'success');
                    if (typeof opts.onSent === 'function') {
                        try { opts.onSent(); } catch (e) {}
                    }
                    window.setTimeout(function () {
                        reset();
                        els.submit.disabled = false;
                        els.submit.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
                        els.discard.disabled = false;
                        setStatus('Ready for your next take — tap the mic to start.', false);
                        if (typeof opts.reset === 'function') opts.reset();
                    }, 2000);
                })
                .catch(function (err) {
                    if (state === 'sent') return;
                    state = 'ready';
                    els.submit.disabled = false;
                    els.submit.innerHTML = sendLabel;
                    els.discard.disabled = false;
                    if (err && err.message) els.readyStatus.textContent = err.message;
                    setHead('Standby', 'idle');
                    toast((err && err.message) || 'Could not send the recording.', 'error');
                });
        });

        return {
            elem: ui,
            open: function () {
                ui.classList.add('open');
                try { ui.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e) {}
            },
            start: function () {
                if (state === 'idle' || state === 'ready') beginCapture();
            },
            close: function () {
                reset();
                ui.classList.remove('open');
            },
            reset: reset,
            destroy: function () {
                reset();
                if (ui.parentNode) ui.parentNode.removeChild(ui);
            }
        };
    }

    /* Stops capture for every mounted instance (bulk: stop all). */
    var instances = [];

    window.MSRecorder = {
        mount: function (host, opts) {
            var inst = mount(host, opts);
            instances.push({ inst: inst, host: host });
            return inst;
        },
        stopAll: function () {
            for (var i = 0; i < instances.length; i++) {
                try { instances[i].inst.reset(); } catch (e) {}
            }
        }
    };

    window.addEventListener('beforeunload', function () {
        window.MSRecorder.stopAll();
    });
})();
