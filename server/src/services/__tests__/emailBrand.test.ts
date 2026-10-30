import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandMail, toAutoCruze, withEmailBrand } from '../emailBrand.js';

const AF_LOGO = 'https://res.cloudinary.com/dmwt4rg4m/image/upload/v1765531503/warranty-portal/autoform-logo.png';
const AC_LOGO = 'https://api.example/uploads/brand-logos/autocruze-logo.png';

test('an AutoCruze email gets its logo and words; the © line keeps the company name', () => {
    const html = `<img src="${AF_LOGO}" alt="Autoform India" /><p>Go to the Autoform Warranty Portal.</p><p>Best regards,<br>Autoform India Team</p><p>© 2026 Autoform India. All rights reserved.</p>`;
    const out = toAutoCruze(html, AC_LOGO);
    assert.ok(out.includes(`src="${AC_LOGO}"`) && out.includes('alt="AutoCruze"'));
    assert.ok(out.includes('AutoCruze Warranty Portal') && out.includes('AutoCruze Team'));
    assert.ok(out.includes('© 2026 Autoform India. All rights reserved.'));
    assert.equal(toAutoCruze('Grievance Registered - G1 | Autoform India', AC_LOGO), 'Grievance Registered - G1 | AutoCruze');
});

test('only AC changes an email; Autoform, both brands and no brand send it as it is', async () => {
    const mail = { subject: 'Welcome to Autoform India', html: '<p>Autoform India Team</p>' };
    assert.deepEqual(await withEmailBrand('AC', async () => brandMail(mail, AC_LOGO)), { subject: 'Welcome to AutoCruze', html: '<p>AutoCruze Team</p>', text: undefined });
    for (const b of ['AF', 'AFAC', null, undefined]) assert.equal(await withEmailBrand(b, async () => brandMail(mail, AC_LOGO)), mail);
    assert.equal(brandMail(mail, AC_LOGO), mail);
});
