/* Modern Skills — Telegram-style voice message bubbles + live mic meter.
   Shared by recite.html, teacher.html and admin.html.

   MSVoice.bubble(container, opts) -> { el, demolish() }
     opts: {
       id        : unique key for waveform caching,
       duration  : seconds (title bar length while the blob loads),
       loader    : async () => Blob (authorized fetch lives in the page),
       compact   : smaller bubble for dense lists,
       onPlayed  : optional () => void, fired once playback has started
                   (review dashboards use it for the Listen → Comment →
                   Send gate so a review can't be sent before listening)
     }

   MSVoice.liveMeter(container) -> { start(stream), stop(), setLevel(lvl) }
    /* Telegram-style live WebAudio bars for the recorder. */
(function (global) {
    'use strict';

    var BARS = 32;
    var peaksCache = new Map();
    var sharedCtx = null;
    var playbackGraphs = typeof WeakMap === 'function' ? new WeakMap() : null;
    var liveBubbles = new Set();
    var pausedByRecorder = new Set();
    var activePlay = null;
    var duckVolume = 1;

    function claimPlay(self) {
        pausedByRecorder.delete(self);
        if (activePlay && activePlay !== self) {
            try { activePlay.stop(); } catch (e) { }
        }
        activePlay = self;
    }

    function stopAll() {
        liveBubbles.forEach(function (b) {
            try { b.stop(); } catch (e) { }
        });
        if (activePlay) activePlay = null;
        pausedByRecorder.clear();
    }

    function anyPlaying() {
        var playing = false;
        liveBubbles.forEach(function (b) {
            if (!playing && typeof b.isPlaying === 'function' && b.isPlaying()) playing = true;
        });
        return playing;
    }

    function setDuckVolume(factor) {
        duckVolume = Math.max(0, Math.min(1, Number(factor) || 0));
        liveBubbles.forEach(function (b) {
            if (typeof b.setVolume === 'function') b.setVolume(duckVolume);
        });
    }

    function pauseAll() {
        pausedByRecorder.clear();
        liveBubbles.forEach(function (b) {
            if (typeof b.isPlaying === 'function' && b.isPlaying() && typeof b.pause === 'function') {
                b.pause();
                pausedByRecorder.add(b);
            }
        });
    }

    function resumeAll() {
        pausedByRecorder.forEach(function (b) {
            if (typeof b.resume === 'function') b.resume();
        });
        pausedByRecorder.clear();
    }

    function acquireCtx() {
        if (sharedCtx) return sharedCtx;
        var Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        try { sharedCtx = new Ctx(); } catch (e) { sharedCtx = null; }
        if (sharedCtx && sharedCtx.state === 'suspended') sharedCtx.resume().catch(function () {});
        return sharedCtx;
    }

    function attachPlaybackGraph(audio) {
        var ctx = acquireCtx();
        if (!ctx || typeof ctx.createMediaElementSource !== 'function') return;
        if (playbackGraphs && playbackGraphs.has(audio)) return;
        try {
            var source = ctx.createMediaElementSource(audio);
            var highpass = ctx.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 70;
            highpass.Q.value = 0.707;

            var presence = ctx.createBiquadFilter();
            presence.type = 'peaking';
            presence.frequency.value = 2600;
            presence.Q.value = 0.9;
            presence.gain.value = 2;

            var airCut = ctx.createBiquadFilter();
            airCut.type = 'highshelf';
            airCut.frequency.value = 8500;
            airCut.gain.value = -1.5;

            var gain = ctx.createGain();
            gain.gain.value = 1.12;

            var limiter = ctx.createDynamicsCompressor();
            limiter.threshold.value = -2;
            limiter.knee.value = 0;
            limiter.ratio.value = 20;
            limiter.attack.value = 0.001;
            limiter.release.value = 0.05;

            source.connect(highpass);
            highpass.connect(presence);
            presence.connect(airCut);
            airCut.connect(gain);
            gain.connect(limiter);
            limiter.connect(ctx.destination);
            if (playbackGraphs) playbackGraphs.set(audio, { source: source, nodes: [source, highpass, presence, airCut, gain, limiter] });
        } catch (e) {}
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function formatTime(seconds) {
        var total = Math.max(0, Math.round(Number(seconds) || 0));
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        if (mins >= 100) return mins + ':' + String(secs).padStart(2, '0');
        return mins + ':' + String(secs).padStart(2, '0');
    }

    /* Deterministic pseudo-peaks so a bubble whose audio cannot be decoded yet
       still shows a believable Telegram-shaped wave instead of a flat line. */
    function fallbackPeaks(seed) {
        var out = [];
        var n = Number(seed) || 1;
        for (var i = 0; i < BARS; i++) {
            n = (n * 9301 + 49297) % 233280;
            var base = 0.25 + (n / 233280) * 0.75;
            out.push(Math.min(1, base * (0.55 + 0.45 * Math.sin(i * 1.7 + n / 9000) + 0.25)));
        }
        return out.length ? out.map(function (v) { return Math.max(0.08, Math.min(1, Math.abs(v))); }) : [0.3];
    }

    function computePeaks(buffer, count) {
        var channel = buffer.getChannelData(0);
        var blocks = Math.floor(channel.length / count) || 1;
        var peaks = [];
        for (var i = 0; i < count; i++) {
            var start = i * blocks;
            var end = Math.min(channel.length, start + blocks);
            var sum = 0;
            var samples = 0;
            for (var j = start; j < end; j += Math.max(1, Math.floor((end - start) / 600))) {
                sum += channel[j] * channel[j];
                samples++;
            }
            peaks.push(samples ? Math.sqrt(sum / samples) : 0);
        }
        var max = 0;
        for (var k = 0; k < peaks.length; k++) max = Math.max(max, peaks[k]);
        if (max <= 0.0001) return null;
        return peaks.map(function (p) {
            var scaled = Math.pow(p / max, 0.85);
            return Math.max(0.08, Math.min(1, scaled));
        });
    }

    function loadPeaks(id, loader) {
        if (peaksCache.has(id)) return peaksCache.get(id);
        var promise = (async function () {
            try {
                var blob = await loader();
                var ctx = acquireCtx();
                if (!ctx) throw new Error('no audio ctx');
                var arrayBuffer = await blob.arrayBuffer();
                var buffer = await ctx.decodeAudioData(arrayBuffer.slice(0));
                return computePeaks(buffer, BARS) || fallbackPeaks(id);
            } catch (err) {
                return fallbackPeaks(id);
            }
        })();
        peaksCache.set(id, promise);
        promise.catch(function () { peaksCache.delete(id); });
        return promise;
    }

    function buildWaveform(waveEl, peaks) {
        waveEl.innerHTML = '';
        var frag = document.createDocumentFragment();
        for (var i = 0; i < peaks.length; i++) {
            var bar = document.createElement('i');
            bar.style.setProperty('--vsu-h', (18 + Math.round(peaks[i] * 82)) + '%');
            frag.appendChild(bar);
        }
        waveEl.appendChild(frag);
        return Array.prototype.slice.call(waveEl.children);
    }

    function bubble(container, opts) {
        opts = opts || {};
        var id = opts.id != null ? String(opts.id) : String(Date.now());
        Array.prototype.slice.call(container.children).forEach(function (child) {
            if (child.__msVoice) {
                try { child.__msVoice.destroy(); } catch (e) { }
            }
        });
        var el = document.createElement('div');
        el.className = 'vsu-bubble' + (opts.compact ? ' vsu-compact' : '');
        el.innerHTML = ''
            + '<button type="button" class="vsu-play" aria-label="Play recording">'
            + '  <i class="fas fa-play vsu-icon-play"></i>'
            + '  <i class="fas fa-pause vsu-icon-pause" style="display:none"></i>'
            + '  <i class="fas fa-circle-notch fa-spin vsu-icon-load" style="display:none"></i>'
            + '</button>'
            + '<div class="vsu-wave" tabindex="0" role="slider" aria-label="Recording timeline"></div>'
            + '<span class="vsu-time">' + escapeHtml(formatTime(opts.duration)) + '</span>';
        container.appendChild(el);

        var playBtn = el.querySelector('.vsu-play');
        var waveEl = el.querySelector('.vsu-wave');
        var timeEl = el.querySelector('.vsu-time');
        var icons = {
            play: el.querySelector('.vsu-icon-play'),
            pause: el.querySelector('.vsu-icon-pause'),
            load: el.querySelector('.vsu-icon-load')
        };

        var audio = null;
        var objectUrl = null;
        var bars = buildWaveform(waveEl, fallbackPeaks(id));
        var rafId = 0;
        var destroyed = false;
        var isPlaying = false;

        loadPeaks(id, opts.loader).then(function (peaks) {
            if (destroyed) return;
            bars = buildWaveform(waveEl, peaks);
            paint(0);
        });

        function setIcon(name) {
            icons.play.style.display = name === 'play' ? '' : 'none';
            icons.pause.style.display = name === 'pause' ? '' : 'none';
            icons.load.style.display = name === 'load' ? '' : 'none';
        }

        var playedNotified = false;
        function notifyPlayed() {
            if (playedNotified) return;
            playedNotified = true;
            if (typeof opts.onPlayed === 'function') {
                try { opts.onPlayed(); } catch (e) { }
            }
        }

        function paint(progress) {
            var p = Math.max(0, Math.min(1, progress || 0));
            var active = p * bars.length;
            for (var i = 0; i < bars.length; i++) {
                var bar = bars[i];
                if (i + 1 <= active) bar.className = 'vsu-did';
                else if (i <= active) bar.className = 'vsu-now';
                else bar.className = '';
            }
        }

        function progress() {
            var dur = safeDuration();
            return dur > 0 ? audio.currentTime / dur : 0;
        }

        function safeDuration() {
            if (audio && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
            return Math.max(1, Number(opts.duration) || 0);
        }

        function tick() {
            if (destroyed) return;
            if (audio && !audio.paused) {
                paint(progress());
                timeEl.textContent = formatTime(audio.currentTime);
                rafId = requestAnimationFrame(tick);
            }
        }

        function resetVisuals() {
            paint(0);
            timeEl.textContent = formatTime(opts.duration);
        }

        function releaseAudio() {
            isPlaying = false;
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            if (audio) {
                audio.pause();
                audio.src = '';
                audio = null;
            }
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
                objectUrl = null;
            }
        }

        async function fetchAndPlay() {
            setIcon('load');
            try {
                var blob = await opts.loader();
                if (destroyed) return;
                objectUrl = URL.createObjectURL(blob);
                audio = new Audio();
                audio.preload = 'auto';
                audio.volume = duckVolume;
                audio.src = objectUrl;
                attachPlaybackGraph(audio);

                audio.addEventListener('error', function () {
                    isPlaying = false;
                    resetVisuals();
                    setIcon('play');
                });
                audio.addEventListener('ended', function () {
                    isPlaying = false;
                    paint(1);
                    setTimeout(function () {
                        if (!destroyed) resetVisuals();
                    }, 450);
                    setIcon('play');
                    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                    notifyPlayed();
                });

                audio.currentTime = 0;
                await audio.play();
                if (destroyed) { releaseAudio(); return; }
                isPlaying = true;
                notifyPlayed();
                setIcon('pause');
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(tick);
            } catch (err) {
                isPlaying = false;
                if (!destroyed) {
                    releaseAudio();
                    resetVisuals();
                    setIcon('play');
                }
            }
        }

        async function toggle() {
            claimPlay(self);
            pausedByRecorder.delete(self);
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            if (audio && !audio.paused) {
                isPlaying = false;
                audio.pause();
                setIcon('play');
                paint(progress());
                return;
            }
            if (audio && audio.paused) {
                audio.volume = duckVolume;
                try {
                    await audio.play();
                    isPlaying = true;
                    notifyPlayed();
                    setIcon('pause');
                    rafId = requestAnimationFrame(tick);
                } catch (e) {
                    isPlaying = false;
                    setIcon('play');
                }
                return;
            }
            await fetchAndPlay();
        }

        function seekFromEvent(event) {
            if (!audio) return;
            var rect = waveEl.getBoundingClientRect();
            var x = event.clientX - rect.left;
            var frac = Math.max(0, Math.min(1, x / Math.max(1, rect.width)));
            var dur = safeDuration();
            if (isFinite(dur) && dur > 0) {
                audio.currentTime = Math.max(0, dur * frac - 0.01);
                paint(frac);
                timeEl.textContent = formatTime(dur * frac);
            }
        }

        playBtn.addEventListener('click', function (e) {
            e.stopPropagation();
            toggle();
        });
        waveEl.addEventListener('click', seekFromEvent);

        var self = {
            el: el,
            play: toggle,
            pause: function () {
                if (!audio || audio.paused) return;
                isPlaying = false;
                audio.pause();
                setIcon('play');
                paint(progress());
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            },
            resume: function () {
                if (audio && audio.paused) toggle();
            },
            stop: function () {
                isPlaying = false;
                pausedByRecorder.delete(self);
                if (audio && !audio.paused) {
                    audio.pause();
                    setIcon('play');
                    paint(progress());
                }
                if (activePlay === self) activePlay = null;
            },
            isPlaying: function () { return isPlaying; },
            setVolume: function (value) {
                if (audio) audio.volume = Math.max(0, Math.min(1, Number(value) || 0));
            },
            reset: resetVisuals,
            destroy: function () {
                destroyed = true;
                releaseAudio();
                liveBubbles.delete(self);
                if (activePlay === self) activePlay = null;
                if (el.parentNode) el.parentNode.removeChild(el);
            }
        };
        el.__msVoice = self;
        liveBubbles.add(self);
        return self;
    }

    /* Live recording bars driven by the mic stream (Telegram recorder). */
    function liveMeter(container, barCount) {
        var count = barCount || 26;
        container.innerHTML = '';
        var bars = [];
        var frag = document.createDocumentFragment();
        for (var i = 0; i < count; i++) {
            var bar = document.createElement('span');
            frag.appendChild(bar);
            bars.push(bar);
        }
        container.appendChild(frag);

        var analyser = null;
        var source = null;
        var silentSink = null;
        var rafId = 0;
        var idleWave = false;
        var t0 = Date.now();

        function idleLoop() {
            var t = Date.now() - t0;
            for (var i = 0; i < bars.length; i++) {
                var lvl = 0.12 + 0.16 * (1 + Math.sin(t / 320 + i * 0.9)) + (i % 3) * 0.05;
                bars[i].style.height = Math.round(lvl * 100) + '%';
            }
            if (!analyser) rafId = requestAnimationFrame(idleLoop);
        }
        idleLoop();

        function renderLoop() {
            if (!analyser) return;
            var size = analyser.fftSize;
            var data = new Float32Array(size);
            analyser.getFloatTimeDomainData(data);
            var peak = 0;
            var sumSq = 0;
            for (var i = 0; i < size; i++) {
                var v = data[i];
                var av = Math.abs(v);
                if (av > peak) peak = av;
                sumSq += v * v;
            }
            var rms = Math.sqrt(sumSq / Math.max(1, size));
            var level = Math.min(1, Math.max(rms * 4.2, peak * 1.8));
            var groups = bars.length;
            for (var b = 0; b < groups; b++) {
                var wave = 0.72 + 0.28 * Math.sin((Date.now() / 180) + b * 0.85);
                var h = Math.max(8, Math.min(100, level * wave * 100));
                bars[b].style.height = Math.round(h) + '%';
            }
            rafId = requestAnimationFrame(renderLoop);
        }

        return {
            start: function (stream) {
                var ctx = acquireCtx();
                if (!ctx || !global.AnalyserNode) return false;
                try {
                    if (ctx.state === 'suspended') ctx.resume().catch(function () {});
                    source = ctx.createMediaStreamSource(stream);
                    analyser = ctx.createAnalyser();
                    analyser.fftSize = 512;
                    analyser.smoothingTimeConstant = 0.7;
                    silentSink = ctx.createGain();
                    silentSink.gain.value = 0;
                    source.connect(analyser);
                    analyser.connect(silentSink);
                    silentSink.connect(ctx.destination);
                    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                    rafId = requestAnimationFrame(renderLoop);
                    return true;
                } catch (err) {
                    analyser = null;
                    source = null;
                    silentSink = null;
                    return false;
                }
            },
            pause: function () {
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                idleWave = true;
                idleLoop();
            },
            resume: function () {
                idleWave = false;
                if (rafId) cancelAnimationFrame(rafId);
                if (analyser) rafId = requestAnimationFrame(renderLoop);
                else idleLoop();
            },
            stop: function () {
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                try { if (source) source.disconnect(); } catch (e) { }
                try { if (analyser) analyser.disconnect(); } catch (e) { }
                try { if (silentSink) silentSink.disconnect(); } catch (e) { }
                source = null;
                analyser = null;
                silentSink = null;
                idleLoop();
            }
        };
    }

    function audioExtension(mime) {
        mime = String(mime || '').toLowerCase();
        if (mime.indexOf('ogg') !== -1) return '.ogg';
        if (mime.indexOf('mp4') !== -1 || mime.indexOf('m4a') !== -1) return '.m4a';
        if (mime.indexOf('mpeg') !== -1) return '.mp3';
        if (mime.indexOf('wav') !== -1) return '.wav';
        if (mime.indexOf('aac') !== -1) return '.aac';
        return '.webm';
    }

    function audioFileName(title, mime) {
        var clean = String(title || 'quran-recitation')
            .replace(/[\\/:*?"<>|]+/g, '')
            .trim()
            .replace(/\s+/g, '-')
            .slice(0, 70)
            .toLowerCase();
        if (!clean) clean = 'quran-recitation';
        return 'modern-skills-' + clean + '-' + new Date().toISOString().slice(0, 10) + audioExtension(mime);
    }

    function whatsappUrl(title, fileName) {
        var message = 'Modern Skills Qur\'an recitation' + (title ? ': ' + title : '') + (fileName ? ' — ' + fileName : '') + '.';
        return 'https://wa.me/250783198148?text=' + encodeURIComponent(message);
    }

    function downloadAudio(blob, title) {
        if (!blob) return '';
        var name = audioFileName(title, blob.type);
        var url = URL.createObjectURL(blob);
        var link = document.createElement('a');
        link.href = url;
        link.download = name;
        link.rel = 'noopener';
        document.body.appendChild(link);
        link.click();
        link.remove();
        global.setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        return name;
    }

    function showWaReceipt(anchor, title, result) {
        if (!anchor) return;
        var name = result && result.fileName ? result.fileName : audioFileName(title, 'audio/mp4');
        anchor.href = result && result.waUrl ? result.waUrl : whatsappUrl(title, name);
        anchor.setAttribute('aria-label', 'Open WhatsApp');
        anchor.title = 'Open WhatsApp';
        anchor.classList.remove('rec-hidden', 'msr-hidden');
    }

    function fallbackAudioShare(blob, title, notify) {
        var name = downloadAudio(blob, title);
        notify('Audio downloaded as ' + name + '. Open WhatsApp to attach it.', 'info');
        return Promise.resolve({
            shared: false,
            native: false,
            fallback: true,
            cancelled: false,
            fileName: name,
            waUrl: whatsappUrl(title, name)
        });
    }

    function shareAudio(opts) {
        opts = opts || {};
        var blob = opts.blob;
        var title = String(opts.title || 'Qur\'an recitation');
        var notify = opts.toast || function () {};
        if (!blob || typeof blob.size !== 'number') {
            notify('Record something first.', 'error');
            return Promise.resolve({ shared: false, error: true, cancelled: true, fileName: '', waUrl: whatsappUrl(title) });
        }

        var mime = String(blob.type || 'audio/webm').split(';')[0].trim() || 'audio/webm';
        var name = audioFileName(title, mime);
        var url = whatsappUrl(title, name);
        var file = null;
        try {
            if (typeof File === 'function') {
                file = new File([blob], name, { type: mime });
            }
        } catch (e) { file = null; }

        if (file && global.navigator && typeof navigator.share === 'function') {
            var shareText = 'Modern Skills — ' + title;
            var attempts = [
                { files: [file] },
                { files: [file], title: shareText, text: shareText }
            ];
            function tryNative(index) {
                if (index >= attempts.length) return fallbackAudioShare(blob, title, notify);
                try {
                    var result = navigator.share(attempts[index]);
                    if (!result || typeof result.then !== 'function') return tryNative(index + 1);
                    return result.then(function () {
                        notify('Audio handed to your share sheet. Choose WhatsApp to send it.', 'success');
                        return { shared: true, native: true, fallback: false, cancelled: false, fileName: name, waUrl: url };
                    }).catch(function (err) {
                        if (err && err.name === 'AbortError') {
                            notify('Sharing cancelled.', 'info');
                            return { shared: false, native: false, fallback: false, cancelled: true, fileName: name, waUrl: url };
                        }
                        return tryNative(index + 1);
                    });
                } catch (err) {
                    return tryNative(index + 1);
                }
            }
            return tryNative(0);
        }
        return fallbackAudioShare(blob, title, notify);
    }

    global.MSVoice = {
        bubble: bubble,
        liveMeter: liveMeter,
        formatTime: formatTime,
        stopAll: stopAll,
        isPlaying: anyPlaying,
        pauseAll: pauseAll,
        resumeAll: resumeAll,
        setDuck: setDuckVolume,
        shareAudio: shareAudio,
        downloadAudio: downloadAudio,
        audioFileName: audioFileName,
        whatsappUrl: whatsappUrl,
        showWaReceipt: showWaReceipt,
        clearCache: function () { peaksCache.clear(); }
    };
})(window);
