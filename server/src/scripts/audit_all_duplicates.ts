import db from '../config/database.js';

async function auditAllDuplicates() {
  try {
    console.log('--- COMPREHENSIVE STORE OVERLAP AUDIT ---');

    // 1. Find all stores with duplicate names
    const [duplicateStoreNames]: any = await db.execute(`
      SELECT store_name, COUNT(*) as count 
      FROM vendor_details 
      GROUP BY store_name 
      HAVING count > 1
    `);

    if (duplicateStoreNames.length === 0) {
      console.log('No stores with duplicate names found.');
      process.exit(0);
    }

    for (const entry of duplicateStoreNames) {
      const name = entry.store_name;
      console.log(`\n🏪 STORE NAME: "${name}" (${entry.count} locations)`);

      // 2. Get details for each store instance
      const [shops]: any = await db.execute(`
        SELECT id, city, store_email 
        FROM vendor_details 
        WHERE store_name = ?
      `, [name]);

      for (const shop of shops) {
        // 3. Count warranties correctly mapped (by Name + Email)
        const [correctCount]: any = await db.execute(`
          SELECT COUNT(*) as count 
          FROM warranty_registrations 
          WHERE (installer_name = ? AND installer_contact = ?)
        `, [name, shop.store_email]);

        // 4. Also check for manpower matches
        const [manpowerCount]: any = await db.execute(`
          SELECT COUNT(*) as count 
          FROM warranty_registrations wr
          JOIN manpower m ON wr.manpower_id = m.id
          WHERE m.vendor_id = ?
        `, [shop.id]);

        const uniqueCount = correctCount[0].count + manpowerCount[0].count;

        console.log(`   📍 Location: ${shop.city.padEnd(15)} | Email: ${shop.store_email.padEnd(30)} | Warranties: ${uniqueCount}`);
      }

      // 5. Check for "Shared" warranties (Name matches but Email doesn't match any of these stores or is garbage)
      const storeEmails = shops.map((s: any) => s.store_email);
      if (storeEmails.length > 0) {
        const placeholders = storeEmails.map(() => '?').join(',');
        const [orphans]: any = await db.execute(`
          SELECT COUNT(*) as count 
          FROM warranty_registrations 
          WHERE installer_name = ? 
          AND installer_contact NOT IN (${placeholders})
          AND manpower_id IS NULL
        `, [name, ...storeEmails]);

        if (orphans[0].count > 0) {
           console.log(`   ⚠️ WARN: Found ${orphans[0].count} warranties with name "${name}" that don't match any known store emails.`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

auditAllDuplicates();
