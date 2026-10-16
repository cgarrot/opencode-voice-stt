import { spawn } from "node:child_process";
import { textFrom } from "../utils/coerce";

const readStream = async (stream: NodeJS.ReadableStream | null): Promise<string> => {
  if (!stream) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const readKeychainSecret = async (service: string, account: string): Promise<string> => {
  if (!service || process.platform !== "darwin") return "";

  const child = spawn("/usr/bin/security", [
    "find-generic-password",
    "-w",
    "-s",
    service,
    ...(account ? ["-a", account] : []),
  ], {
    stdio: ["ignore", "pipe", "pipe"],
  });

  const [code, stdout] = await Promise.all([
    new Promise<number | null>((resolve) => child.on("close", resolve)),
    readStream(child.stdout),
    readStream(child.stderr),
  ]);

  return code === 0 ? textFrom(stdout) : "";
};
