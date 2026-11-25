const AUDIO_EXTENSIONS = ['.webm', '.ogg', '.oga', '.mp3', '.m4a', '.mp4', '.wav', '.aac'];

const AUDIO_MIMES = new Set([
    'audio/webm',
    'audio/ogg',
    'audio/oga',
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/x-m4a',
    'audio/m4a',
    'audio/aac',
    'audio/wav',
    'audio/x-wav',
    'video/webm'
]);

function ascii(buffer, start, length) {
    return buffer.toString('ascii', start, start + length);
}

function sniffAudioType(buffer) {
    if (!buffer || buffer.length < 12) return null;

    if (ascii(buffer, 4, 4) === 'ftyp') {
        return { mime: 'audio/mp4', extension: '.m4a' };
    }
    if (ascii(buffer, 0, 4) === 'OggS') {
        return { mime: 'audio/ogg', extension: '.ogg' };
    }
    if (buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
        return { mime: 'audio/webm', extension: '.webm' };
    }
    if (ascii(buffer, 0, 4) === 'RIFF' && ascii(buffer, 8, 4) === 'WAVE') {
        return { mime: 'audio/wav', extension: '.wav' };
    }
    if (ascii(buffer, 0, 3) === 'ID3' || (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0)) {
        if (buffer[0] === 0xff && (buffer[1] & 0x06) === 0x02) {
            return { mime: 'audio/aac', extension: '.aac' };
        }
        return { mime: 'audio/mpeg', extension: '.mp3' };
    }
    return null;
}

module.exports = { AUDIO_EXTENSIONS, AUDIO_MIMES, sniffAudioType };
