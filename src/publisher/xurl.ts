import { execFile } from "node:child_process";

export class XurlError extends Error {
  constructor(message: string, public readonly stderr?: string) {
    super(message);
    this.name = "XurlError";
  }
}

export interface PostToXInput {
  text: string;
}

export interface PostToXOutput {
  tweetId: string;
  url: string;
}

export interface PostToXOptions {
  xurlPath: string;
  timeoutMs?: number;
}

export async function postToX(
  input: PostToXInput,
  opts: PostToXOptions,
): Promise<PostToXOutput> {
  const { text } = input;

  if (!text) {
    throw new XurlError("Text must not be empty");
  }
  if (text.length > 280) {
    throw new XurlError("Text exceeds 280 characters");
  }

  const argv = [
    "--auth", "oauth2",
    "-X", "POST",
    "-H", "content-type: application/json",
    "-d", JSON.stringify({ text }),
    "/2/tweets",
  ];

  let stdout: string;
  let stderr: string;

  try {
    ({ stdout, stderr } = await new Promise<{ stdout: string; stderr: string }>(
      (resolve, reject) => {
        execFile(
          opts.xurlPath,
          argv,
          { timeout: opts.timeoutMs ?? 20_000 },
          (err, out, errOut) => {
            if (err) {
              reject(Object.assign(err, { stderr: errOut }));
            } else {
              resolve({ stdout: out, stderr: errOut });
            }
          },
        );
      },
    ));
  } catch (err: any) {
    throw new XurlError(err.message ?? "xurl failed", err.stderr);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new XurlError("Failed to parse xurl output", stderr);
  }

  if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
    const msg = parsed.errors.map((e: any) => e.message).join("; ");
    throw new XurlError(msg, stderr);
  }

  const id: string | undefined = parsed?.data?.id;
  if (!id) {
    throw new XurlError("Missing data.id in xurl response", stderr);
  }

  return {
    tweetId: id,
    url: `https://x.com/i/web/status/${id}`,
  };
}
