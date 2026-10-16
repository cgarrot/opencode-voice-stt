import test from "node:test";
import assert from "node:assert/strict";
import { maxPcm16LeAmplitude, SILENCE_MAX_AMPLITUDE } from "../src/audio/wav";

const wavFromSamples = (samples: number[]): Buffer => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));

  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(16000, 24); // sample rate
  header.writeUInt32LE(32000, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);

  return Buffer.concat([header, data]);
};

test("maxPcm16LeAmplitude returns the peak absolute sample", () => {
  assert.equal(maxPcm16LeAmplitude(wavFromSamples([0, 100, -200, 50, -1])), 200);
});

test("maxPcm16LeAmplitude returns 0 for a silent WAV", () => {
  assert.equal(maxPcm16LeAmplitude(wavFromSamples([0, 0, 0, 0])), 0);
});

test("maxPcm16LeAmplitude returns undefined for a non-WAV buffer", () => {
  assert.equal(maxPcm16LeAmplitude(Buffer.from("not a wave file")), undefined);
});

test("maxPcm16LeAmplitude returns undefined when there is no data chunk", () => {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  assert.equal(maxPcm16LeAmplitude(header), undefined);
});

test("silence threshold separates digital silence from real audio", () => {
  const silent = maxPcm16LeAmplitude(wavFromSamples([0, 0, 0]));
  const speech = maxPcm16LeAmplitude(wavFromSamples([0, 100, 0]));
  assert.ok(silent !== undefined && silent <= SILENCE_MAX_AMPLITUDE);
  assert.ok(speech !== undefined && speech > SILENCE_MAX_AMPLITUDE);
});
