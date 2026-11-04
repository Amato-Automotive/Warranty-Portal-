import db from './config/database.js';

async function runAudit() {
  try {
    console.log('--- STARTING DATABASE AUDIT ---');

    // 1. Check for duplicate store names
    const [duplicateStores]: any = await db.execute(`
      SELECT store_name, COUNT(*) as count 
      FROM vendor_details 
      GROUP BY store_name 
      HAVING count > 1
    `);
    
    console.log('\n[1] DUPLICATE STORE NAMES (These cause mapping conflicts):');
    if (duplicateStores.length === 0) {
      console.log('None found.');
    } else {
      for (const store of duplicateStores) {
        console.log(`- "${store.store_name}": ${store.count} instances`);
        const [details]: any = await db.execute(`
          SELECT id, city, state, user_id FROM vendor_details WHERE store_name = ?
        `, [store.store_name]);
        console.table(details);
      }
    }

    // 2. Check for duplicate UIDs in warranty_registrations
    const [duplicateUIDs]: any = await db.execute(`
      SELECT uid, COUNT(*) as count 
      FROM warranty_registrations 
      WHERE uid IS NOT NULL AND uid != ''
      GROUP BY uid 
      HAVING count > 1
    `);

    console.log('\n[2] DUPLICATE UIDs IN WARRANTY REGISTRATIONS:');
    if (duplicateUIDs.length === 0) {
      console.log('None found.');
    } else {
      console.log(`Total UIDs with duplicates: ${duplicateUIDs.length}`);
      for (const row of duplicateUIDs.slice(0, 50)) { // Show more for checking
         console.log(`- UID "${row.uid}": ${row.count} entries`);
      }
      if (duplicateUIDs.length > 50) console.log('... and more.');
    }

    // 3. Check for UID usage inconsistency
    const [uidInconsistency]: any = await db.execute(`
      SELECT w.uid, w.customer_name, w.created_at
      FROM warranty_registrations w
      LEFT JOIN pre_generated_uids p ON w.uid = p.uid
      WHERE w.product_type = 'seat-cover' 
      AND (p.uid IS NULL OR (p.is_used = 0 AND w.status != 'rejected' AND w.status != 'pending_vendor'))
      LIMIT 10
    `);

    console.log('\n[3] SEAT-COVER UIDs NOT PROPERLY MARKED AS USED IN PRE_GENERATED_UIDS:');
    console.log(`Sample inconsistent records (Total pending/validated registrations without marked UID):`);
    console.table(uidInconsistency);

    process.exit(0);
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

runAudit();
