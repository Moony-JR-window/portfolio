
import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";

const UPLOADS_DIR = "/tmp/uploads";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    console.log(`[UPLOAD] Request received: id=${id}`);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        {
          success: false,
          error: "No file uploaded. Field name must be 'file'.",
        },
        { status: 400 }
      );
    }

    const dir = path.join(UPLOADS_DIR, id);

    // Vercel writable temporary directory
    await fs.mkdir(dir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());

    // Prevent basic path traversal through the filename
    const safeFileName = path.basename(file.name);
    const filePath = path.join(dir, safeFileName);

    await fs.writeFile(filePath, buffer);

    console.log(`[UPLOAD] Saved: ${filePath}`);
    console.log(`[UPLOAD] Size: ${file.size} bytes`);

    return NextResponse.json({
      success: true,
      id,
      fileName: safeFileName,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      path: filePath,
    });
  } catch (error) {
    console.error("[UPLOAD] Error:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error
          ? error.message
          : "Upload failed",
      },
      { status: 500 }
    );
  }
}
