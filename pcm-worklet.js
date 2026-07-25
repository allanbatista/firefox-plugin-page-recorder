// Interleaved linear16 for Deepgram. Buffers ~128ms so we send a few dozen
// WebSocket frames per second instead of 125.
const CHUNK_FRAMES = 2048;

class PcmWorklet extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = null;
    this.offset = 0;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) {
      return true;
    }

    const channels = input.length;
    const frames = input[0].length;
    if (!this.buffer || this.buffer.length !== CHUNK_FRAMES * channels) {
      this.buffer = new Int16Array(CHUNK_FRAMES * channels);
      this.offset = 0;
    }

    for (let frame = 0; frame < frames; frame += 1) {
      for (let channel = 0; channel < channels; channel += 1) {
        const sample = Math.max(-1, Math.min(1, input[channel][frame] || 0));
        this.buffer[this.offset] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
        this.offset += 1;
      }
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer.slice().buffer);
        this.offset = 0;
      }
    }

    return true;
  }
}

registerProcessor("pcm", PcmWorklet);
