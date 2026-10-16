/**
 * Peak absolute sample amplitude in the first `data` chunk of a little-endian
 * PCM16 WAV buffer. Returns `undefined` when the buffer is not a WAV file or
 * has no data chunk, so callers can distinguish "can't parse" from "silent".
 */
export const maxPcm16LeAmplitude = (audio: Buffer): number | undefined => {
  if (audio.length < 44 || audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") return undefined;

  let offset = 12;
  while (offset + 8 <= audio.length) {
    const chunkId = audio.toString("ascii", offset, offset + 4);
    const chunkSize = audio.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = Math.min(dataStart + chunkSize, audio.length);

    if (chunkId === "data") {
      let max = 0;
      for (let index = dataStart; index + 1 < dataEnd; index += 2) {
        const sample = Math.abs(audio.readInt16LE(index));
        if (sample > max) max = sample;
      }
      return max;
    }

    offset = dataStart + chunkSize + (chunkSize % 2);
  }

  return undefined;
};

/**
 * Peak sample amplitudes at or below this value are treated as digital silence
 * rather than quiet audio. Real microphone input (even ambient room noise)
 * peaks far above this, while a virtual or unselected device typically records
 * all zeros.
 */
export const SILENCE_MAX_AMPLITUDE = 3;
