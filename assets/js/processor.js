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
    constructor() {
        super();
        this._batch = null;
        this._channels = 0;
        this._filled = 0;
    }
    _allocate(channelCount) {
        this._channels = channelCount;
        this._batch = [];
        for (let c = 0; c < channelCount; c++) {
            this._batch.push(new Float32Array(EAS_BATCH_SIZE));
        }
        this._filled = 0;
    }
    process(inputs) {
        const input = inputs[0];
        if (!input || !input.length || !input[0] || !input[0].length) {
            return true;
        }
        const channelCount = input.length;
        const frames = input[0].length;
        if (!this._batch || this._channels !== channelCount) {
            this._allocate(channelCount);
        }
        let offset = 0;
        while (offset < frames) {
            const space = EAS_BATCH_SIZE - this._filled;
            const remaining = frames - offset;
            const count = space < remaining ? space : remaining;
            for (let c = 0; c < channelCount; c++) {
                const src = input[c];
                if (src && src.length >= offset + count) {
                    this._batch[c].set(src.subarray(offset, offset + count), this._filled);
                }
            }
            this._filled += count;
            offset += count;
            if (this._filled === EAS_BATCH_SIZE) {
                const out = this._batch;
                const transfer = [];
                for (let c = 0; c < channelCount; c++) {
                    transfer.push(out[c].buffer);
                }
                this._allocate(channelCount);
                this.port.postMessage(out, transfer);
            }
        }
        return true;
    }
}

registerProcessor("eas-recorder", EASRecorderProcessor);
