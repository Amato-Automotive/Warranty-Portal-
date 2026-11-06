/*
 * The invoice reader on real distributor invoices (United Auto, Ludhiana,
 * Sept 2026), with the "Plan Karo Save Karo" series. Item lines only, as
 * pdf.js gives them (columns joined by two spaces).
 *
 * Run: ../server/node_modules/.bin/tsx --test tests/invoiceReader.test.mts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchInvoice } from "../src/lib/invoiceReader.ts";

const SERIES = [
    { id: "amaze", name: "Amaze Series", points: 0.5 }, { id: "sportz", name: "Sportz Series", points: 2 },
    { id: "doble", name: "Doble Series", points: 2.5 }, { id: "signature", name: "Signature Series", points: 3.5 },
    { id: "emporio", name: "Emporio Series", points: 3.5 }, { id: "umax_arrow", name: "U Max Arrow", points: 1 },
    { id: "umax_premium", name: "U Max Premium", points: 2.5 },
];
const read = (text: string) =>
    Object.fromEntries(matchInvoice(text, SERIES).map(l => [l.product_id, l.qty]));

test("only the scheme's series count; other ranges on the invoice are ignored", () => {
    assert.deepEqual(read([
        "TAX INVOICE",
        "1  CHEER PERFO COLA  87089900  18 %  1 SET  8,093.00  SET  8,093.00",
        "2  U-SPORTZ OE SILVER /C.  87089900  18 %  1 SET  7,458.00  SET  7,458.00",
        "3  D3 PERFO SILVER /BLACK  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "4  CHEER PERFO BLACK  87089900  18 %  1 SET  8,093.00  SET  8,093.00",
        "Total  4 SET  35,550.00",
    ].join("\n")), { sportz: 1 });
});

test("the e-Way Bill page that repeats every line is not counted again", () => {
    assert.deepEqual(read([
        "TAX INVOICE",
        "1  AMAZE DUO PLUS SILVER  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "2  Q2 SILVER /BLACK SONET IH SAB  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "6  AMAZE PLUS BLACK SWIFT 11  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "TAX INVOICE(Page 2)",
        "21  U-MAX ARROW BLACK/BLACK  87089900  18 %  1 SET  6,186.00  SET  6,186.00",
        "e-Way Bill  e-Way Bill",
        "1. e-Way Bill Details",
        "87089900  AMAZE DUO PLUS SILVER /BLACK SONET IH SAB  1  SET  6,483.00  9+9",
        "87089900  AMAZE PLUS BLACK SWIFT 11 W/O ABF  1  SET  6,483.00  9+9",
        "87089900  U-MAX ARROW BLACK/BLACK CRYSTA/ FORTUNER ATM  1  SET  6,186.00  9+9",
    ].join("\n")), { amaze: 2, umax_arrow: 1 });
});

test("a line naming two series counts as the one named last", () => {
    assert.deepEqual(read([
        "TAX INVOICE",
        "5  U-SPORTZ PERFO SIGNATURE  87089900  18 %  1 SET  10,890.00  SET  10,890.00",
        "10  SIGNATURE SWED DOBLE  87089900  18 %  1 SET  7,797.00  SET  7,797.00",
        "3  SIGNATURE LE EMPORIO  87089900  18 %  1 SET  10,381.00  SET  10,381.00",
        "5  U-SPORTZ OE EMPORIO  87089900  18 %  1 SET  10,381.00  SET  10,381.00",
        "4  DOBLE ARO LINE BLACK  87089900  18 %  1 SET  7,797.00  SET  7,797.00",
        "2  U-SPORTZ OE SILVER /C.  87089900  18 %  2 SET  7,458.00  SET  14,916.00",
    ].join("\n")), { signature: 1, doble: 2, emporio: 2, sportz: 2 });
});

test("quantities come from the SET column, not the serial number or prices", () => {
    assert.deepEqual(read([
        "TAX INVOICE",
        "1  S PERFO SIGNATURE SILVER  87089900  18 %  1 SET  8,771.00  SET  8,771.00",
        "3  D3 PERFO S.BROWN/BLACK  87089900  18 %  3 SET  6,483.00  SET  19,449.00",
        "12  U-MAX ARROW SILVER C.  87089900  18 %  3 SET  4,958.00  SET  14,874.00",
        "14  ST.COVER UNISTICH  87089900  18 %  25 PCS  373.00  PCS  9,325.00",
    ].join("\n")), { signature: 1, umax_arrow: 3 });
});

test("a number from a header or address is not counted as an invoice quantity", () => {
    const text = [
        "TAX INVOICE",
        "D3 445",
        "1  D3 PERFO S.BROWN/BLACK  87089900  18 %  2 SET  6,483.00  SET  12,966.00",
    ].join("\n");
    assert.deepEqual(Object.fromEntries(matchInvoice(text, [{ id: "d3", name: "D3", points: 1 }]).map(l => [l.product_id, l.qty])), { d3: 2 });
});

test("only the exact series word is sure; a near-spelling (a photo's OCR) is marked to check", () => {
    const lines = matchInvoice([
        "TAX INVOICE",
        "1  AMAZE PLUS BLACK SWIFT 11  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "2  SIGNATUR SWIFT  87089900  18 %  1 SET  8,771.00  SET  8,771.00",
    ].join("\n"), SERIES);
    assert.equal(lines.find(l => l.product_id === "amaze")?.confidence, "sure");
    assert.equal(lines.find(l => l.product_id === "signature")?.confidence, "check");
});

/* Names as admins pick them: warranty products, catalogue products, typed by hand. */
const PICKED = [
    { id: "vector", name: "VECTOR (SIGNATURE)", points: 3 },
    { id: "uarrow_emporio", name: "U-ARROW (EMPORIO)", points: 3 },
    { id: "d5", name: "D5 Artificial Leather Seat Covers", points: 1 },
    { id: "umax_arrow", name: "U Max Arrow", points: 1 },
    { id: "umax_plus", name: "U Max Arrow Plus 2D", points: 2 },
    { id: "usports", name: "U-Sports (Series)", points: 2 },
    { id: "amaze", name: "Amaze Series", points: 0.5 },
];
const readPicked = (text: string) => Object.fromEntries(matchInvoice(text, PICKED).map(l => [l.product_id, `${l.qty} ${l.confidence}`]));

test("any product the admin picked is read by its key words, in order", () => {
    assert.deepEqual(readPicked([
        "TAX INVOICE",
        "1  VECTOR SIGNATURE BLACK CRETA  87089900  18 %  2 SET  9,000.00  SET  18,000.00",
        "2  U-ARROW EMPORIO TAN XUV 7XO  87089900  18 %  1 SET  10,381.00  SET  10,381.00",
        "3  D5 PERFO BLACK SWIFT 14  87089900  18 %  3 SET  6,483.00  SET  19,449.00",
        "4  Q2 SILVER /BLACK SONET IH SAB  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
        "5  AMAZE PLUS BLACK SWIFT 11  87089900  18 %  1 SET  6,483.00  SET  6,483.00",
    ].join("\n")), { vector: "2 sure", uarrow_emporio: "1 sure", d5: "3 sure", amaze: "1 sure" });
});

test("the most specific product wins: U Max Arrow Plus 2D over U Max Arrow", () => {
    assert.deepEqual(readPicked([
        "TAX INVOICE",
        "1  U-MAX ARROW PLUS 2D BLACK  87089900  18 %  1 SET  5,500.00  SET  5,500.00",
        "2  U-MAX ARROW SILVER C.  87089900  18 %  2 SET  4,958.00  SET  9,916.00",
    ].join("\n")), { umax_plus: "1 sure", umax_arrow: "2 sure" });
});

test("a name spelt differently on the invoice is read but marked to check", () => {
    assert.deepEqual(readPicked([
        "TAX INVOICE",
        "2  U-SPORTZ OE SILVER /C.  87089900  18 %  1 SET  7,458.00  SET  7,458.00",
    ].join("\n")), { usports: "1 check" });
});
