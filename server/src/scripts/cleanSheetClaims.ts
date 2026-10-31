/**
 * Removes every claim brought in from the production sheet, before the live
 * sheets (Claims › Sheet sync) bring them in again.
 *
 *   npx tsx src/scripts/cleanSheetClaims.ts            what it would remove; writes nothing
 *   npx tsx src/scripts/cleanSheetClaims.ts --apply    removes them
 *
 * Claims raised in the portal are never touched. When no claim is left, claim
 * numbers start again at WC-0001.
 */
import db from '../config/database.js';

const apply = process.argv.includes('--apply');

const [[sheet]]: any = await db.execute(`SELECT COUNT(*) AS n, MIN(claim_no) AS first, MAX(claim_no) AS last FROM warranty_claims WHERE raised_via = 'sheet'`);
const [[portal]]: any = await db.execute(`SELECT COUNT(*) AS n FROM warranty_claims WHERE raised_via <> 'sheet'`);
console.log(`Sheet claims: ${sheet.n}${sheet.n ? ` (${sheet.first} … ${sheet.last})` : ''} · portal claims, kept: ${portal.n}`);
console.log(Number(portal.n) === 0 ? 'No claim will be left, so numbers restart at WC-0001.' : 'Portal claims remain, so numbers carry on.');

if (!apply) { console.log('\nDry run: nothing removed. Run with --apply to remove.'); process.exit(0); }

const [r]: any = await db.execute(`DELETE FROM warranty_claims WHERE raised_via = 'sheet'`);
const [[left]]: any = await db.execute('SELECT COUNT(*) AS n FROM warranty_claims');
if (Number(left.n) === 0) await db.query('ALTER TABLE warranty_claims AUTO_INCREMENT = 1');
console.log(`\nRemoved ${r.affectedRows} sheet claims.${Number(left.n) === 0 ? ' Numbers restart at WC-0001.' : ''}`);
process.exit(0);
