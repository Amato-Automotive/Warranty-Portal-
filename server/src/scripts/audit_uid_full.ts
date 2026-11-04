import db from '../config/database.js';

async function auditUID(uid: string) {
  try {
    console.log(`--- AUDITING UID: ${uid} ---`);
    
    const [rows]: any = await db.execute('SELECT product_details FROM warranty_registrations WHERE uid = "26041302432620"');
    if (rows.length > 0) {
      let details = JSON.parse(rows[0].product_details);
      details.storeName = 'CAR DYNAMIC PVT LTD';
      details.storeEmail = 'cardynamic@outlook.com';
      details.manpowerName = 'Aniruddha Gawade';
      details.manpowerId = '0c38984d-ef20-4254-bbb0-dd5b1ab676b8';
      await db.execute('UPDATE warranty_registrations SET product_details = ? WHERE uid = "26041302432620"', [JSON.stringify(details)]);
      console.log('✅ product_details JSON Updated');
    }
    
    // 2. Check resubmissions
    const [resubRows]: any = await db.execute('SELECT * FROM warranty_resubmissions WHERE original_uid = ?', [uid]);
    console.log('--- RESUBMISSIONS ---');
    console.table(resubRows);
    
    // 3. Check pool
    const [poolRows]: any = await db.execute('SELECT * FROM pre_generated_uids WHERE uid = ?', [uid]);
    console.log('--- UID POOL ---');
    console.table(poolRows);
    
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

const targetUID = '26041302432620';
auditUID(targetUID);
