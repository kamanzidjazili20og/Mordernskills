const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { sniffAudioType } = require('./audio-format');

const NORMALIZED_MIME = 'audio/mp4';
const NORMALIZED_EXTENSION = '.m4a';
const FILTER = 'highpass=f=75,acompressor=threshold=0.06:knee=6:ratio=3:attack=10:release=180:makeup=1,loudnorm=I=-17:TP=-1.5:LRA=11';

function canonicalizeAudioFile(file) {
    const detected = sniffAudioType(file && file.buffer);
    if (!detected) throw new Error('The uploaded audio file is invalid or unsupported.');
    file.mimetype = detected.mime;
    file.originalname = `voice-${Date.now()}-${uuidv4().slice(0, 8)}${detected.extension}`;
    file.size = file.buffer.length;
    return file;
}

function normalizeBuffer(buffer, options) {
    let ffmpegPath;
    try {
        ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
    } catch (err) {
        return Promise.reject(new Error('ffmpeg is not installed. Run npm install in backend.'));
    }
    const bitrate = Number(options && options.bitrate) || 96000;
    const timeoutMs = Number(options && options.timeoutMs) || 120000;
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ms-voice-'));
    const inputPath = path.join(tempDir, 'input.audio');
    const outputPath = path.join(tempDir, 'output.m4a');
    fs.writeFileSync(inputPath, buffer);

    const args = [
        '-hide_banner',
        '-loglevel', 'error',
        '-y',
        '-i', inputPath,
        '-vn',
        '-af', FILTER,
        '-ac', '1',
        '-ar', '48000',
        '-c:a', 'aac',
        '-b:a', Math.round(bitrate / 1000) + 'k',
        '-movflags', '+faststart',
        '-f', 'mp4',
        outputPath
    ];

    return new Promise(function (resolve, reject) {
        let settled = false;
        let stderr = '';
        const child = spawn(ffmpegPath, args, { windowsHide: true });
        const timer = setTimeout(function () {
            try { child.kill(); } catch (err) {}
            settle(new Error('Audio processing timed out.'));
        }, timeoutMs);

        function settle(error, result) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (error) reject(error);
            else resolve(result);
        }

        child.stderr.on('data', function (chunk) {
            stderr = (stderr + chunk.toString()).slice(-4000);
        });
        child.on('error', function (err) {
            settle(err);
        });
        child.on('close', function (code) {
            if (code !== 0) {
                settle(new Error(stderr || ('ffmpeg exited with code ' + code)));
                return;
            }
            try {
                const normalized = fs.readFileSync(outputPath);
                settle(null, {
                    buffer: normalized,
                    mime: NORMALIZED_MIME,
                    extension: NORMALIZED_EXTENSION,
                    size: normalized.length
                });
            } catch (err) {
                settle(err);
            }
        });
    }).finally(function () {
        fs.rmSync(tempDir, { recursive: true, force: true });
    });
}

async function prepareVoiceFile(file, label, options) {
    canonicalizeAudioFile(file);
    try {
        const normalized = await normalizeBuffer(file.buffer, options);
        file.buffer = normalized.buffer;
        file.mimetype = normalized.mime;
        file.originalname = `voice-${Date.now()}-${uuidv4().slice(0, 8)}${normalized.extension}`;
        file.size = normalized.size;
    } catch (err) {
        console.error('Voice normalization failed for ' + (label || 'audio') + ':', err.message);
    }
    return file;
}

module.exports = {
    AUDIO_MIME: NORMALIZED_MIME,
    AUDIO_EXTENSION: NORMALIZED_EXTENSION,
    canonicalizeAudioFile,
    normalizeBuffer,
    prepareVoiceFile
};
