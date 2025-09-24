class EASProcessor extends AudioWorkletProcessor {
    process(inputs, outputs, parameters) {
        this.port.postMessage(inputs[0]);
        return !0;
    }
}

registerProcessor("eas-processor", EASProcessor);