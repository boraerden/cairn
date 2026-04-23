import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type PutObjectCommandInput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Storage } from "@google-cloud/storage";
import { env } from "./env.js";

const s3 = new S3Client({ region: env.REGION });
const gcs = new Storage();

export async function getObjectText(key: string): Promise<{ body: string; etag: string } | null> {
  if (env.STORAGE_BACKEND === "gcs") {
    const file = gcs.bucket(env.BUCKET).file(key);
    try {
      const [body] = await file.download();
      const [meta] = await file.getMetadata();
      return { body: body.toString("utf-8"), etag: stripEtag(String(meta.etag ?? meta.generation ?? "")) };
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: env.BUCKET, Key: key }));
    const body = await res.Body!.transformToString("utf-8");
    const etag = stripEtag(res.ETag ?? "");
    return { body, etag };
  } catch (err: unknown) {
    if ((err as { name?: string; $metadata?: { httpStatusCode?: number } }).name === "NoSuchKey") return null;
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function putObjectText(
  key: string,
  body: string,
  options: { contentType?: string; ifMatchEtag?: string | null } = {},
): Promise<{ etag: string }> {
  if (env.STORAGE_BACKEND === "gcs") {
    const file = gcs.bucket(env.BUCKET).file(key);
    await file.save(body, {
      contentType: options.contentType ?? "application/json; charset=utf-8",
      resumable: false,
    });
    const [meta] = await file.getMetadata();
    return { etag: stripEtag(String(meta.etag ?? meta.generation ?? "")) };
  }

  const input: PutObjectCommandInput = {
    Bucket: env.BUCKET,
    Key: key,
    Body: body,
    ContentType: options.contentType ?? "application/json; charset=utf-8",
  };
  // S3 PutObject supports IfMatch only on newer APIs; we implement optimistic locking at the handler layer by re-reading before write.
  const res = await s3.send(new PutObjectCommand(input));
  return { etag: stripEtag(res.ETag ?? "") };
}

export async function listObjectKeys(prefix: string): Promise<string[]> {
  if (env.STORAGE_BACKEND === "gcs") {
    const [files] = await gcs.bucket(env.BUCKET).getFiles({ prefix });
    return files.map((file) => file.name).sort((a, b) => a.localeCompare(b));
  }

  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({
        Bucket: env.BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of res.Contents ?? []) {
      if (item.Key) keys.push(item.Key);
    }
    continuationToken = res.NextContinuationToken;
  } while (continuationToken);

  return keys.sort((a, b) => a.localeCompare(b));
}

export async function deleteObject(key: string): Promise<void> {
  if (env.STORAGE_BACKEND === "gcs") {
    const file = gcs.bucket(env.BUCKET).file(key);
    try {
      await file.delete();
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
    return;
  }

  await s3.send(new DeleteObjectCommand({ Bucket: env.BUCKET, Key: key }));
}

export async function presignPut(key: string, contentType: string, ttlSeconds: number): Promise<string> {
  if (env.STORAGE_BACKEND === "gcs") {
    const [url] = await gcs.bucket(env.BUCKET).file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + ttlSeconds * 1000,
      contentType,
    });
    return url;
  }

  const cmd = new PutObjectCommand({ Bucket: env.BUCKET, Key: key, ContentType: contentType });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
}

export async function presignGet(key: string, ttlSeconds: number): Promise<string> {
  if (env.STORAGE_BACKEND === "gcs") {
    const [url] = await gcs.bucket(env.BUCKET).file(key).getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttlSeconds * 1000,
    });
    return url;
  }

  const cmd = new GetObjectCommand({ Bucket: env.BUCKET, Key: key });
  return getSignedUrl(s3, cmd, { expiresIn: ttlSeconds });
}

function stripEtag(value: string): string {
  return value.replace(/"/g, "");
}
