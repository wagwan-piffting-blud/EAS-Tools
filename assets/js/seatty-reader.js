let credit = 0;
let wake = null;

function release() {
    if (wake) {
        const resume = wake;
        wake = null;
        resume();
    }
}

self.onmessage = async (event) => {
    const msg = event.data || {};
    if (msg.type === 'ack') {
        credit++;
        release();
        return;
    }
    if (msg.type !== 'read') {
        return;
    }
    try {
        const { file, start, end, slice, depth } = msg;
        credit = msg.window;
        const queue = [];
        let next = start;
        while (next < end || queue.length) {
            while (next < end && credit > 0 && queue.length < depth) {
                queue.push(file.slice(next, Math.min(end, next + slice)).arrayBuffer());
                next += slice;
                credit--;
            }
            if (!queue.length) {
                await new Promise((resolve) => {
                    wake = resolve;
                });
                continue;
            }
            const buffer = await queue.shift();
            self.postMessage({ type: 'chunk', buffer }, [buffer]);
        }
        self.postMessage({ type: 'end' });
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err && err.message ? err.message : err) });
    }
};

self.postMessage({ type: 'ready' });
