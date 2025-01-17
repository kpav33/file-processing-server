import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import { createGzip, createGunzip } from "zlib";
import { Readable } from "stream";
import crypto from "crypto";
import asyncHandler from "express-async-handler";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const upload = multer({ limits: { fileSize: 100 * 1024 * 1024 } });

// Constants for security bytes
const PREFIX_BYTES = 32;
const SUFFIX_BYTES = 48;

// Type for file upload request
interface FileRequest extends Request {
  file?: Express.Multer.File;
}

app.use(
  cors({
    origin: process.env.FRONTEND_URL,
    methods: ["GET", "POST"],
    credentials: true,
  })
);

// Upload endpoint
app.post(
  "/api/upload-axios",
  upload.single("file"),
  asyncHandler(async (req: FileRequest, res: Response) => {
    if (!req.file) {
      res.status(400).json({ message: "No file uploaded" });
      return;
    }

    try {
      // Create readable stream from file buffer
      const readable = Readable.from(req.file.buffer);
      const chunks: Buffer[] = [];
      const gzip = createGzip();

      // Pipe through compression
      readable
        .pipe(gzip)
        .on("data", (chunk) => chunks.push(Buffer.from(chunk)));

      // Wait for compression to complete
      await new Promise<void>((resolve, reject) => {
        gzip.on("end", () => resolve());
        gzip.on("error", reject);
      });

      // Combine compressed chunks
      const compressedContent = Buffer.concat(chunks);

      // Generate and add security bytes
      const prefixBytes = crypto.randomBytes(PREFIX_BYTES);
      const suffixBytes = crypto.randomBytes(SUFFIX_BYTES);

      // Create final buffer with security bytes
      const finalBuffer = Buffer.concat([
        prefixBytes,
        compressedContent,
        suffixBytes,
      ]);

      // Store in database
      const storedFile = await prisma.file.create({
        data: {
          name: req.file.originalname,
          data: finalBuffer,
          mimeType: req.file.mimetype,
        },
      });

      res.json({
        message: "File uploaded and compressed successfully",
        filename: req.file.originalname,
        fileId: storedFile.id,
      });
    } catch (error) {
      console.error("Error processing file:", error);
      res.status(500).json({
        message: `Error processing file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  })
);

// Decompress endpoint
app.get(
  "/api/decompress",
  asyncHandler(async (req: Request, res: Response) => {
    const filename = req.query.filename as string;

    if (!filename) {
      res.status(400).json({ message: "No filename provided" });
      return;
    }

    try {
      const file = await prisma.file.findFirst({
        where: { name: filename },
      });

      if (!file) {
        res.status(404).json({ message: "File not found" });
        return;
      }

      const securedContent = Buffer.from(file.data);
      const compressedContent = securedContent.subarray(
        PREFIX_BYTES,
        securedContent.length - SUFFIX_BYTES
      );

      const decompressedChunks: Buffer[] = [];
      const decompressor = createGunzip();

      decompressor.on("data", (chunk) => {
        decompressedChunks.push(Buffer.from(chunk));
      });

      await new Promise<void>((resolve, reject) => {
        decompressor.on("end", () => resolve());
        decompressor.on("error", reject);
        decompressor.end(compressedContent);
      });

      const decompressedContent = Buffer.concat(decompressedChunks);

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
      res.setHeader("Content-Length", decompressedContent.length.toString());
      res.send(decompressedContent);
    } catch (error) {
      console.error("Error decompressing file:", error);
      res.status(500).json({
        message: `Error decompressing file: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }
  })
);

// Get file list endpoint
app.get(
  "/api/files",
  asyncHandler(async (_req: Request, res: Response) => {
    try {
      const files = await prisma.file.findMany({
        select: {
          id: true,
          name: true,
          mimeType: true,
          createdAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });
      res.json(files);
    } catch (error) {
      console.error("Error fetching files:", error);
      res.status(500).json({ message: "Error fetching files" });
    }
  })
);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something broke!" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
