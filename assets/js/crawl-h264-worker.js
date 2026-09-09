importScripts('h264-mp4-encoder/h264-mp4-encoder.web.js');

var encoder = null;

function fatal(error) {
    postMessage({ type: 'fatal', error: (error && error.message) || String(error) });
}

function init(msg) {
    HME.createH264MP4Encoder().then(function (enc) {
        encoder = enc;
        enc.width = msg.width;
        enc.height = msg.height;
        enc.frameRate = msg.fps;
        enc.kbps = msg.kbps;
        enc.speed = msg.speed;
        enc.groupOfPictures = msg.fps;
        enc.initialize();
        postMessage({ type: 'ready' });
    }).catch(fatal);
}

function addFrame(msg) {
    encoder.addFrameRgba(new Uint8Array(msg.buffer));
    postMessage({ type: 'frameDone', index: msg.index });
}

function finish() {
    encoder.finalize();
    var bytes = encoder.FS.readFile(encoder.outputFilename);
    var out = new Uint8Array(bytes.length);
    out.set(bytes);
    encoder.delete();
    encoder = null;
    postMessage({ type: 'done', buffer: out.buffer }, [out.buffer]);
}

self.onmessage = function (event) {
    var msg = event.data || {};
    try {
        if (msg.type === 'init') {
            init(msg);
        } else if (msg.type === 'frame') {
            addFrame(msg);
        } else if (msg.type === 'finish') {
            finish();
        }
    } catch (error) {
        fatal(error);
    }
};
