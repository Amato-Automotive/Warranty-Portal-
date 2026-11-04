import db from './config/database.js';

const uids = [
  '26031702425021',
  '26030702422086',
  '26020402414424',
  '26012102410007'
];

async function checkMappings() {
  try {
    console.log('--- UID MAPPING AUDIT ---');

    for (const uid of uids) {
      console.log(`\nChecking UID: ${uid}`);
      
      const [rows]: any = await db.execute(`
        SELECT 
          w.uid, 
          w.customer_name, 
          w.installer_name, 
          w.manpower_id, 
          w.user_id,
          w.status,
          m.name as manpower_name,
          vd.city as store_city,
          vd.id as vendor_id
        FROM warranty_registrations w
        LEFT JOIN manpower m ON w.manpower_id = m.id
        LEFT JOIN vendor_details vd ON w.installer_name = vd.store_name
        WHERE w.uid = ?
      `, [uid]);

      if (rows.length === 0) {
        console.log('  -> No registration found for this UID.');
      } else {
        console.log(`  Customer: ${rows[0].customer_name}`);
        console.log(`  Status: ${rows[0].status}`);
        console.log(`  Installer (Store Name): ${rows[0].installer_name}`);
        console.log(`  Manpower: ${rows[0].manpower_name || 'N/A'} (ID: ${rows[0].manpower_id || 'N/A'})`);
        
        // Find cities associated with this store name
        const uniqueStores = rows.reduce((acc: any[], curr: any) => {
            if (curr.store_city && !acc.find(s => s.city === curr.store_city)) {
                acc.push({ city: curr.store_city, id: curr.vendor_id });
            }
            return acc;
        }, []);

        console.log(`  Associated Store Cities: ${uniqueStores.map((s: any) => s.city).join(', ') || 'None found in vendor_details'}`);
        
        if (uniqueStores.length > 1) {
           console.log(`  ⚠️ ALERT: This UID's Store Name matches ${uniqueStores.length} different store locations!`);
           uniqueStores.forEach((s: any, idx: number) => {
             console.log(`    - Location ${idx + 1}: ${s.city} (Vendor ID: ${s.id})`);
           });
           console.log(`  -> ANY of these stores will see this warranty in their dashboard.`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('Audit failed:', error);
    process.exit(1);
  }
}

checkMappings();
