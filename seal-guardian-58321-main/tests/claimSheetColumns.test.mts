import { test } from "node:test";
import assert from "node:assert/strict";
import { CLAIM_COLUMNS, DEFAULT_CLAIM_COLUMNS, moveColumn, parseClaimColumns } from "../src/lib/claimSheetColumns.ts";

test("nothing saved, or something unreadable, is the original order", () => {
    assert.deepEqual(parseClaimColumns(undefined), DEFAULT_CLAIM_COLUMNS);
    assert.deepEqual(parseClaimColumns("not json"), DEFAULT_CLAIM_COLUMNS);
    assert.deepEqual(parseClaimColumns('{"a":1}'), DEFAULT_CLAIM_COLUMNS);
    assert.deepEqual(parseClaimColumns("[]"), DEFAULT_CLAIM_COLUMNS);
});

test("the saved order is kept, and a column left out is hidden", () => {
    assert.deepEqual(parseClaimColumns('["claim_no","customer","phone"]'), ["claim_no", "customer", "phone"]);
});

test("unknown and repeated keys are dropped", () => {
    assert.deepEqual(parseClaimColumns('["phone","bogus","phone","date"]'), ["phone", "date"]);
    assert.deepEqual(parseClaimColumns('["bogus"]'), DEFAULT_CLAIM_COLUMNS);
});

test("the default order is the sheet as it was", () => {
    assert.deepEqual(CLAIM_COLUMNS.map(c => c.label).slice(0, 4), ["S.No.", "Status", "Claim no.", "Date"]);
    assert.equal(new Set(DEFAULT_CLAIM_COLUMNS).size, DEFAULT_CLAIM_COLUMNS.length);
});

test("moving a column swaps it with its neighbour and stops at the ends", () => {
    assert.deepEqual(moveColumn(["a", "b", "c"], 1, -1), ["b", "a", "c"]);
    assert.deepEqual(moveColumn(["a", "b", "c"], 1, 1), ["a", "c", "b"]);
    assert.deepEqual(moveColumn(["a", "b", "c"], 0, -1), ["a", "b", "c"]);
    assert.deepEqual(moveColumn(["a", "b", "c"], 2, 1), ["a", "b", "c"]);
});
