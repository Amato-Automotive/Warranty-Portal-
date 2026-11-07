import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, readSets } from "../src/lib/buyMoreReader.ts";

test("a product's kind is the premium word named last, else other", () => {
    assert.equal(kindOf("VELORA 2 ROW"), "velora");
    assert.equal(kindOf("Signature Swed Doble"), "doble");
    assert.equal(kindOf("U-Sports (Emporio)"), "emporio");
    assert.equal(kindOf("Some Unlisted Cover"), "other");
});

test("the team's series list decides a product's kind, whatever its name says", () => {
    assert.equal(kindOf("D3"), "velora");
    assert.equal(kindOf("AMAZE DUO +"), "velora");
    assert.equal(kindOf("u-volt"), "signature");           // case and spacing do not matter
    assert.equal(kindOf("U- VOLT"), "signature");
    assert.equal(kindOf("Riviera (Series)"), "emporio");   // the list wins over the word "Series"
    assert.equal(kindOf("DRIBLE"), "velora");
    assert.equal(kindOf("SPLASH"), "other");               // listed with no series
    assert.equal(kindOf("U-SPORTS (UNICO)"), "other");
});

test("an invoice's lines become sets of each kind", () => {
    const text = [
        "Tax Invoice",
        "1 VELORA SEAT COVER 4 Pcs 2500.00 10000.00",
        "2 ARROW LINE (DOBLE) 1 Pcs 3000.00 3000.00",
        "3 U-Sports (Signature) 1 Pcs 3500.00 3500.00",
        "4 U-Sports (Emporio) 1 Pcs 4000.00 4000.00",
        "5 SPLASH 5 Pcs 2000.00 10000.00",
        "Authorised Signatory",
    ].join("\n");
    const r = readSets(text, ["SPLASH", "ARROW LINE (DOBLE)", "U-Sports (Signature)", "U-Sports (Emporio)"]);
    assert.deepEqual(r.sets, { velora: 4, doble: 1, signature: 1, emporio: 1, other: 5 });
});

test("an e-Way Bill page repeating the lines is not counted again", () => {
    const text = ["Tax Invoice", "1 VELORA 4 Pcs 2500.00", "e-Way Bill", "1 VELORA 4 Pcs 2500.00"].join("\n");
    assert.equal(readSets(text, []).sets.velora, 4);
});

test("nothing recognised leaves every kind at zero", () => {
    assert.deepEqual(readSets("Tax Invoice\nFreight charges 200", []).sets, { velora: 0, doble: 0, signature: 0, emporio: 0, other: 0 });
});

test("a real photographed invoice: rates like 8,093.00 are not quantities and U-MAX is not U-ARROW", () => {
    /* OCR of Ual-7795/26-27 (NU-LOOK CAR ACCESSORIES): the store declared Velora 4, Emporio 2. */
    const text = [
        "| 1/u-mAX ARROW SILVER C.GREY VENUE-25 87089900 | 18 % 1 SET| 4,958.00|SET| 8 %)| 4,561.36 |",
        "| 2/U-MAX ARROW SILVER /BLACK VENUE -25 87089900 | 18 % 2 SET| 4,958.00|SET| 8 %| 9,122.72]",
        "5/U-SPORTZ PERFO EMPORIO NUTMAG 87089900 | 18 % 2 SET| 14,703.00(SET| 8% 27,053.52",
        "6|H-CROSS LT.GREY /BLACK SCORPIO-7 CAP [87089900 | 18 % 1SET| 8,093.00{SET| 8% 7,445.56",
        "7|Q2 G.MEG /BLACK 1.20 NS 14 W/O ABF 87089900 | 18 % 1SET| 6,462.00/SET| 8% 5,945.04",
        "8/Q2 V.SILVER C.GREY VENUE NS IH 25 SAB 87089900 | 18 % 1SET| 6,462.00|SET| 8% 5,945.04",
        "9|U-MAX ARROW BLACK/BLACK THAR -20 87089900 | 18 % 1SET| 4,958.00({SET| 8% 4,561.36",
        "11/Q2 OFF/WH COLA BOLERO-7 REF W/O ABF (87082900 | 18 % 1SET| 8,093.00(SET| 8% 7,445.56",
    ].join("\n");
    const r = readSets(text, ["U-ARROW", "H-CROSS", "Q2", "U-Sports (Emporio)"]);
    assert.deepEqual(r.sets, { velora: 4, doble: 0, signature: 0, emporio: 2, other: 0 });
});

test("units written as sts, PCS. and fused 1SET are all read as quantities", () => {
    const names = ["Q2", "HAMMER", "Doble"];
    assert.equal(readSets("1  Q2 Black Venue  87089900  3 sts  7,624.99  6,461.86  sts  19,385.58", names).sets.velora, 3);
    assert.equal(readSets("3  HYRYDER DOBLE  87089900  18 %  2 PCS.  7,644.07  PCS.  15,288.14", names).sets.doble, 2);
    assert.equal(readSets("4  HAMMER  87089900  18 %  5SET  4,996.00  SET  24,980.00", names).sets.velora, 5);
});

test("a name written without its U- is still found, but flagged to check; U-MAX is not U-ARROW", () => {
    const names = ["U-FOCUS", "U-CREST", "U-ARROW"];
    const focus = readSets("7  S/C Focus 2 Row  87089900  8 pcs  7,624.99  6,461.86  pcs  51,694.88", names);
    assert.equal(focus.sets.velora, 8);
    assert.deepEqual(focus.check, ["velora"]);
    assert.equal(readSets("1  U-MAX ARROW BLACK/BLACK  87089900  18 %  1 SET  6,186.00  SET  6,186.00", names).sets.velora, 0);
    assert.equal(readSets("1  AF CIAZ MAX ARROW BEIGE  87089900  18 %  1 SET  4,996.00  SET  4,996.00", names).sets.velora, 0);
});

test("a line that names Emporio is Emporio even when it matched a plainer product", () => {
    const names = ["U-FOCUS", "U-FOCUS (EMPORIO)"];
    const r = readSets("1  U-Focus Perfo Emporio Red  87089900  1 sts  12,226.00  sts  10,361.02\n2  U-Focus Black Swift  87089900  2 sts  7,624.99  sts  6,461.86", names);
    assert.equal(r.sets.emporio, 1);
    assert.equal(r.sets.velora, 2);
});

test("noisy OCR: '1SET' read as '18ET' is 1, and the discount after SET is never the quantity", () => {
    const names = ["Q2", "H-CROSS"];
    /* From the browser's OCR of a small screenshot of Ual-7795/26-27. */
    const text = [
        "7/Q2 G.MEG /BLACK 1.20 NS 14 W/O ABF 87089900 | 18% 1SET| 6.46200 SET| 8% 5,945.04",
        "11/ Q2 OFF/WH COLA BOLERO-7 REF W/O ABF  |87082800 | 18% 18ET| 8,093.00/SET| 8% 7",
        "6 H-CROSS LT.GREY /BLACK SCORPIO-7 CAP 87089900 | 18% 1SET| 8U93.00(SET| 8%| 7,445.56",
    ].join("\n");
    assert.deepEqual(readSets(text, names).sets, { velora: 3, doble: 0, signature: 0, emporio: 0, other: 0 });
    assert.equal(readSets("1  Q2 Black  87089900  SET  8 %  5,945.04", names).sets.velora, 0);   // no quantity at all: not guessed
});

test("a quantity the line's own amount contradicts is left out, not counted", () => {
    const names = ["Q2"];
    /* OCR read "1 SET" as "41 SET": 41 sets of a 6,462.00 item cannot come to 5,945.04. */
    const r = readSets("8|Q2 V.SILVER C.GREY VENUE NS IH 25 SAB 87089900 | 18 % 41 SET| 6,462.00 SET| 8% 5,945.04", names);
    assert.equal(r.sets.velora, 0);
    assert.equal(r.missed.length, 1);
    /* A genuine multi-set line is kept, and so is one whose prices OCR garbled. */
    assert.equal(readSets("2|Q2 BLACK 87089900 | 18 % 2 SET| 4,958.00 SET| 8 % 9,122.72", names).sets.velora, 2);
    assert.equal(readSets("5|Q2 BLACK 87089900 | 18% 2 SET| 14.703.00(SET. 8% 27,053.52", names).sets.velora, 2);
});

test("goods rows that were not counted are reported; tax-summary rows are not", () => {
    const r = readSets(["1|U-MAX ARROW BLACK/BLACK 87089900 | 18 % 1 SET| 4,958.00 SET| 8% 4,561.36", "87089900  14,988.00  9%  1,348.92  9%  1,348.92  2,697.84"].join("\n"), ["Q2"]);
    assert.equal(r.missed.length, 1);
});
