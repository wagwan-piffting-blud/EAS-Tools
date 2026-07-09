const EAS_FRAME_SIZE = 128;
const EAS_BATCH_FRAMES = 16;
const EAS_BATCH_SIZE = EAS_FRAME_SIZE * EAS_BATCH_FRAMES;

class EASProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._batch = new Float32Array(EAS_BATCH_SIZE);
        this._filled = 0;
    }
    process(inputs) {
        const input = inputs[0];
        const channel = input && input[0];
        if (!channel || channel.length === 0) {
            return true;
        }
        let offset = 0;
        const total = channel.length;
        while (offset < total) {
            const space = EAS_BATCH_SIZE - this._filled;
            const remaining = total - offset;
            const count = space < remaining ? space : remaining;
            this._batch.set(channel.subarray(offset, offset + count), this._filled);
            this._filled += count;
            offset += count;
            if (this._filled === EAS_BATCH_SIZE) {
                const chunk = this._batch;
                this._batch = new Float32Array(EAS_BATCH_SIZE);
                this._filled = 0;
                this.port.postMessage(chunk, [chunk.buffer]);
            }
        }
        return true;
    }
}

registerProcessor("eas-processor", EASProcessor);

class EASRecorderProcessor extends AudioWorkletProcessor {
    process(inputs) {
        if (inputs && inputs[0] && inputs[0].length) {
            this.port.postMessage(inputs[0]);
        }
        return !0;
    }
}

registerProcessor("eas-recorder", EASRecorderProcessor);
