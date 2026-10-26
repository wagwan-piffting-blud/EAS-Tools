const BLOCK = 4096;

class SplicerRecCapture extends AudioWorkletProcessor {
    constructor() {
        super();
        this.buf = new Float32Array(BLOCK);
        this.fill = 0;
        this.on = true;
        this.port.onmessage = (e) => {
            if (e.data !== 'stop') return;
            this.flush();
            this.port.postMessage('done');
            this.on = false;
        };
    }

    flush() {
        if (!this.fill) return;
        const out = this.buf.slice(0, this.fill);
        this.port.postMessage(out, [out.buffer]);
        this.fill = 0;
    }

    process(inputs) {
        if (!this.on) return false;
        const input = inputs[0];
        if (!input || !input.length) return true;
        const n = input[0].length;
        const k = 1 / input.length;
        for (let i = 0; i < n; i++) {
            let v = 0;
            for (let ch = 0; ch < input.length; ch++) v += input[ch][i];
            this.buf[this.fill++] = v * k;
            if (this.fill === BLOCK) this.flush();
        }
        return true;
    }
}

registerProcessor('splicer-rec-capture', SplicerRecCapture);
