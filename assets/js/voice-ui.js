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
    var liveBubbles = new Set();
    var activePlay = null;

    function claimPlay(self) {
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
    }

    function acquireCtx() {
        if (sharedCtx) return sharedCtx;
        var Ctx = global.AudioContext || global.webkitAudioContext;
        if (!Ctx) return null;
        try { sharedCtx = new Ctx(); } catch (e) { sharedCtx = null; }
        return sharedCtx;
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
                audio.src = objectUrl;

                audio.addEventListener('error', function () {
                    resetVisuals();
                    setIcon('play');
                });
                audio.addEventListener('ended', function () {
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
                notifyPlayed();
                setIcon('pause');
                if (rafId) cancelAnimationFrame(rafId);
                rafId = requestAnimationFrame(tick);
            } catch (err) {
                if (!destroyed) {
                    releaseAudio();
                    resetVisuals();
                    setIcon('play');
                }
            }
        }

        async function toggle() {
            claimPlay(self);
            if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
            if (audio && !audio.paused) {
                audio.pause();
                setIcon('play');
                paint(progress());
                return;
            }
            if (audio && audio.paused) {
                try { await audio.play(); notifyPlayed(); } catch (e) { }
                setIcon('pause');
                rafId = requestAnimationFrame(tick);
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
            stop: function () {
                if (audio && !audio.paused) {
                    audio.pause();
                    setIcon('play');
                    paint(progress());
                }
                if (activePlay === self) activePlay = null;
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
            var size = analyser.frequencyBinCount;
            var data = new Uint8Array(size);
            analyser.getByteFrequencyData(data);
            var groups = bars.length;
            var step = Math.floor(size / groups) || 1;
            for (var i = 0; i < groups; i++) {
                var sum = 0;
                var n = 0;
                for (var j = i * step; j < Math.min(size, (i + 1) * step); j++) {
                    sum += data[j];
                    n++;
                }
                var level = n ? (sum / n) / 255 : 0;
                var h = Math.max(8, Math.min(100, level * 160));
                bars[i].style.height = Math.round(h) + '%';
            }
            rafId = requestAnimationFrame(renderLoop);
        }

        return {
            start: function (stream) {
                var ctx = acquireCtx();
                if (!ctx || !global.AnalyserNode) return false;
                try {
                    source = ctx.createMediaStreamSource(stream);
                    analyser = ctx.createAnalyser();
                    analyser.fftSize = 256;
                    analyser.smoothingTimeConstant = 0.75;
                    source.connect(analyser);
                    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                    rafId = requestAnimationFrame(renderLoop);
                    return true;
                } catch (err) {
                    analyser = null;
                    source = null;
                    return false;
                }
            },
            pause: function () {
                if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
                idleWave = true;
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
                source = null;
                analyser = null;
                idleLoop();
            }
        };
    }

    global.MSVoice = {
        bubble: bubble,
        liveMeter: liveMeter,
        formatTime: formatTime,
        stopAll: stopAll,
        clearCache: function () { peaksCache.clear(); }
    };
})(window);
