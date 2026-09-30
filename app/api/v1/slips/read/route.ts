import { NextResponse, type NextRequest } from "next/server";
import { ok, route } from "@/lib/api";
import { requireAdult } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import { clientIpHash } from "@/lib/request";
import { IMAGE_TYPES, MAX_UPLOAD_BYTES } from "@/lib/ai/extract-slip";
import { readSlipFile } from "@/lib/services/read-slip";

export const maxDuration = 60;

const ACCEPTED = [...IMAGE_TYPES, "application/pdf"] as const;

/** Reads a slip screenshot or PDF: multipart form with a single `file` field. */
export const POST = route(async (req: NextRequest) => {
  const { user } = await requireAdult(req.headers.get("authorization"));

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new AppError("BAD_REQUEST", "Attach a screenshot or PDF of the slip.");
  if (!(ACCEPTED as readonly string[]).includes(file.type)) {
    throw new AppError("BAD_REQUEST", "Upload a photo (JPEG, PNG, GIF or WebP) or a PDF.");
  }
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError("BAD_REQUEST", "That file is too big. Please upload something under 4 MB.");

  const data = Buffer.from(await file.arrayBuffer()).toString("base64");
  return ok(await readSlipFile({ user, file: { data, mediaType: file.type }, ipHash: clientIpHash(req) }));
});

export function GET() {
  return NextResponse.json({ error: { code: "BAD_REQUEST", message: "POST a file to this endpoint." } }, { status: 405 });
}
