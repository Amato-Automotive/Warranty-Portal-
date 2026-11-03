import { test } from "node:test";
import assert from "node:assert/strict";
import { kindOf, readSets } from "../src/lib/buyMoreReader.ts";

test("a product's kind is the premium word named last, else other", () => {
    assert.equal(kindOf("VELORA 2 ROW"), "velora");
    assert.equal(kindOf("Signature Swed Doble"), "doble");
    assert.equal(kindOf("U-Sports (Emporio)"), "emporio");
    assert.equal(kindOf("D3"), "other");
    assert.equal(kindOf("AMAZE DUO +"), "other");
});

test("an invoice's lines become sets of each kind", () => {
    const text = [
        "Tax Invoice",
        "1 VELORA SEAT COVER 4 Pcs 2500.00 10000.00",
        "2 ARROW LINE (DOBLE) 1 Pcs 3000.00 3000.00",
        "3 U-Sports (Signature) 1 Pcs 3500.00 3500.00",
        "4 U-Sports (Emporio) 1 Pcs 4000.00 4000.00",
        "5 D3 5 Pcs 2000.00 10000.00",
        "Authorised Signatory",
    ].join("\n");
    const r = readSets(text, ["D3", "ARROW LINE (DOBLE)", "U-Sports (Signature)", "U-Sports (Emporio)"]);
    assert.deepEqual(r.sets, { velora: 4, doble: 1, signature: 1, emporio: 1, other: 5 });
});

test("an e-Way Bill page repeating the lines is not counted again", () => {
    const text = ["Tax Invoice", "1 VELORA 4 Pcs 2500.00", "e-Way Bill", "1 VELORA 4 Pcs 2500.00"].join("\n");
    assert.equal(readSets(text, []).sets.velora, 4);
});

test("nothing recognised leaves every kind at zero", () => {
    assert.deepEqual(readSets("Tax Invoice\nFreight charges 200", []).sets, { velora: 0, doble: 0, signature: 0, emporio: 0, other: 0 });
});
