import db from '../config/database.js';

async function fixAniruddhaWarranty() {
  try {
    const uid = '26041302432620';
    const correctManpowerName = 'Aniruddha Gawade';
    const correctManpowerId = '0c38984d-ef20-4254-bbb0-dd5b1ab676b8';
    const correctStoreEmail = 'cardynamic@outlook.com';

    console.log(`--- BRINGING ENTRY ${uid} TO CORRECT FLOW ---`);
    console.log(`Setting Installer to: ${correctManpowerName}`);
    console.log(`Setting Store Email to: ${correctStoreEmail}`);
    
    const [result]: any = await db.execute(
      'UPDATE warranty_registrations SET installer_name = ?, installer_contact = ?, manpower_id = ? WHERE uid = ?',
      [correctManpowerName, correctStoreEmail, correctManpowerId, uid]
    );

    if (result.affectedRows > 0) {
      console.log('✅ Entry updated successfully with Aniruddha Gawade as the installer.');
    } else {
      console.error('❌ Update failed.');
    }

    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

fixAniruddhaWarranty();
