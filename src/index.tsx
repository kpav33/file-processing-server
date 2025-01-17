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
    // origin: process.env.FRONTEND_URL,
    origin: "*",
    methods: ["GET", "POST"],
    // credentials: true,
    credentials: false,
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

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ message: "Something broke!" });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
