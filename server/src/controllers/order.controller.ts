import { Request, Response } from 'express';
import fs from 'fs';
import db from '../config/database.js';
import { v4 as uuidv4 } from 'uuid';
import { signActionToken, verifyActionToken } from '../utils/actionToken.js';
import PDFDocument from 'pdfkit';
import path from 'path';
import { transporter } from '../config/email.js';
import { formatDateIST, formatDateTimeIST } from '../utils/dateUtils.js';
import { ActivityLogService } from '../services/activity-log.service.js';
import { WhatsAppService } from '../services/whatsapp.service.js';
import dotenv from 'dotenv';

dotenv.config();

/**
 * B2B Order Controller
 * Handles franchise-to-distributor order lifecycle:
 *   1. Franchise places order (status: pending, NO stock change)
 *   2. Distributor confirms (status: processing, stock DEDUCTED)
 *   3. Fulfillment flow (shipped -> delivered)
 *   4. Cancellation (stock RESTORED if was confirmed)
 */
export class OrderController {

    // ─── Helper: Get API base URL ──────────────────────────────
    private static getApiUrl(): string {
        if (process.env.API_URL) return process.env.API_URL.replace(/\/$/, '');
        const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
        if (isProduction) return 'https://api.autoformindia.co.in';
        return `http://localhost:${process.env.PORT || 3000}`;
    }

    private static getISTDateCode(date: Date = new Date()): string {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(date);

        const getPart = (type: string) => parts.find((part) => part.type === type)?.value || '';
        return `${getPart('year')}${getPart('month')}${getPart('day')}`;
    }

 private static async generateOrderId(connection: any): Promise<string> {
    const dateCode = OrderController.getISTDateCode();

    // IDs are AFI<yyyymmdd><7-digit seq>, so lexicographic order matches
    // creation order — ORDER BY id uses the primary key index directly
    // instead of filesorting every AFI row by created_at.
    // FOR UPDATE: a second order placed at the same moment waits for this one
    // to commit, instead of reading the same latest id and failing on a duplicate.
    const [rows]: any = await connection.execute(
        `SELECT id
         FROM store_orders
         WHERE id LIKE 'AFI%'
         ORDER BY id DESC
         LIMIT 1
         FOR UPDATE`
    );

    let nextSequence = 1;

    if (rows.length > 0) {
        const latestId = String(rows[0].id || '');

        // Last 7 digits are the sequence
        const parsedSequence = Number.parseInt(
            latestId.slice(-7),
            10
        );

        if (!Number.isNaN(parsedSequence)) {
            nextSequence = parsedSequence + 1;
        }
    }

    return `AFI${dateCode}${String(nextSequence).padStart(7, '0')}`;
}

    // ─── Helper: Attach items to a list of orders in one query ───
    // Replaces the per-order items lookup (N+1) with a single
    // WHERE order_id IN (...) fetch grouped in memory.
    private static async attachOrderItems(orders: any[]): Promise<void> {
        if (orders.length === 0) return;

        const orderIds = orders.map((o: any) => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [allItems]: any = await db.execute(
            `SELECT * FROM store_order_items WHERE order_id IN (${placeholders})`,
            orderIds
        );

        const itemsByOrder = new Map<string, any[]>();
        for (const item of allItems) {
            const list = itemsByOrder.get(item.order_id);
            if (list) list.push(item);
            else itemsByOrder.set(item.order_id, [item]);
        }

        for (const order of orders) {
            order.items = itemsByOrder.get(order.id) || [];
        }
    }

    // ─── Helper: Deduct stock for a confirmed order's items ──────
    // Locks each distributor_inventory row (SELECT ... FOR UPDATE) before
    // checking availability, so two concurrent confirmations can't both
    // succeed against the same insufficient stock. Throws on shortage so
    // the caller's transaction is rolled back.
    private static async deductStockForOrderItems(connection: any, distributorId: string, items: any[]): Promise<void> {
        for (const item of items) {
            if (!item.product_id) continue;

            const [stockRows]: any = await connection.execute(
                `SELECT id, stock_quantity FROM distributor_inventory
                 WHERE distributor_id = ? AND product_id = ? AND variation_id <=> ?
                 FOR UPDATE`,
                [distributorId, item.product_id, item.variation_id]
            );

            const available = stockRows.length > 0 ? Number(stockRows[0].stock_quantity) : 0;
            if (available < item.quantity) {
                throw new Error(`Insufficient stock for "${item.product_name}". Available: ${available}, required: ${item.quantity}.`);
            }

            await connection.execute(
                'UPDATE distributor_inventory SET stock_quantity = stock_quantity - ? WHERE id = ?',
                [item.quantity, stockRows[0].id]
            );
        }
    }

    // ─── Helper: Restore stock for a declined order's items ──────
    private static async restoreStockForOrderItems(connection: any, distributorId: string, items: any[]): Promise<void> {
        for (const item of items) {
            if (!item.product_id) continue;

            await connection.execute(
                `UPDATE distributor_inventory
                 SET stock_quantity = stock_quantity + ?
                 WHERE distributor_id = ? AND product_id = ? AND variation_id <=> ?`,
                [item.quantity, distributorId, item.product_id, item.variation_id]
            );
        }
    }

    private static escapeHtml(value: unknown): string {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    private static formatHtmlLines(value: unknown): string {
        return OrderController.escapeHtml(value).replace(/\r?\n/g, '<br>');
    }

    private static renderOrderItemsEmailRows(items: any[]): string {
        return items.map((item, index) => {
            const customizationRemarks = String(item.customization_remarks || '').trim();
            const customizationBlock = item.needs_customization
                ? `
                    <div style="margin-top: 8px; padding: 10px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 6px;">
                        <div style="font-size: 12px; font-weight: 700; color: #1d4ed8;">Customization Details</div>
                        <div style="font-size: 12px; color: #334155; margin-top: 4px;">${customizationRemarks ? OrderController.formatHtmlLines(customizationRemarks) : 'Requested, no details provided.'}</div>
                    </div>
                `
                : '';

            return `
                <tr>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; color: #64748b;">${index + 1}</td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                        <div style="font-weight: 700; color: #111827;">${OrderController.escapeHtml(item.product_name || 'Unknown Product')}</div>
                        <div style="font-size: 12px; color: #64748b; margin-top: 2px;">${OrderController.escapeHtml(item.variation_name || 'Default')}</div>
                        ${customizationBlock}
                    </td>
                    <td style="padding: 12px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 700; color: #111827;">${Number(item.quantity || 0)}</td>
                </tr>
            `;
        }).join('');
    }

    private static renderPlainTextLines(value: unknown): string {
        return OrderController.escapeHtml(value).replace(/\r?\n/g, '<br>');
    }

    private static async markOrderDeclined(
        connection: any,
        orderId: string,
        declinedByRole: 'vendor' | 'distributor' | 'admin',
        declineReason: string
    ) {
        await connection.execute(
            `UPDATE store_orders 
             SET status = 'cancelled',
                 declined_by_role = ?,
                 decline_reason = ?,
                 declined_at = NOW()
             WHERE id = ?`,
            [declinedByRole, declineReason, orderId]
        );
    }

    // ─── Helper: Read width/height from a PNG's IHDR chunk without decoding pixels ──
    private static readPngDimensions(filePath: string): { width: number; height: number } {
        const buffer = fs.readFileSync(filePath);
        return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }

    // ─── Helper: Generate Order PDF as Buffer ──────────────────
    private static async generateOrderPDF(order: any, items: any[], franchise: any, distributor: any): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            // bufferPages lets us stamp "Page X of Y" after the total page count is known.
            const doc = new PDFDocument({ size: 'A4', margin: 50, bufferPages: true });
            const chunks: Buffer[] = [];

            doc.on('data', (chunk: Buffer) => chunks.push(chunk));
            doc.on('end', () => resolve(Buffer.concat(chunks)));
            doc.on('error', reject);

            const createdAt = order.created_at ? new Date(order.created_at) : new Date();
            const totalQuantity = items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
            const pageWidth = 545;
            const leftX = 50;
            const rightX = 295;
            const orderRemarks = String(order.additional_remarks || order.additionalRemarks || '').trim();

            // House brand logos, in fixed display order.
            const brandLogoFiles = [
                'autoform-logo.png',
                'brand-logos/autocruze-logo.png',
                'brand-logos/emporio-logo.png',
                'brand-logos/azuro-logo.png',
                'brand-logos/cadence-logo.png',
                'brand-logos/dr-marcus-logo.png',
            ];

            const scaleToBox = (file: string, maxWidth: number, maxHeight: number) => {
                const p = path.resolve(process.cwd(), 'uploads', file);
                if (!fs.existsSync(p)) return null;
                const { width, height } = OrderController.readPngDimensions(p);
                const scale = Math.min(maxWidth / width, maxHeight / height);
                return { path: p, width: width * scale, height: height * scale };
            };

            // Wrap logos into rows that each fit within the printable width.
            const printableWidth = pageWidth - leftX;
            const wrapIntoRows = <T extends { width: number }>(logos: T[], gap: number): T[][] => {
                const rows: T[][] = [];
                let row: T[] = [];
                let rowWidth = 0;
                for (const logo of logos) {
                    const addedWidth = (row.length > 0 ? gap : 0) + logo.width;
                    if (row.length > 0 && rowWidth + addedWidth > printableWidth) {
                        rows.push(row);
                        row = [];
                        rowWidth = 0;
                    }
                    row.push(logo);
                    rowWidth += (row.length > 1 ? gap : 0) + logo.width;
                }
                if (row.length > 0) rows.push(row);
                return rows;
            };

            const drawLogoRows = <T extends { path: string; width: number; height: number }>(
                rows: T[][], startY: number, gap: number, rowGap: number
            ): number => {
                let y = startY;
                for (const row of rows) {
                    const rowWidth = row.reduce((sum, l) => sum + l.width, 0) + gap * (row.length - 1);
                    let x = leftX + (printableWidth - rowWidth) / 2;
                    const rowMaxHeight = Math.max(...row.map((l) => l.height));
                    for (const logo of row) {
                        doc.image(logo.path, x, y + (rowMaxHeight - logo.height) / 2, { width: logo.width, height: logo.height });
                        x += logo.width + gap;
                    }
                    y += rowMaxHeight + rowGap;
                }
                return y - startY;
            };

            const yellow = '#F5C518';
            const navy = '#2C3E50';
            const tableHeaderColor = '#34404F';

            // Small helper: section label in navy with a short yellow underline accent.
            const sectionLabel = (label: string, x: number, y: number) => {
                doc.font('Helvetica-Bold').fontSize(9).fillColor(navy).text(label, x, y, { characterSpacing: 0.6 });
                const w = doc.widthOfString(label, { characterSpacing: 0.6 });
                doc.rect(x, y + 13, Math.min(w, 60), 2).fill(yellow);
            };

            // ─── Header: supplying distributor (left) + title (right) ────────────────
            // Drawn on every page (see pageAdded hook below) so each sheet carries the
            // distributor letterhead and the order reference.
            // The address block is variable height — a long street address wraps to
            // two lines and pushes the email down. Measure it and place the divider
            // below, rather than at a fixed y that clipped the last line.
            const addressTopY = 50;
            const addressLines = [
                distributor.address,
                [distributor.city, distributor.state].filter(Boolean).join(', '),
                distributor.pincode ? `Pin: ${distributor.pincode}` : '',
                distributor.phone_number ? `Phone: ${distributor.phone_number}` : '',
                distributor.email || '',
            ].filter(Boolean);
            const addressText = addressLines.join('\n');

            doc.font('Helvetica').fontSize(8);
            const addressHeight = doc.heightOfString(addressText, { width: 260 });
            // Keep the old spacing when the block is short, so existing invoices are
            // unchanged; grow only when the content actually needs it.
            const dividerY = Math.max(100, addressTopY + addressHeight + 8);
            const headerBottomY = dividerY + 18;

            const drawPageHeader = () => {
                doc.font('Helvetica-Bold').fontSize(15).fillColor(navy)
                    .text(distributor.name || 'Distributor Partner', leftX, 30, { width: 260 });
                doc.font('Helvetica').fontSize(8).fillColor('#64748B')
                    .text(addressText, leftX, addressTopY, { width: 260 });

                doc.font('Helvetica-Bold').fontSize(22).fillColor(navy)
                    .text('PURCHASE ORDER', 0, 34, { width: pageWidth, align: 'right' });
                doc.font('Helvetica-Bold').fontSize(9).fillColor('#64748B')
                    .text(`#${order.id}`, 0, 62, { width: pageWidth, align: 'right', characterSpacing: 0.6 });

                doc.rect(leftX, dividerY, pageWidth - leftX, 3).fill(navy);
            };

            // ─── Footer: divider + brand logo strip (drawn on every page) ────────────
            const footerLogoMaxHeight = 36;
            const footerLogoMaxWidth = 74;
            const footerLogoGap = 7;
            const footerLogoRowGap = 6;
            const footerDividerY = 736;
            const footerLogoRowTop = 748;
            // Rows must stop before the footer zone.
            const contentBottomLimit = footerDividerY - 14;

            const footerLogos = brandLogoFiles
                .map((file) => scaleToBox(file, footerLogoMaxWidth, footerLogoMaxHeight))
                .filter((l): l is NonNullable<typeof l> => l !== null);
            const footerLogoRows = wrapIntoRows(footerLogos, footerLogoGap);

            const drawPageFooter = () => {
                doc.moveTo(leftX, footerDividerY).lineTo(pageWidth, footerDividerY).stroke('#E5E7EB');
                drawLogoRows(footerLogoRows, footerLogoRowTop, footerLogoGap, footerLogoRowGap);
            };

            // Every new page gets the same header + footer chrome.
            doc.on('pageAdded', () => {
                drawPageHeader();
                drawPageFooter();
                doc.x = leftX;
                doc.y = headerBottomY;
            });

            // First page: pageAdded doesn't fire for it, so draw manually.
            drawPageHeader();
            drawPageFooter();
            doc.y = headerBottomY;

            // ─── Order meta row: Date (left) / Status (right) ────────────────────────
            const metaTop = doc.y;
            doc.font('Helvetica-Bold').fontSize(9).fillColor('#94A3B8').text('ORDER DATE', leftX, metaTop);
            doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text(formatDateTimeIST(createdAt), leftX, metaTop + 13);

            doc.font('Helvetica-Bold').fontSize(9).fillColor('#94A3B8').text('STATUS', 0, metaTop, { width: pageWidth, align: 'right' });
            doc.font('Helvetica-Bold').fontSize(11).fillColor(navy).text(String(order.status || 'pending').toUpperCase(), 0, metaTop + 13, { width: pageWidth, align: 'right' });

            doc.y = metaTop + 44;

            // ─── FROM / TO ─────────────────────────────────────────────────────────
            const partyTop = doc.y;
            // Left: who placed the order (franchise store + contact person).
            sectionLabel('ORDER FROM', leftX, partyTop);
            doc.font('Helvetica-Bold').fontSize(11).fillColor(navy)
                .text(franchise.store_name || 'Franchise Partner', leftX, partyTop + 22, { width: 230 });
            doc.font('Helvetica').fontSize(9).fillColor('#475569')
                .text(franchise.contact_name || '', leftX, partyTop + 38, { width: 230 })
                .text(`Phone: ${franchise.phone_number || '-'}`, leftX, undefined, { width: 230 });

            // Right: where the goods go (franchise address).
            sectionLabel('DELIVER TO', rightX, partyTop);
            doc.font('Helvetica-Bold').fontSize(11).fillColor(navy)
                .text(franchise.store_name || 'Franchise Partner', rightX, partyTop + 22, { width: 250 });
            doc.font('Helvetica').fontSize(9).fillColor('#475569')
                .text(franchise.address || '', rightX, partyTop + 38, { width: 250 })
                .text([franchise.city, franchise.state].filter(Boolean).join(', '), rightX, undefined, { width: 250 })
                .text(`Pin: ${franchise.pincode || '-'}`, rightX, undefined, { width: 250 });

            doc.y = partyTop + 108;

            const shipTop = doc.y;
            sectionLabel('SHIP TO', leftX, shipTop);
            doc.font('Helvetica').fontSize(9).fillColor('#475569')
                .text(`${order.shipping_address || ''}, ${order.shipping_city || ''}, ${order.shipping_state || ''} - ${order.shipping_pincode || ''}`, leftX, shipTop + 21, {
                    width: pageWidth - leftX
                });

            doc.y = shipTop + 52;

            // ─── Item table: dark header band, zebra rows ─────────────────────────────
            const tableTop = doc.y;
            const tableColumns = [
                { label: '#', width: 26, align: 'left' as const },
                { label: 'PRODUCT', width: 255, align: 'left' as const },
                { label: 'VARIATION', width: 150, align: 'left' as const },
                { label: 'QTY', width: 40, align: 'right' as const },
            ];
            const tableHeaderHeight = 24;

            // Right-aligned columns get extra right padding so they don't sit flush against the table edge.
            const cellPadding = 8;
            const drawTableHeader = (y: number) => {
                doc.rect(leftX, y, pageWidth - leftX, tableHeaderHeight).fill(tableHeaderColor);
                doc.font('Helvetica-Bold').fontSize(8).fillColor('#FFFFFF');
                let x = leftX;
                tableColumns.forEach((column) => {
                    const rightPad = column.align === 'right' ? cellPadding : 0;
                    doc.text(column.label, x + cellPadding, y + 8, { width: column.width - cellPadding - rightPad, align: column.align, characterSpacing: 0.4 });
                    x += column.width + 8;
                });
            };

            drawTableHeader(tableTop);
            let rowY = tableTop + tableHeaderHeight;
            doc.font('Helvetica').fontSize(9).fillColor('#374151');

            items.forEach((item: any, index: number) => {
                const itemQuantity = Number(item.quantity || 0);

                const itemNotes: string[] = [];
                if (item.needs_customization) {
                    itemNotes.push('Customization requested');
                    if (item.customization_remarks) {
                        itemNotes.push(`Customization Details: ${String(item.customization_remarks)}`);
                    }
                }
                const noteText = itemNotes.join(' | ');
                const noteHeight = noteText
                    ? doc.heightOfString(noteText, { width: pageWidth - leftX - 34, align: 'left' }) + 6
                    : 0;
                const rowHeight = 22 + noteHeight;

                // Break BEFORE drawing if this row (including its notes) would run into
                // the footer zone — checked with the real height, not a fixed guess.
                if (rowY + rowHeight > contentBottomLimit) {
                    doc.addPage();
                    rowY = headerBottomY;
                    drawTableHeader(rowY);
                    rowY += tableHeaderHeight;
                }

                if (index % 2 === 1) {
                    doc.rect(leftX, rowY, pageWidth - leftX, rowHeight).fill('#F8FAFC');
                }

                let currentX = leftX;
                const values = [
                    String(index + 1),
                    item.product_name || 'Unknown Product',
                    item.variation_name || 'Default',
                    String(itemQuantity),
                ];
                doc.font('Helvetica').fontSize(9).fillColor('#374151');
                values.forEach((value, columnIndex) => {
                    const col = tableColumns[columnIndex];
                    const rightPad = col.align === 'right' ? cellPadding : 0;
                    doc.text(value, currentX + cellPadding, rowY + 7, {
                        width: col.width - cellPadding - rightPad,
                        align: col.align
                    });
                    currentX += col.width + 8;
                });

                if (noteText) {
                    doc.font('Helvetica-Oblique').fontSize(8).fillColor('#6B7280')
                        .text(noteText, leftX + 34, rowY + 22, {
                            width: pageWidth - leftX - 34,
                            align: 'left'
                        });
                }

                rowY += rowHeight;
            });

            doc.moveTo(leftX, rowY).lineTo(pageWidth, rowY).lineWidth(1).stroke('#E2E8F0');
            rowY += 14;

            if (orderRemarks) {
                const remarksBoxHeight = Math.max(40, doc.heightOfString(orderRemarks, {
                    width: pageWidth - 26,
                    align: 'left'
                }) + 22);
                if (rowY + remarksBoxHeight > contentBottomLimit) {
                    doc.addPage();
                    rowY = headerBottomY;
                }

                doc.roundedRect(leftX, rowY, pageWidth - leftX, remarksBoxHeight, 4).fillAndStroke('#FEFCE8', '#FDE68A');
                doc.font('Helvetica-Bold').fontSize(9).fillColor(navy).text('ADDITIONAL INFO / REMARKS', leftX + 14, rowY + 11);
                doc.font('Helvetica').fontSize(9).fillColor('#475569').text(orderRemarks, leftX + 14, rowY + 26, {
                    width: pageWidth - 28
                });
                rowY += remarksBoxHeight + 14;
            }

            // ─── Total bar: yellow highlight with dark text (mirrors reference) ──────
            const totalBarHeight = 34;
            if (rowY + totalBarHeight > contentBottomLimit) {
                doc.addPage();
                rowY = headerBottomY;
            }
            // Left portion navy label, right portion yellow value block.
            const totalValueBlockWidth = 170;
            doc.rect(leftX, rowY, pageWidth - leftX - totalValueBlockWidth, totalBarHeight).fill(navy);
            doc.rect(pageWidth - totalValueBlockWidth, rowY, totalValueBlockWidth, totalBarHeight).fill(yellow);
            doc.font('Helvetica-Bold').fontSize(11).fillColor('#FFFFFF')
                .text('TOTAL QUANTITY', leftX + 16, rowY + 12, { width: 200, align: 'left' });
            doc.font('Helvetica-Bold').fontSize(13).fillColor(navy)
                .text(`${totalQuantity} UNITS`, pageWidth - totalValueBlockWidth, rowY + 11, { width: totalValueBlockWidth - 16, align: 'right' });

            // ─── Page numbers: stamp "Page X of Y" once the total is known ───────────
            const pageRange = doc.bufferedPageRange();
            for (let i = 0; i < pageRange.count; i++) {
                doc.switchToPage(pageRange.start + i);
                doc.font('Helvetica').fontSize(8).fillColor('#94A3B8')
                    .text(`Page ${i + 1} of ${pageRange.count}`, leftX, footerDividerY + 4, {
                        width: pageWidth - leftX,
                        align: 'right'
                    });
            }
            doc.flushPages();

            doc.end();
        });
    }

    static async createOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        // Released early once the order is committed so the pooled connection is
        // not held for the duration of the background notification work.
        let orderConnectionReleased = false;
        try {
            const user = (req as any).user;
            const { items, shippingAddress, shippingCity, shippingState, shippingPincode, additionalRemarks } = req.body;

            if (!items || !Array.isArray(items) || items.length === 0) {
                return res.status(400).json({ error: 'Order must contain at least one item' });
            }
            if (!shippingAddress || !shippingCity || !shippingState || !shippingPincode) {
                return res.status(400).json({ error: 'Shipping details are required' });
            }

            await connection.beginTransaction();

            // 1. Fetch vendor (franchise) details
            const [vendorRows]: any = await connection.execute(
                `SELECT vd.id, vd.store_name, vd.address, vd.city, vd.state, vd.pincode,
                        p.name as contact_name, p.phone_number, p.email as contact_email
                 FROM vendor_details vd
                 JOIN profiles p ON vd.user_id = p.id
                 WHERE vd.user_id = ?`,
                [user.id]
            );

            if (vendorRows.length === 0) {
                await connection.rollback();
                return res.status(400).json({ error: 'Vendor profile not found' });
            }
            const vendor = vendorRows[0];

            // 2. Resolve each item's product -> category -> assigned distributor for this franchise
            const groupsByDistributor = new Map<string, { distributor: any; items: any[] }>();

            for (const item of items) {
                const quantity = Number(item?.quantity);
                if (!item?.productId || !Number.isInteger(quantity) || quantity < 1 || quantity > 100000) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'Each item needs a product and a whole quantity of 1 or more' });
                }
                item.quantity = quantity;

                const [prodRows]: any = await connection.execute(
                    'SELECT name, price, category_id, brand FROM store_products WHERE id = ?', [item.productId]
                );

                if (prodRows.length === 0) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'One or more products are no longer available.' });
                }

                // Resolve a distributor assigned to this franchise that is allowed to
                // sell this product's category AND brand.
                //
                // When the client pins the distributor the item was browsed from we
                // honour it. Several of a franchise's distributors can stock the same
                // category, and picking "the first match" routed orders to a
                // distributor the franchise never chose — which then failed on stock
                // it was never expected to hold.
                //
                // Per-mapping limits (franchise_distributor_categories) narrow what
                // THIS franchise may buy from THIS distributor. No rows for a pair
                // means "inherit everything the distributor sells", so existing
                // mappings are unaffected.
                const pinnedDistributorId = typeof item.distributorId === 'string' && item.distributorId
                    ? item.distributorId
                    : null;

                const [routeRows]: any = await connection.execute(
                    `SELECT d.* FROM franchise_distributors fd
                     JOIN distributor_allowed_categories dac ON dac.distributor_id = fd.distributor_id
                     JOIN distributors d ON d.id = fd.distributor_id
                     WHERE fd.franchise_user_id = ? AND dac.category_id = ?
                       AND (d.allowed_brands = 'AFAC' OR d.allowed_brands = ?)
                       AND (
                         fd.category_scope = 'all'
                         OR EXISTS (
                           SELECT 1 FROM franchise_distributor_categories fdc
                           WHERE fdc.franchise_user_id = fd.franchise_user_id
                             AND fdc.distributor_id = fd.distributor_id
                             AND fdc.category_id = dac.category_id
                         )
                       )
                       ${pinnedDistributorId ? 'AND fd.distributor_id = ?' : ''}
                     LIMIT 1`,
                    pinnedDistributorId
                        ? [user.id, prodRows[0].category_id, prodRows[0].brand, pinnedDistributorId]
                        : [user.id, prodRows[0].category_id, prodRows[0].brand]
                );

                if (routeRows.length === 0) {
                    await connection.rollback();
                    // A pinned distributor that no longer qualifies means the client's
                    // catalogue is stale (mapping or category limit changed since).
                    return res.status(400).json({
                        error: pinnedDistributorId
                            ? `"${prodRows[0].name}" is no longer available from the selected distributor. Refresh the catalogue and try again.`
                            : `No distributor available for "${prodRows[0].name}". Contact your admin.`
                    });
                }
                const distributor = routeRows[0];

                const hasVariation = item.variationId !== undefined && item.variationId !== null && item.variationId !== '';
                let variationName: string | null = null;
                let price = Number(prodRows[0]?.price || 0);

                if (hasVariation) {
                    const [varRows]: any = await connection.execute(
                        'SELECT name, price FROM store_product_variations WHERE id = ? AND product_id = ?',
                        [item.variationId, item.productId]
                    );

                    if (varRows.length === 0) {
                        await connection.rollback();
                        return res.status(400).json({ error: 'One or more product variations are no longer available.' });
                    }

                    variationName = varRows[0]?.name || null;
                    price = Number(varRows[0]?.price || price);
                }

                const orderItem = {
                    id: uuidv4(),
                    product_id: item.productId,
                    variation_id: hasVariation ? item.variationId : null,
                    product_name: prodRows[0].name,
                    variation_name: variationName,
                    quantity: item.quantity,
                    price: price,
                    needs_customization: item.needsCustomization || false,
                    customization_remarks: item.customizationRemarks || null
                };

                if (!groupsByDistributor.has(distributor.id)) {
                    groupsByDistributor.set(distributor.id, { distributor, items: [] });
                }
                groupsByDistributor.get(distributor.id)!.items.push(orderItem);
            }

            // 2b. Validate requested quantities against current distributor stock.
            // Aggregate per (distributor, product, variation) in case the cart has
            // duplicate lines, then check each against distributor_inventory.
            const requestedQty = new Map<string, number>();
            for (const { distributor, items: groupItems } of groupsByDistributor.values()) {
                for (const oi of groupItems) {
                    const key = `${distributor.id}::${oi.product_id}::${oi.variation_id ?? ''}`;
                    requestedQty.set(key, (requestedQty.get(key) || 0) + oi.quantity);
                }
            }

            for (const { distributor, items: groupItems } of groupsByDistributor.values()) {
                const seen = new Set<string>();
                for (const oi of groupItems) {
                    const key = `${distributor.id}::${oi.product_id}::${oi.variation_id ?? ''}`;
                    if (seen.has(key)) continue;
                    seen.add(key);

                    const [stockRows]: any = await connection.execute(
                        `SELECT stock_quantity FROM distributor_inventory
                         WHERE distributor_id = ? AND product_id = ? AND variation_id <=> ?`,
                        [distributor.id, oi.product_id, oi.variation_id]
                    );
                    const available = stockRows.length > 0 ? Number(stockRows[0].stock_quantity) : 0;
                    const requested = requestedQty.get(key) || 0;

                    if (requested > available) {
                        await connection.rollback();
                        const label = oi.variation_name ? `${oi.product_name} (${oi.variation_name})` : oi.product_name;
                        return res.status(400).json({
                            error: `Insufficient stock for "${label}" at ${distributor.name}. Available: ${available}, requested: ${requested}.`
                        });
                    }
                }
            }

            // 3. Create one sub-order per distributor, all sharing the same order_group_id
            const orderGroupId = uuidv4();
            const createdOrders: { orderId: string; distributor: any; orderItems: any[]; totalAmount: number }[] = [];

            for (const { distributor, items: groupItems } of groupsByDistributor.values()) {
                const orderId = await OrderController.generateOrderId(connection);
                const totalAmount = groupItems.reduce((s, i) => s + i.price * i.quantity, 0);

                // Orders auto-confirm at placement — stock is live and was already
                // validated above, so there's no manual distributor approval step.
                // deductStockForOrderItems re-locks/re-checks rows for safety against
                // any concurrent order placed between the validation pass and here.
                await connection.execute(
                    `INSERT INTO store_orders
                     (id, order_group_id, vendor_id, distributor_id, total_amount, status, shipping_address, shipping_city, shipping_state, shipping_pincode, additional_remarks)
                     VALUES (?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`,
                    [orderId, orderGroupId, user.id, distributor.id, totalAmount,
                     shippingAddress, shippingCity, shippingState, shippingPincode, typeof additionalRemarks === 'string' ? additionalRemarks.trim() : null]
                );

                for (const oi of groupItems) {
                    await connection.execute(
                        `INSERT INTO store_order_items
                         (id, order_id, product_id, variation_id, product_name, variation_name, quantity, price, needs_customization, customization_remarks)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [oi.id, orderId, oi.product_id, oi.variation_id, oi.product_name, oi.variation_name, oi.quantity, oi.price, oi.needs_customization, oi.customization_remarks]
                    );
                }

                try {
                    await OrderController.deductStockForOrderItems(connection, distributor.id, groupItems);
                } catch (stockError: any) {
                    await connection.rollback();
                    return res.status(409).json({ error: stockError.message });
                }

                createdOrders.push({ orderId, distributor, orderItems: groupItems, totalAmount });
            }

            await connection.commit();
            // The order is durable from here, so release the pooled connection and
            // answer the user now. Everything below is notification work.
            connection.release();
            orderConnectionReleased = true;

            res.status(201).json({
                success: true,
                message: createdOrders.length > 1
                    ? `Order placed and split across ${createdOrders.length} distributors. They have been notified.`
                    : 'Order placed successfully. Your distributor has been notified.',
                orderGroupId,
                orders: createdOrders.map(o => ({ id: o.orderId, distributorName: o.distributor.name, totalAmount: o.totalAmount, itemCount: o.orderItems.length }))
            });

            // 4. PDF + email + WhatsApp per sub-order.
            //
            // These used to be awaited before responding, so the franchise sat on a
            // spinner through PDF generation, two SMTP handshakes and two WhatsApp
            // calls per distributor — several seconds, and worse for a split order.
            // None of it affects whether the order exists, so it now runs detached
            // and failures are logged rather than surfaced.
            void (async () => {
            for (const { orderId, distributor, orderItems, totalAmount } of createdOrders) {
                const order = {
                    id: orderId, status: 'processing', total_amount: totalAmount,
                    shipping_address: shippingAddress, shipping_city: shippingCity,
                    shipping_state: shippingState, shipping_pincode: shippingPincode,
                    additional_remarks: typeof additionalRemarks === 'string' ? additionalRemarks.trim() : '',
                    created_at: new Date()
                };

                try {
                    const pdfBuffer = await OrderController.generateOrderPDF(order, orderItems, vendor, distributor);

                    const pdfUrl = `Order-${orderId}.pdf`;
                    await db.execute('UPDATE store_orders SET pdf_url = ? WHERE id = ?', [pdfUrl, orderId]);

                    const orderRemarks = typeof additionalRemarks === 'string' ? additionalRemarks.trim() : '';
                    const totalQuantity = orderItems.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);

                    // Shared building blocks so both emails carry the same details + PDF.
                    const shipTo = `${OrderController.escapeHtml(shippingAddress)}, ${OrderController.escapeHtml(shippingCity)}, ${OrderController.escapeHtml(shippingState)} - ${OrderController.escapeHtml(shippingPincode)}`;
                    const detailsBox = `
                        <div style="background: #f8f9fa; border-left: 4px solid #FFB400; padding: 15px; margin: 20px 0; border-radius: 4px;">
                            <p><strong>Order ID:</strong> ${OrderController.escapeHtml(orderId)}</p>
                            <p><strong>Items:</strong> ${orderItems.length} product(s)</p>
                            <p><strong>Total Qty:</strong> ${totalQuantity} units</p>
                            <p><strong>Ship To:</strong> ${shipTo}</p>
                        </div>`;
                    const itemsTable = `
                        <h2 style="font-size: 16px; color: #111827; margin: 24px 0 10px;">Order Items</h2>
                        <table style="width: 100%; border-collapse: collapse; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
                            <thead>
                                <tr style="background: #f8fafc;">
                                    <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #475569;">#</th>
                                    <th style="padding: 10px 12px; text-align: left; font-size: 12px; color: #475569;">Product</th>
                                    <th style="padding: 10px 12px; text-align: right; font-size: 12px; color: #475569;">Qty</th>
                                </tr>
                            </thead>
                            <tbody>${OrderController.renderOrderItemsEmailRows(orderItems)}</tbody>
                        </table>`;
                    const remarksBox = orderRemarks ? `
                        <div style="margin: 22px 0; padding: 14px; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px;">
                            <div style="font-weight: 700; color: #9a3412; margin-bottom: 6px;">Additional Info / Remarks</div>
                            <div style="font-size: 13px; color: #431407;">${OrderController.formatHtmlLines(orderRemarks)}</div>
                        </div>` : '';
                    const wrapEmail = (headerTitle: string, bodyHtml: string) => `
                        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                            <div style="background: linear-gradient(135deg, #FFB400, #FF8C00); padding: 30px; text-align: center; border-radius: 10px 10px 0 0;">
                                <h1 style="color: #000; margin: 0; font-size: 22px;">${headerTitle}</h1>
                            </div>
                            <div style="background: #fff; padding: 30px; border: 1px solid #eee; border-radius: 0 0 10px 10px;">
                                ${bodyHtml}
                            </div>
                        </div>`;
                    const pdfAttachment = [{
                        filename: `Order-${orderId}.pdf`,
                        content: pdfBuffer,
                        contentType: 'application/pdf'
                    }];

                    // ── Email 1: Distributor (fulfilment side) ──
                    if (distributor.email) {
                        await transporter.sendMail({
                            from: process.env.EMAIL_FROM,
                            to: distributor.email,
                            subject: `New Order from ${vendor.store_name} — #${orderId}`,
                            html: wrapEmail('New Order — Stock Allocated', `
                                <p>Hello <strong>${OrderController.escapeHtml(distributor.name)}</strong>,</p>
                                <p>Franchise <strong>${OrderController.escapeHtml(vendor.store_name)}</strong> has placed an order. Stock has already been deducted from your live inventory — no action is needed from you to confirm it.</p>
                                ${detailsBox}
                                ${itemsTable}
                                ${remarksBox}
                                <p style="color: #475569; font-size: 13px;">You can add a note for the franchise or decline the order from your dashboard if needed.</p>
                            `),
                            attachments: pdfAttachment
                        });
                    }

                    // ── Email 2: Franchise (order confirmation for the ordering store) ──
                    const franchiseEmail = vendor.contact_email;
                    if (franchiseEmail) {
                        await transporter.sendMail({
                            from: process.env.EMAIL_FROM,
                            to: franchiseEmail,
                            subject: `Order Placed — #${orderId} to ${distributor.name}`,
                            html: wrapEmail('Order Placed Successfully', `
                                <p>Hello <strong>${OrderController.escapeHtml(vendor.contact_name || vendor.store_name)}</strong>,</p>
                                <p>Your order has been placed with distributor <strong>${OrderController.escapeHtml(distributor.name)}</strong> and is now being processed. A copy of the purchase order is attached for your records.</p>
                                ${detailsBox}
                                ${itemsTable}
                                ${remarksBox}
                                <p style="color: #475569; font-size: 13px;">You can track this order from your franchise dashboard.</p>
                            `),
                            attachments: pdfAttachment
                        });
                    }

                } catch (pdfError: any) {
                    console.error(`[Order] PDF/Email generation failed for sub-order ${orderId} (non-critical):`, pdfError.message);
                }

                // ── WhatsApp notifications (details only, no PDF) — non-critical ──
                if (process.env.ENABLE_WHATSAPP === 'true') {
                    const totalQuantity = orderItems.reduce((s: number, i: any) => s + Number(i.quantity || 0), 0);
                    const itemCount = orderItems.length;

                    // Dynamic suffix for the template's "Download Invoice" URL button.
                    // The template registers base URL `<APP_URL>/api/orders/invoice/`; the token
                    // (which carries the order id) is appended as a single path segment →
                    // `<APP_URL>/api/orders/invoice/<jwt>`. No query string, so WhatsApp can't
                    // URL-encode/mangle it.
                    const invoiceUrlSuffix = OrderController.signInvoiceToken(orderId);

                    if (vendor.phone_number) {
                        try {
                            await WhatsAppService.sendOrderPlacedFranchise(
                                vendor.phone_number,
                                vendor.contact_name || vendor.store_name,
                                orderId,
                                distributor.name,
                                totalQuantity,
                                itemCount,
                                invoiceUrlSuffix
                            );
                        } catch (waErr: any) {
                            console.error(`[Order] Franchise WhatsApp failed for ${orderId} (non-critical):`, waErr.message);
                        }
                    }

                    if (distributor.phone_number) {
                        try {
                            await WhatsAppService.sendOrderReceivedDistributor(
                                distributor.phone_number,
                                distributor.name,
                                orderId,
                                vendor.store_name,
                                totalQuantity,
                                itemCount,
                                invoiceUrlSuffix
                            );
                        } catch (waErr: any) {
                            console.error(`[Order] Distributor WhatsApp failed for ${orderId} (non-critical):`, waErr.message);
                        }
                    }
                }
            }

            })().catch(err =>
                console.error('[Order] Background notification task failed (non-critical):', err)
            );

        } catch (error: any) {
            // Only roll back if we still own the transaction. Past the commit the
            // response is already sent, so failures there must not touch it.
            if (!orderConnectionReleased) {
                await connection.rollback();
                console.error('Create order error:', error);
                res.status(500).json({ error: 'Failed to create order' });
            } else {
                console.error('[Order] Post-commit error (order was created):', error);
            }
        } finally {
            if (!orderConnectionReleased) connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIRM ORDER (Distributor approves — no stock validation)
    // ═══════════════════════════════════════════════════════════
    static async confirmOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const orderId = req.params.id || (req.query as any).orderId;

            if (!orderId) {
                return res.status(400).json({ error: 'Order ID is required' });
            }

            await connection.beginTransaction();

            // Fetch order
            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?', [orderId]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            if (order.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({ error: `Order cannot be confirmed. Current status: ${order.status}` });
            }

            // Fetch order items
            const [itemRows]: any = await connection.execute(
                'SELECT * FROM store_order_items WHERE order_id = ?', [orderId]
            );

            // Update order status
            await connection.execute(
                "UPDATE store_orders SET status = 'processing' WHERE id = ?",
                [orderId]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'Order confirmed and moved to processing.',
                orderId
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Confirm order error:', error);
            res.status(500).json({ error: 'Failed to confirm order' });
        } finally {
            connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  DECLINE OUTGOING ORDER (admin only)
    // ═══════════════════════════════════════════════════════════
    static async cancelOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { id } = req.params;
            const user = (req as any).user;

            if (user?.role !== 'admin') {
                return res.status(403).json({
                    error: 'Franchise users cannot decline their own orders.'
                });
            }

            const declineReason = typeof req.body?.declineReason === 'string' ? req.body.declineReason.trim() : '';
            const finalReason = declineReason || 'Declined by admin';

            await connection.beginTransaction();

            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?', [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            if (order.status === 'delivered' || order.status === 'cancelled') {
                await connection.rollback();
                return res.status(400).json({ error: `Cannot cancel an order that is already ${order.status}` });
            }

            // Stock is taken at placement and stays taken while an order is on
            // hold (pending), so any open order gives it back when declined.
            if (order.status === 'processing' || order.status === 'shipped' || order.status === 'pending') {
                const [itemRows]: any = await connection.execute(
                    'SELECT * FROM store_order_items WHERE order_id = ?', [id]
                );

                await OrderController.restoreStockForOrderItems(connection, order.distributor_id, itemRows);
            }

            await OrderController.markOrderDeclined(connection, id, 'admin', finalReason);

            await connection.commit();

            res.json({
                success: true,
                message: 'Order declined successfully.',
                orderId: id
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Decline order error:', error);
            res.status(500).json({ error: 'Failed to cancel order' });
        } finally {
            connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  UPDATE ORDER STATUS (Admin manual transitions)
    // ═══════════════════════════════════════════════════════════
    static async updateOrderStatus(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const { status } = req.body;

            const validStatuses = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
            if (!validStatuses.includes(status)) {
                return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
            }

            // For cancel, use the cancel logic which handles stock restoration
            if (status === 'cancelled') {
                req.params.id = id;
                return OrderController.cancelOrder(req, res);
            }

            // For confirm (pending -> processing), use confirm logic which handles stock deduction
            if (status === 'processing') {
                req.params.id = id;
                return OrderController.confirmOrder(req, res);
            }

            // For other transitions (shipped, delivered) — simple status update
            await db.execute(
                'UPDATE store_orders SET status = ? WHERE id = ?',
                [status, id]
            );

            res.json({ success: true, message: `Order status updated to ${status}` });

        } catch (error: any) {
            console.error('Update order status error:', error);
            res.status(500).json({ error: 'Failed to update order status' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET MY ORDERS (Franchise views their orders)
    // ═══════════════════════════════════════════════════════════
    static async getMyOrders(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            const [orders]: any = await db.execute(
                `SELECT o.*, d.name as distributor_name, d.phone_number as distributor_phone, d.email as distributor_email,
                        d.allowed_brands as distributor_brand,
                        -- One checkout spanning several distributors becomes one
                        -- sub-order each, sharing an order_group_id. Surfacing the
                        -- sibling count lets the UI show them as one order instead
                        -- of unrelated rows.
                        (SELECT COUNT(*) FROM store_orders g
                          WHERE g.order_group_id = o.order_group_id
                            AND g.order_group_id IS NOT NULL) AS group_size
                 FROM store_orders o
                 LEFT JOIN distributors d ON o.distributor_id = d.id
                 WHERE o.vendor_id = ?
                 ORDER BY o.created_at DESC`,
                [user.id]
            );

            await OrderController.attachOrderItems(orders);

            res.json({ success: true, orders });

        } catch (error: any) {
            console.error('Get my orders error:', error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET SIBLING ORDERS IN THE SAME CHECKOUT
    // ═══════════════════════════════════════════════════════════
    /**
     * Every sub-order created by one checkout, so the franchise can download all
     * of its invoices at once instead of hunting for each distributor's row.
     *
     * Scoped to the caller's own orders — a group id from another vendor returns
     * nothing rather than leaking their order list.
     */
    static async getOrderGroup(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const user = (req as any).user;

            const [own]: any = await db.execute(
                'SELECT order_group_id, vendor_id FROM store_orders WHERE id = ?', [id]
            );
            if (own.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }
            if (user?.role !== 'admin' && own[0].vendor_id !== user.id) {
                return res.status(403).json({ error: 'Not your order' });
            }

            const groupId = own[0].order_group_id;
            // Older orders predate grouping — treat them as a group of one.
            if (!groupId) {
                const [single]: any = await db.execute(
                    `SELECT o.id, o.total_amount, o.status, d.name AS distributor_name
                     FROM store_orders o
                     LEFT JOIN distributors d ON d.id = o.distributor_id
                     WHERE o.id = ?`, [id]
                );
                return res.json({ success: true, groupId: null, orders: single });
            }

            const [orders]: any = await db.execute(
                `SELECT o.id, o.total_amount, o.status, d.name AS distributor_name
                 FROM store_orders o
                 LEFT JOIN distributors d ON d.id = o.distributor_id
                 WHERE o.order_group_id = ? AND o.vendor_id = ?
                 ORDER BY d.name ASC`,
                [groupId, own[0].vendor_id]
            );

            res.json({ success: true, groupId, orders });
        } catch (error: any) {
            console.error('Get order group error:', error);
            res.status(500).json({ error: 'Failed to load order group' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET ORDER BY ID
    // ═══════════════════════════════════════════════════════════
    static async getOrderById(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const user = (req as any).user;

            const [orders]: any = await db.execute(
                `SELECT o.*, d.name as distributor_name, d.email as distributor_email, d.phone_number as distributor_phone
                 FROM store_orders o
                 LEFT JOIN distributors d ON o.distributor_id = d.id
                 WHERE o.id = ?`,
                [id]
            );

            if (orders.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orders[0];

            // Security: vendors can only view their own orders
            if (user.role === 'vendor' && order.vendor_id !== user.id) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const [items]: any = await db.execute(
                'SELECT * FROM store_order_items WHERE order_id = ?', [id]
            );

            order.items = items;
            res.json({ success: true, order });

        } catch (error: any) {
            console.error('Get order by ID error:', error);
            res.status(500).json({ error: 'Failed to fetch order' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET FRANCHISE CATALOGUE (union of all assigned distributors' allowed categories)
    // ═══════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════
    //  GET FRANCHISE'S OWN ASSIGNED DISTRIBUTORS (self-service, many-to-many)
    // ═══════════════════════════════════════════════════════════
    static async getMyDistributors(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            const [distributors]: any = await db.execute(
                `SELECT d.id, d.name, d.city, d.state, d.phone_number, d.email, d.allowed_brands,
                        GROUP_CONCAT(sc.name ORDER BY sc.name SEPARATOR ', ') as allowed_category_names
                 FROM franchise_distributors fd
                 JOIN distributors d ON d.id = fd.distributor_id
                 -- Show the EFFECTIVE categories for this franchise: the distributor's
                 -- list, narrowed by any per-mapping limit the admin has set.
                 LEFT JOIN distributor_allowed_categories dac ON dac.distributor_id = d.id
                    AND (
                      fd.category_scope = 'all'
                      OR EXISTS (
                        SELECT 1 FROM franchise_distributor_categories fdc
                        WHERE fdc.franchise_user_id = fd.franchise_user_id
                          AND fdc.distributor_id = fd.distributor_id
                          AND fdc.category_id = dac.category_id
                      )
                    )
                 LEFT JOIN store_categories sc ON sc.id = dac.category_id
                 WHERE fd.franchise_user_id = ?
                 GROUP BY d.id, d.name, d.city, d.state, d.phone_number, d.email, d.allowed_brands
                 ORDER BY d.name ASC`,
                [user.id]
            );

            res.json({ success: true, distributors });
        } catch (error: any) {
            console.error('Get my distributors error:', error);
            res.status(500).json({ error: 'Failed to fetch assigned distributors' });
        }
    }

    static async getFranchiseCatalogue(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            // Fetch the franchise's allowed_brands so we can filter products accordingly.
            // A franchise with 'AF' sees only AF products, 'AC' sees only AC, 'AFAC' sees both.
            const [franchiseRows]: any = await db.execute(
                `SELECT allowed_brands FROM vendor_details WHERE user_id = ?`,
                [user.id]
            );
            const franchiseBrands: string = franchiseRows[0]?.allowed_brands || 'AF';

            // AFAC franchises see all brands; AF/AC see only their own brand
            const brandFilterClause = franchiseBrands === 'AFAC' ? '' : 'AND sp.brand = ?';
            const brandFilterParams: string[] = franchiseBrands === 'AFAC' ? [] : [franchiseBrands];

            const [inventory]: any = await db.execute(
                `SELECT
                    sp.id as product_id,
                    spv.id as variation_id,
                    COALESCE(di.stock_quantity, 0) as stock_quantity,
                    sp.name as product_name,
                    sp.description as product_description,
                    sp.additional_info,
                    sp.category_id,
                    sp.brand as product_brand,
                    COALESCE(spv.name, 'Default') as variation_name,
                    COALESCE(spv.price, sp.price, 0) as price,
                    spv.sku,
                    fd.distributor_id,
                    d.name as distributor_name,
                    d.allowed_brands as distributor_brands
                 FROM franchise_distributors fd
                 JOIN distributors d ON d.id = fd.distributor_id
                 JOIN distributor_allowed_categories dac ON dac.distributor_id = fd.distributor_id
                 JOIN store_products sp ON sp.category_id = dac.category_id
                 LEFT JOIN store_product_variations spv ON spv.product_id = sp.id
                 LEFT JOIN distributor_inventory di ON di.product_id = sp.id
                    AND di.variation_id <=> spv.id
                    AND di.distributor_id = fd.distributor_id
                 WHERE fd.franchise_user_id = ?
                   AND (d.allowed_brands = 'AFAC' OR d.allowed_brands = sp.brand)
                   -- Per-mapping limit: 'all' inherits the distributor's full
                   -- range; 'selected' allows only the listed categories (which
                   -- may legitimately be none).
                   AND (
                     fd.category_scope = 'all'
                     OR EXISTS (
                       SELECT 1 FROM franchise_distributor_categories fdc
                       WHERE fdc.franchise_user_id = fd.franchise_user_id
                         AND fdc.distributor_id = fd.distributor_id
                         AND fdc.category_id = dac.category_id
                     )
                   )
                   ${brandFilterClause}
                 ORDER BY sp.name ASC, spv.name ASC`,
                [user.id, ...brandFilterParams]
            );

            (inventory as any[]).forEach((item: any) => {
                if (typeof item.additional_info === 'string') {
                    try {
                        item.additional_info = JSON.parse(item.additional_info);
                    } catch {
                        item.additional_info = [];
                    }
                }
            });

            const productIds = [...new Set((inventory as any[]).map((item: any) => item.product_id))];
            let productImages: Record<string, string[]> = {};
            if (productIds.length > 0) {
                const placeholders = productIds.map(() => '?').join(',');
                const [images]: any = await db.execute(
                    `SELECT product_id, url, is_primary, display_order
                     FROM store_product_images
                     WHERE product_id IN (${placeholders})
                     ORDER BY is_primary DESC, display_order ASC`,
                    productIds
                );
                (images as any[]).forEach((img: any) => {
                    if (!productImages[img.product_id]) productImages[img.product_id] = [];
                    productImages[img.product_id].push(img.url);
                });
            }

            let categoryMap: Record<string, string> = {};
            const categoryIds = [...new Set((inventory as any[]).map((item: any) => item.category_id).filter(Boolean))];
            if (categoryIds.length > 0) {
                const catPlaceholders = categoryIds.map(() => '?').join(',');
                const [categories]: any = await db.execute(
                    `SELECT id, name FROM store_categories WHERE id IN (${catPlaceholders})`,
                    categoryIds
                );
                (categories as any[]).forEach((cat: any) => { categoryMap[cat.id] = cat.name; });
            }

            res.json({
                success: true,
                inventory,
                productImages,
                categoryMap
            });
        } catch (error: any) {
            console.error('Get franchise catalogue error:', error);
            res.status(500).json({ error: 'Failed to fetch catalogue' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET DISTRIBUTOR STOCK (Live inventory for franchise's distributor)
    // ═══════════════════════════════════════════════════════════
    static async getDistributorStock(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            // Get vendor's distributor
            const [vendorRows]: any = await db.execute(
                'SELECT distributor_id FROM vendor_details WHERE user_id = ?',
                [user.id]
            );

            if (vendorRows.length === 0) {
                return res.status(400).json({ error: 'Vendor profile not found' });
            }

            const distributorId = vendorRows[0].distributor_id;

            // No fallback: assigning "the first distributor" here wrote a
            // distributor onto the franchise that the admin never chose.
            if (!distributorId) {
                return res.status(400).json({ error: 'No distributor assigned to your franchise.' });
            }

            // Get distributor name
            const [distRows]: any = await db.execute(
                'SELECT name FROM distributors WHERE id = ?',
                [distributorId]
            );

            // Fetch catalogue products with variations, and join distributor inventory if exists.
            // Product-level rows are included even when an admin-managed product has no variations.
            // Only products in a category this distributor is allowed to sell are returned.
            const [inventory]: any = await db.execute(
                `SELECT
                    sp.id as product_id,
                    spv.id as variation_id,
                    COALESCE(di.stock_quantity, 0) as stock_quantity,
                    sp.name as product_name,
                    sp.description as product_description,
                    sp.category_id,
                    COALESCE(spv.name, 'Default') as variation_name,
                    COALESCE(spv.price, sp.price, 0) as price,
                    spv.sku
                 FROM store_products sp
                 JOIN distributor_allowed_categories dac ON dac.category_id = sp.category_id AND dac.distributor_id = ?
                 LEFT JOIN store_product_variations spv ON spv.product_id = sp.id
                 LEFT JOIN distributor_inventory di ON di.product_id = sp.id
                    AND di.variation_id <=> spv.id
                    AND di.distributor_id = ?
                 ORDER BY sp.name ASC, spv.name ASC`,
                [distributorId, distributorId]
            );

            // Fetch product images for all products in the inventory
            const productIds = [...new Set((inventory as any[]).map((item: any) => item.product_id))];
            let productImages: Record<string, string[]> = {};

            if (productIds.length > 0) {
                const placeholders = productIds.map(() => '?').join(',');
                const [images]: any = await db.execute(
                    `SELECT product_id, url, is_primary, display_order 
                     FROM store_product_images 
                     WHERE product_id IN (${placeholders})
                     ORDER BY is_primary DESC, display_order ASC`,
                    productIds
                );

                (images as any[]).forEach((img: any) => {
                    if (!productImages[img.product_id]) {
                        productImages[img.product_id] = [];
                    }
                    productImages[img.product_id].push(img.url);
                });
            }

            // Fetch category names
            let categoryMap: Record<string, string> = {};
            const categoryIds = [...new Set((inventory as any[]).map((item: any) => item.category_id).filter(Boolean))];
            if (categoryIds.length > 0) {
                const catPlaceholders = categoryIds.map(() => '?').join(',');
                const [categories]: any = await db.execute(
                    `SELECT id, name FROM store_categories WHERE id IN (${catPlaceholders})`,
                    categoryIds
                );
                (categories as any[]).forEach((cat: any) => {
                    categoryMap[cat.id] = cat.name;
                });
            }

            res.json({
                success: true,
                distributorName: distRows[0]?.name || 'Unknown',
                distributorId,
                inventory,
                productImages,
                categoryMap
            });

        } catch (error: any) {
            console.error('Get distributor stock error:', error);
            res.status(500).json({ error: 'Failed to fetch distributor stock' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET ALL ORDERS (Admin view)
    // ═══════════════════════════════════════════════════════════
    static async getAllOrders(req: Request, res: Response) {
        try {
            const { status, search } = req.query;

            let query = `
                SELECT o.*, 
                       d.name as distributor_name,
                       p.name as vendor_name,
                       vd.store_name
                FROM store_orders o
                LEFT JOIN distributors d ON o.distributor_id = d.id
                LEFT JOIN profiles p ON o.vendor_id = p.id
                LEFT JOIN vendor_details vd ON o.vendor_id = vd.user_id
            `;
            const params: any[] = [];
            const conditions: string[] = [];

            if (status && status !== 'all') {
                conditions.push('o.status = ?');
                params.push(status);
            }

            if (search) {
                conditions.push('(vd.store_name LIKE ? OR o.id LIKE ? OR p.name LIKE ?)');
                const searchTerm = `%${search}%`;
                params.push(searchTerm, searchTerm, searchTerm);
            }

            if (conditions.length > 0) {
                query += ' WHERE ' + conditions.join(' AND ');
            }

            query += ' ORDER BY o.created_at DESC';

            const [orders]: any = await db.execute(query, params);

            await OrderController.attachOrderItems(orders);

            res.json({ success: true, orders });

        } catch (error: any) {
            console.error('Get all orders error:', error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET DISTRIBUTOR DETAILS (Franchise sees their distributor info)
    // ═══════════════════════════════════════════════════════════
    static async getDistributorDetails(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            // Read only. This page used to assign "the first distributor" to any
            // franchise without one, every time a franchise opened Orders.
            const [rows]: any = await db.execute(
                `SELECT d.* FROM distributors d
                 JOIN vendor_details vd ON vd.distributor_id = d.id
                 WHERE vd.user_id = ?`,
                [user.id]
            );

            if (rows.length === 0) {
                return res.status(404).json({ error: 'No distributor assigned to your franchise.' });
            }

            res.json({ success: true, distributor: rows[0] });

        } catch (error: any) {
            console.error('Get distributor details error:', error);
            res.status(500).json({ error: 'Failed to fetch distributor details' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  DOWNLOAD ORDER PDF (Generates and streams PDF)
    // ═══════════════════════════════════════════════════════════
    // â”€â”€â”€ GET DISTRIBUTOR MAPPED FRANCHISES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    static async getDistributorFranchises(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            const [distRows]: any = await db.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );

            if (distRows.length === 0) {
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }

            const distributorId = distRows[0].id;

            const [franchises]: any = await db.execute(
                `SELECT vd.user_id AS vendor_id,
                        vd.store_name,
                        vd.store_email,
                        vd.city,
                        vd.state,
                        vd.pincode,
                        p.phone_number
                 FROM franchise_distributors fd
                 JOIN vendor_details vd ON vd.user_id = fd.franchise_user_id
                 LEFT JOIN profiles p ON p.id = vd.user_id
                 WHERE fd.distributor_id = ? AND vd.is_franchise = TRUE
                 ORDER BY vd.store_name ASC`,
                [distributorId]
            );

            res.json({ success: true, franchises });
        } catch (error: any) {
            console.error('Get distributor franchises error:', error);
            res.status(500).json({ error: 'Failed to fetch mapped franchises' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET DISTRIBUTOR'S OWN INVENTORY (self-service, category-restricted)
    // ═══════════════════════════════════════════════════════════
    static async getOwnInventory(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            const [distRows]: any = await db.execute(
                'SELECT id, name FROM distributors WHERE profile_id = ?',
                [user.id]
            );

            if (distRows.length === 0) {
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }

            const distributorId = distRows[0].id;

            // Only products whose category is in this distributor's allowed list are shown.
            const [inventory]: any = await db.execute(
                `SELECT
                    sp.id as product_id,
                    spv.id as variation_id,
                    COALESCE(di.stock_quantity, 0) as stock_quantity,
                    sp.name as product_name,
                    sp.description as product_description,
                    sp.category_id,
                    sp.brand as product_brand,
                    sc.name as category_name,
                    sc.parent_id as category_parent_id,
                    parent_sc.name as parent_category_name,
                    COALESCE(spv.name, 'Default') as variation_name,
                    COALESCE(spv.price, sp.price, 0) as price,
                    spv.sku
                 FROM distributor_allowed_categories dac
                 JOIN store_categories sc ON sc.id = dac.category_id
                 LEFT JOIN store_categories parent_sc ON parent_sc.id = sc.parent_id
                 JOIN store_products sp ON sp.category_id = dac.category_id
                 LEFT JOIN store_product_variations spv ON spv.product_id = sp.id
                 LEFT JOIN distributor_inventory di ON di.product_id = sp.id
                    AND di.variation_id <=> spv.id
                    AND di.distributor_id = dac.distributor_id
                 WHERE dac.distributor_id = ?
                 ORDER BY sp.name ASC, spv.name ASC`,
                [distributorId]
            );

            res.json({
                success: true,
                distributorId,
                distributorName: distRows[0].name,
                inventory
            });
        } catch (error: any) {
            console.error('Get own inventory error:', error);
            res.status(500).json({ error: 'Failed to fetch inventory' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  UPSERT DISTRIBUTOR'S OWN STOCK (self-service, category-restricted)
    // ═══════════════════════════════════════════════════════════
    static async updateOwnStock(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const { productId } = req.body;
            const stockQuantity = Number(req.body.stockQuantity);
            const variationId = req.body.variationId || null;

            if (!productId || req.body.stockQuantity === undefined || req.body.stockQuantity === '' || !Number.isInteger(stockQuantity) || stockQuantity < 0) {
                return res.status(400).json({ error: 'Stock must be a whole number, 0 or more.' });
            }

            const [distRows]: any = await db.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );
            if (distRows.length === 0) {
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }
            const distributorId = distRows[0].id;

            // Verify this product's category is in the distributor's allowed list
            const [productRows]: any = await db.execute(
                'SELECT category_id FROM store_products WHERE id = ?',
                [productId]
            );
            if (productRows.length === 0) {
                return res.status(404).json({ error: 'Product not found' });
            }

            const [allowed]: any = await db.execute(
                'SELECT 1 FROM distributor_allowed_categories WHERE distributor_id = ? AND category_id = ?',
                [distributorId, productRows[0].category_id]
            );
            if (allowed.length === 0) {
                return res.status(403).json({ error: 'This product\'s category is not in your allowed categories.' });
            }

            // Manual upsert (not ON DUPLICATE KEY) because MySQL unique keys treat
            // multiple NULL variation_id rows as distinct, so the key alone can't
            // dedupe variation-less products.
            const [existing]: any = await db.execute(
                `SELECT id FROM distributor_inventory
                 WHERE distributor_id = ? AND product_id = ? AND variation_id <=> ?`,
                [distributorId, productId, variationId]
            );

            if (existing.length > 0) {
                await db.execute(
                    'UPDATE distributor_inventory SET stock_quantity = ? WHERE id = ?',
                    [stockQuantity, existing[0].id]
                );
            } else {
                await db.execute(
                    `INSERT INTO distributor_inventory (id, distributor_id, product_id, variation_id, stock_quantity)
                     VALUES (?, ?, ?, ?, ?)`,
                    [uuidv4(), distributorId, productId, variationId, stockQuantity]
                );
            }

            res.json({ success: true, message: 'Stock updated successfully' });
        } catch (error: any) {
            console.error('Update own stock error:', error);
            res.status(500).json({ error: 'Failed to update stock' });
        }
    }

    // ─── Helper: build the order PDF for a given order id (shared by authed + public routes) ──
    private static async buildOrderPdfById(orderId: string): Promise<Buffer | null> {
        const [orderRows]: any = await db.execute('SELECT * FROM store_orders WHERE id = ?', [orderId]);
        if (orderRows.length === 0) return null;
        const order = orderRows[0];

        const [items]: any = await db.execute(
            'SELECT * FROM store_order_items WHERE order_id = ?', [orderId]
        );

        const [vendorRows]: any = await db.execute(
            `SELECT vd.id, vd.store_name, vd.address, vd.city, vd.state, vd.pincode,
                    p.name as contact_name, p.phone_number
             FROM vendor_details vd
             JOIN profiles p ON vd.user_id = p.id
             WHERE vd.user_id = ?`,
            [order.vendor_id]
        );
        const franchise = vendorRows[0] || { store_name: 'Franchise Partner' };

        const [distRows]: any = await db.execute(
            'SELECT * FROM distributors WHERE id = ?', [order.distributor_id]
        );
        const distributor = distRows[0] || { name: 'Distributor Partner' };

        return OrderController.generateOrderPDF(order, items, franchise, distributor);
    }

    /**
     * Sign a time-limited token that authorizes downloading one order's invoice PDF
     * without a login session — used for the "Download Invoice" link in WhatsApp/email.
     */
    static signInvoiceToken(orderId: string, expiresIn: string = '30d'): string {
        return signActionToken('invoice', { orderId }, expiresIn);
    }

    static async downloadOrderPDF(req: Request, res: Response) {
        try {
            const { id } = req.params;
            const user = (req as any).user;

            // Fetch order (for access-control check)
            const [orderRows]: any = await db.execute(
                'SELECT vendor_id, distributor_id FROM store_orders WHERE id = ?', [id]
            );

            if (orderRows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            // Access Control check
            if (user.role === 'vendor' && order.vendor_id !== user.id) {
                // If they are not the franchise who placed the order, check if they are the distributor assigned to the order
                const [distRows]: any = await db.execute(
                    'SELECT id FROM distributors WHERE profile_id = ?',
                    [user.id]
                );
                const distributorId = distRows.length > 0 ? distRows[0].id : null;

                if (!distributorId || order.distributor_id !== distributorId) {
                    return res.status(403).json({ error: 'Unauthorized to download this order' });
                }
            }

            const pdfBuffer = await OrderController.buildOrderPdfById(id);
            if (!pdfBuffer) return res.status(404).json({ error: 'Order not found' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Order-${id}.pdf"`);
            res.send(pdfBuffer);

        } catch (error: any) {
            console.error('Download order PDF error:', error);
            res.status(500).json({ error: 'Failed to generate order PDF' });
        }
    }

    /**
     * Public, token-authorized invoice download — no login session required.
     * The token is a signed JWT ({ purpose: 'invoice', orderId }) generated at
     * order creation and embedded in the WhatsApp "Download Invoice" button.
     *
     * The order id is carried INSIDE the token (not the URL) so the whole link is
     * a single path segment with no query string / '?' / '=' — WhatsApp dynamic-URL
     * buttons URL-encode query characters, which would otherwise break the link.
     * GET /orders/invoice/:token
     */
    static async downloadOrderInvoicePublic(req: Request, res: Response) {
        try {
            // Accept the token from the path (:token) — falls back to ?token= for compatibility.
            const token = (req.params.token as string) || (req.query.token as string);

            if (!token || typeof token !== 'string') {
                return res.status(400).send('Missing invoice token.');
            }

            const decoded: any = verifyActionToken('invoice', token);
            if (!decoded) {
                return res.status(401).send('This invoice link is invalid or has expired.');
            }
            if (!decoded.orderId) {
                return res.status(403).send('This invoice link is not valid.');
            }

            const id = decoded.orderId;
            const pdfBuffer = await OrderController.buildOrderPdfById(id);
            if (!pdfBuffer) return res.status(404).send('Order not found.');

            // Name it after the distributor, matching the in-app download: a split
            // order sends one link per distributor, and "Order-<id>.pdf" gives the
            // recipient no way to tell which invoice is which.
            let filename = `Order-${id}.pdf`;
            try {
                const [rows]: any = await db.execute(
                    `SELECT d.name FROM store_orders o
                     LEFT JOIN distributors d ON d.id = o.distributor_id
                     WHERE o.id = ?`, [id]
                );
                const distName = rows[0]?.name;
                if (distName) {
                    const safe = String(distName).replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-');
                    if (safe) filename = `Invoice-${safe}-${id}.pdf`;
                }
            } catch {
                // Fall back to the plain name — never fail the download over this.
            }

            res.setHeader('Content-Type', 'application/pdf');
            // 'attachment', not 'inline' — this link is labelled "Download Invoice"
            // in WhatsApp, but inline made the browser just display it.
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.send(pdfBuffer);

        } catch (error: any) {
            console.error('Public invoice download error:', error);
            res.status(500).send('Failed to generate invoice.');
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  GET DISTRIBUTOR INCOMING ORDERS
    // ═══════════════════════════════════════════════════════════
    static async getDistributorIncomingOrders(req: Request, res: Response) {
        try {
            const user = (req as any).user;

            // 1. Fetch linked distributor record for the logged-in vendor profile
            const [distRows]: any = await db.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );

            if (distRows.length === 0) {
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }

            const distributorId = distRows[0].id;

            // 2. Fetch all orders sent to this distributor, along with client store details
            const [orders]: any = await db.execute(
                `SELECT o.*,
                        p.name as vendor_name,
                        p.phone_number as vendor_phone,
                        vd.store_name as client_store_name,
                        vd.store_email as client_store_email,
                        vd.allowed_brands as franchise_brand,
                        o.vendor_id as vendor_id
                 FROM store_orders o
                 LEFT JOIN profiles p ON o.vendor_id = p.id
                 LEFT JOIN vendor_details vd ON o.vendor_id = vd.user_id
                 WHERE o.distributor_id = ?
                 ORDER BY o.created_at DESC`,
                [distributorId]
            );

            // 3. Attach items for all orders in one query
            await OrderController.attachOrderItems(orders);

            res.json({ success: true, orders });

        } catch (error: any) {
            console.error('Get distributor incoming orders error:', error);
            res.status(500).json({ error: 'Failed to fetch incoming orders' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  CONFIRM DISTRIBUTOR ORDER
    // ═══════════════════════════════════════════════════════════
    static async confirmDistributorOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const user = (req as any).user;
            const { id } = req.params; // Order ID

            await connection.beginTransaction();

            // 1. Fetch linked distributor record for the logged-in vendor profile
            const [distRows]: any = await connection.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );

            if (distRows.length === 0) {
                await connection.rollback();
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }

            const distributorId = distRows[0].id;

            // 2. Fetch order and check ownership
            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?', [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            if (order.distributor_id !== distributorId) {
                await connection.rollback();
                return res.status(403).json({ error: 'Access denied: You are not the assigned distributor for this order.' });
            }

            if (order.status !== 'pending') {
                await connection.rollback();
                return res.status(400).json({ error: `Order cannot be resumed. Current status: ${order.status}` });
            }

            // 3. Fetch order items
            const [itemRows]: any = await connection.execute(
                'SELECT * FROM store_order_items WHERE order_id = ?', [id]
            );

            const [vendorRows]: any = await connection.execute(
                `SELECT vd.store_name, vd.store_email, p.name as contact_name, p.email as contact_email
                 FROM vendor_details vd
                 JOIN profiles p ON p.id = vd.user_id
                 WHERE vd.user_id = ?`,
                [order.vendor_id]
            );

            const [distributorRows]: any = await connection.execute(
                'SELECT name, email FROM distributors WHERE id = ?',
                [distributorId]
            );

            // 4. Stock was already deducted at order placement (auto-confirm flow).
            //    If this order was put on hold via holdDistributorOrder, stock was
            //    NOT restored — so no need to deduct again when resuming.

            // 5. Update order status back to active
            await connection.execute(
                "UPDATE store_orders SET status = 'processing' WHERE id = ?",
                [id]
            );

            await connection.commit();

            const vendor = vendorRows[0];
            const distributor = distributorRows[0];

            if (vendor?.contact_email || vendor?.store_email) {
                const recipientEmail = vendor.contact_email || vendor.store_email;
                const totalQuantity = itemRows.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0);

                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM,
                        to: recipientEmail,
                        subject: `Order Confirmed for #${id}`,
                        html: `
                            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                <div style="background: linear-gradient(135deg, #11998e, #38ef7d); padding: 28px; text-align: center; border-radius: 10px 10px 0 0;">
                                    <h1 style="color: #0f172a; margin: 0; font-size: 22px;">Order Confirmed by Distributor</h1>
                                </div>
                                <div style="background: #fff; padding: 30px; border: 1px solid #eee; border-radius: 0 0 10px 10px;">
                                    <p>Hello <strong>${OrderController.escapeHtml(vendor?.store_name || vendor?.contact_name || 'Franchise Partner')}</strong>,</p>
                                    <p>Your distributor <strong>${OrderController.escapeHtml(distributor?.name || 'Distributor')}</strong> has confirmed this order.</p>

                                    <div style="background: #f8fafc; border-left: 4px solid #11998e; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                        <p><strong>Order ID:</strong> ${OrderController.escapeHtml(id)}</p>
                                        <p><strong>Items:</strong> ${itemRows.length} product(s)</p>
                                        <p><strong>Total Qty Requested:</strong> ${totalQuantity} units</p>
                                    </div>

                                    <p style="color: #475569; font-size: 13px;">You can track the order in your dashboard and click <strong>Mark Received</strong> once the full shipment reaches you.</p>
                                </div>
                            </div>
                        `
                    });
                } catch (mailError: any) {
                    console.error('Distributor confirmation email failed:', mailError.message);
                }
            }

            res.json({
                success: true,
                message: 'Order confirmed and shared with the franchise.',
                orderId: id,
                status: 'processing'
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Confirm distributor order error:', error);
            res.status(500).json({ error: 'Failed to confirm order' });
        } finally {
            connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  HOLD DISTRIBUTOR ORDER  (processing → pending)
    //  Distributor flags an active order as "on hold" — stock stays
    //  deducted (already happened at placement), status flips back to
    //  pending so the distributor can review. Resume via confirmDistributorOrder.
    // ═══════════════════════════════════════════════════════════
    static async holdDistributorOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const user = (req as any).user;
            const { id } = req.params;
            const holdReason = typeof req.body?.holdReason === 'string' ? req.body.holdReason.trim() : '';

            await connection.beginTransaction();

            const [distRows]: any = await connection.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );
            if (distRows.length === 0) {
                await connection.rollback();
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }
            const distributorId = distRows[0].id;

            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?', [id]
            );
            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }
            const order = orderRows[0];

            if (order.distributor_id !== distributorId) {
                await connection.rollback();
                return res.status(403).json({ error: 'Access denied: You are not the assigned distributor for this order.' });
            }

            if (order.status !== 'processing') {
                await connection.rollback();
                return res.status(400).json({ error: `Only active (processing) orders can be put on hold. Current status: ${order.status}` });
            }

            await connection.execute(
                "UPDATE store_orders SET status = 'pending' WHERE id = ?",
                [id]
            );

            if (holdReason) {
                // store_order_messages is the chat both sides read; the older
                // order_messages table is read by nothing, so the franchise never saw why.
                await connection.execute(
                    `INSERT INTO store_order_messages (id, order_id, sender_id, sender_role, message_text, is_system)
                     VALUES (?, ?, ?, 'distributor', ?, true)`,
                    [uuidv4(), id, user.id, `[On Hold] ${holdReason}`]
                );
            }

            await connection.commit();

            res.json({
                success: true,
                message: 'Order placed on hold.',
                orderId: id,
                status: 'pending'
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Hold distributor order error:', error);
            res.status(500).json({ error: 'Failed to put order on hold' });
        } finally {
            connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  ADD/UPDATE DISTRIBUTOR NOTE (independent of order status/confirmation)
    // ═══════════════════════════════════════════════════════════
    static async addDistributorNote(req: Request, res: Response) {
        try {
            const user = (req as any).user;
            const { id } = req.params; // Order ID
            const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';

            if (!note) {
                return res.status(400).json({ error: 'Note cannot be empty.' });
            }

            const [distRows]: any = await db.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );
            if (distRows.length === 0) {
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }
            const distributorId = distRows[0].id;

            const [orderRows]: any = await db.execute(
                'SELECT * FROM store_orders WHERE id = ?', [id]
            );
            if (orderRows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }
            const order = orderRows[0];

            if (order.distributor_id !== distributorId) {
                return res.status(403).json({ error: 'Access denied: You are not the assigned distributor for this order.' });
            }

            await db.execute(
                'UPDATE store_orders SET distributor_confirmation_note = ? WHERE id = ?',
                [note, id]
            );

            const systemMessageId = uuidv4();
            await db.execute(
                `INSERT INTO store_order_messages (id, order_id, sender_id, sender_role, message_text, is_system)
                 VALUES (?, ?, ?, ?, ?, true)`,
                [systemMessageId, id, user.id, 'distributor', note]
            );

            const [vendorRows]: any = await db.execute(
                `SELECT vd.store_name, vd.store_email, p.name as contact_name, p.email as contact_email
                 FROM vendor_details vd
                 JOIN profiles p ON p.id = vd.user_id
                 WHERE vd.user_id = ?`,
                [order.vendor_id]
            );
            const [distributorRows]: any = await db.execute(
                'SELECT name FROM distributors WHERE id = ?',
                [distributorId]
            );
            const vendor = vendorRows[0];
            const distributor = distributorRows[0];

            if (vendor?.contact_email || vendor?.store_email) {
                const recipientEmail = vendor.contact_email || vendor.store_email;
                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_FROM,
                        to: recipientEmail,
                        subject: `Distributor Note for Order #${id}`,
                        html: `
                            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                                <div style="background: linear-gradient(135deg, #11998e, #38ef7d); padding: 28px; text-align: center; border-radius: 10px 10px 0 0;">
                                    <h1 style="color: #0f172a; margin: 0; font-size: 22px;">New Note from Distributor</h1>
                                </div>
                                <div style="background: #fff; padding: 30px; border: 1px solid #eee; border-radius: 0 0 10px 10px;">
                                    <p>Hello <strong>${OrderController.escapeHtml(vendor?.store_name || vendor?.contact_name || 'Franchise Partner')}</strong>,</p>
                                    <p>Your distributor <strong>${OrderController.escapeHtml(distributor?.name || 'Distributor')}</strong> shared an update on order <strong>#${OrderController.escapeHtml(id)}</strong>.</p>
                                    <div style="margin: 22px 0; padding: 14px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 8px;">
                                        <div style="font-weight: 700; color: #065f46; margin-bottom: 6px;">Distributor Update</div>
                                        <div style="font-size: 13px; color: #134e4a;">${OrderController.renderPlainTextLines(note)}</div>
                                    </div>
                                    <p style="color: #475569; font-size: 13px;">You can track the order and reply in your dashboard.</p>
                                </div>
                            </div>
                        `
                    });
                } catch (mailError: any) {
                    console.error('Distributor note email failed:', mailError.message);
                }
            }

            res.json({
                success: true,
                message: 'Note shared with the franchise.',
                distributorConfirmationNote: note
            });
        } catch (error: any) {
            console.error('Add distributor note error:', error);
            res.status(500).json({ error: 'Failed to add note' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  DECLINE DISTRIBUTOR ORDER
    // ═══════════════════════════════════════════════════════════
    static async cancelDistributorOrder(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const user = (req as any).user;
            const { id } = req.params; // Order ID
            const declineReason = typeof req.body?.declineReason === 'string' ? req.body.declineReason.trim() : '';

            if (!declineReason) {
                return res.status(400).json({ error: 'Please provide a decline reason.' });
            }

            await connection.beginTransaction();

            // 1. Fetch linked distributor record for the logged-in vendor profile
            const [distRows]: any = await connection.execute(
                'SELECT id FROM distributors WHERE profile_id = ?',
                [user.id]
            );

            if (distRows.length === 0) {
                await connection.rollback();
                return res.status(403).json({ error: 'You are not registered as a distributor.' });
            }

            const distributorId = distRows[0].id;

            // 2. Fetch order and check ownership
            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?', [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            if (order.distributor_id !== distributorId) {
                await connection.rollback();
                return res.status(403).json({ error: 'Access denied: You are not the assigned distributor for this order.' });
            }

            if (order.status === 'delivered' || order.status === 'cancelled') {
                await connection.rollback();
                return res.status(400).json({ error: `Cannot cancel an order that is already ${order.status}` });
            }

            // 3. Stock is taken at placement and stays taken while on hold
            //    (pending), so any open order gives it back when declined.
            if (order.status === 'processing' || order.status === 'shipped' || order.status === 'pending') {
                const [itemRows]: any = await connection.execute(
                    'SELECT * FROM store_order_items WHERE order_id = ?', [id]
                );

                await OrderController.restoreStockForOrderItems(connection, distributorId, itemRows);
            }

            // 4. Update order status to declined
            await OrderController.markOrderDeclined(connection, id, 'distributor', declineReason);

            await connection.commit();

            res.json({
                success: true,
                message: 'Order declined successfully.',
                orderId: id
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Decline distributor order error:', error);
            res.status(500).json({ error: 'Failed to cancel order' });
        } finally {
            connection.release();
        }
    }

    // ═══════════════════════════════════════════════════════════
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    //  MARK ORDER RECEIVED (Franchise acknowledges delivery)
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    static async markOrderReceived(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const user = (req as any).user;
            const { id } = req.params;

            await connection.beginTransaction();

            const [orderRows]: any = await connection.execute(
                'SELECT * FROM store_orders WHERE id = ?',
                [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            if (order.vendor_id !== user.id) {
                await connection.rollback();
                return res.status(403).json({ error: 'Access denied: You can only acknowledge your own orders.' });
            }

            if (!['processing', 'shipped'].includes(order.status)) {
                await connection.rollback();
                return res.status(400).json({ error: `Order cannot be marked received from current status: ${order.status}` });
            }

            await connection.execute(
                "UPDATE store_orders SET status = 'delivered' WHERE id = ?",
                [id]
            );

            await connection.commit();

            res.json({
                success: true,
                message: 'Order marked as received.',
                orderId: id,
                status: 'delivered'
            });
        } catch (error: any) {
            await connection.rollback();
            console.error('Mark order received error:', error);
            res.status(500).json({ error: 'Failed to mark order as received' });
        } finally {
            connection.release();
        }
    }

    //  GET ORDER MESSAGES (Chat history)
    // ═══════════════════════════════════════════════════════════
    static async getOrderMessages(req: Request, res: Response) {
        try {
            const { id } = req.params; // Order ID
            const user = (req as any).user;

            // Access Control Check: Make sure order exists and user is either the vendor who placed it or the distributor it's assigned to
            const [orderRows]: any = await db.execute(
                'SELECT vendor_id, distributor_id FROM store_orders WHERE id = ?',
                [id]
            );

            if (orderRows.length === 0) {
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            // If user is a vendor, check if they are the owner
            if (user.role === 'vendor') {
                // If they are not the owner, check if they are the distributor of this order
                const [distRows]: any = await db.execute(
                    'SELECT id FROM distributors WHERE profile_id = ?',
                    [user.id]
                );
                const distributorId = distRows.length > 0 ? distRows[0].id : null;

                if (order.vendor_id !== user.id && (!distributorId || order.distributor_id !== distributorId)) {
                    return res.status(403).json({ error: 'Access denied to this order conversation' });
                }
            }

            // Fetch messages
            const [messages]: any = await db.execute(
                `SELECT m.*, p.name as sender_name 
                 FROM store_order_messages m
                 LEFT JOIN profiles p ON m.sender_id = p.id
                 WHERE m.order_id = ?
                 ORDER BY m.created_at ASC`,
                [id]
            );

            res.json({ success: true, messages });

        } catch (error: any) {
            console.error('Get order messages error:', error);
            res.status(500).json({ error: 'Failed to fetch conversation history' });
        }
    }

    // ═══════════════════════════════════════════════════════════
    //  CREATE ORDER MESSAGE (Send chat message / share docket)
    // ═══════════════════════════════════════════════════════════
    static async createOrderMessage(req: Request, res: Response) {
        const connection = await db.getConnection();
        try {
            const { id } = req.params; // Order ID
            const user = (req as any).user;
            const { messageText, attachmentUrl, attachmentName, isSystem, docketId } = req.body;

            await connection.beginTransaction();

            // 1. Fetch order details for access control and context
            const [orderRows]: any = await connection.execute(
                'SELECT vendor_id, distributor_id FROM store_orders WHERE id = ?',
                [id]
            );

            if (orderRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ error: 'Order not found' });
            }

            const order = orderRows[0];

            // Check role and retrieve distributor ID if sender is distributor
            let distributorId = null;
            if (user.role === 'vendor') {
                const [distRows]: any = await connection.execute(
                    'SELECT id FROM distributors WHERE profile_id = ?',
                    [user.id]
                );
                distributorId = distRows.length > 0 ? distRows[0].id : null;
            }

            // Access Control: sender must be either the client vendor or the assigned distributor
            const isClient = order.vendor_id === user.id;
            const isAssignedDistributor = distributorId && order.distributor_id === distributorId;

            if (!isClient && !isAssignedDistributor && user.role !== 'admin') {
                await connection.rollback();
                return res.status(403).json({ error: 'Access denied to this order conversation' });
            }

            const senderRole = isClient ? 'vendor' : (isAssignedDistributor ? 'distributor' : user.role);

            // 2. If a docket ID is shared, update the order. It is the distributor's
            //    to give; the franchise could otherwise overwrite it from the chat.
            if (docketId && !isAssignedDistributor && user.role !== 'admin') {
                await connection.rollback();
                return res.status(403).json({ error: 'Only the distributor can share the docket number' });
            }
            if (docketId) {
                await connection.execute(
                    'UPDATE store_orders SET docket_id = ? WHERE id = ?',
                    [docketId, id]
                );

                // Insert a system message about the Docket ID
                const systemMessageId = uuidv4();
                const systemText = `docket shared: ${docketId}`;
                await connection.execute(
                    `INSERT INTO store_order_messages (id, order_id, sender_id, sender_role, message_text, is_system)
                     VALUES (?, ?, ?, ?, ?, true)`,
                    [systemMessageId, id, user.id, senderRole, systemText]
                );
            }

            // 3. Insert user's chat message if messageText or attachment is present
            let chatMessage = null;
            if (messageText || attachmentUrl) {
                const messageId = uuidv4();
                await connection.execute(
                    `INSERT INTO store_order_messages (id, order_id, sender_id, sender_role, message_text, attachment_url, attachment_name, is_system)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [messageId, id, user.id, senderRole, messageText || null, attachmentUrl || null, attachmentName || null, isSystem || false]
                );

                // Fetch the inserted message with sender name to return it
                const [inserted]: any = await connection.execute(
                    `SELECT m.*, p.name as sender_name 
                     FROM store_order_messages m
                     LEFT JOIN profiles p ON m.sender_id = p.id
                     WHERE m.id = ?`,
                    [messageId]
                );
                chatMessage = inserted[0];
            }

            await connection.commit();

            res.status(201).json({
                success: true,
                message: 'Message sent successfully',
                chatMessage,
                docketId: docketId || null
            });

        } catch (error: any) {
            await connection.rollback();
            console.error('Create order message error:', error);
            res.status(500).json({ error: 'Failed to send message' });
        } finally {
            connection.release();
        }
    }
}
