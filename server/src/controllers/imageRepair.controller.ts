/**
 * TEMPORARY one-time repair endpoint for the HEIC-saved-as-.jpg corruption bug
 * (see localUpload.ts attachPublicUrls). Transcodes a single warranty photo/invoice
 * file in place on disk if — and only if — its bytes are actually HEIC.
 * Delete this controller and its route once all known-corrupted UIDs are repaired.
 */
import { Request, Response } from 'express';
import fs from 'fs';
import sharp from 'sharp';
import convertHeic from 'heic-convert';
import db from '../config/database.js';
import { isHeicBuffer, urlToDiskPath } from '../config/localUpload.js';

const REPAIRABLE_FIELDS = new Set([
    'invoiceFileName',
    'photos.vehicle', 'photos.mrpLabel', 'photos.seatCover', 'photos.lhs', 'photos.rhs',
    'photos.frontReg', 'photos.backReg', 'photos.warranty', 'photos.carOuter',
]);

export class ImageRepairController {
    static async repairOne(req: Request, res: Response) {
        try {
            const { uid, field } = req.body as { uid?: string; field?: string };
            if (!uid || !field || !REPAIRABLE_FIELDS.has(field)) {
                return res.status(400).json({ error: 'uid and a valid field are required' });
            }

            const [rows]: any = await db.execute(
                'SELECT uid, product_details FROM warranty_registrations WHERE uid = ?',
                [uid]
            );
            if (!rows.length) {
                return res.status(404).json({ error: `No warranty found for uid ${uid}` });
            }

            const pd = typeof rows[0].product_details === 'string'
                ? JSON.parse(rows[0].product_details)
                : rows[0].product_details;

            const url = field === 'invoiceFileName'
                ? pd?.invoiceFileName
                : pd?.photos?.[field.split('.')[1]];

            if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
                return res.status(404).json({ error: `No stored URL for uid ${uid} field ${field}` });
            }

            const diskPath = urlToDiskPath(url);
            if (!fs.existsSync(diskPath)) {
                return res.status(404).json({ error: `File not found on disk: ${diskPath}` });
            }

            const before = await fs.promises.readFile(diskPath);
            const wasHeic = isHeicBuffer(before);

            if (!wasHeic) {
                return res.json({
                    success: true,
                    changed: false,
                    message: 'File is not raw HEIC — nothing to repair',
                    url,
                });
            }

            const jpegBuffer = await convertHeic({ buffer: before, format: 'JPEG', quality: 0.8 }) as Buffer;
            await fs.promises.writeFile(diskPath, jpegBuffer);

            // Verify the repaired file actually decodes before declaring success
            const stats = await sharp(diskPath).stats();
            const meta = await sharp(diskPath).metadata();

            res.json({
                success: true,
                changed: true,
                uid,
                field,
                url,
                diskPath,
                beforeSize: before.length,
                afterSize: jpegBuffer.length,
                decodedFormat: meta.format,
                decodedWidth: meta.width,
                decodedHeight: meta.height,
                decodedChannels: stats.channels.length,
            });
        } catch (error: any) {
            console.error('[ImageRepair] Failed:', error);
            res.status(500).json({ error: error.message || 'Repair failed' });
        }
    }
}
