import test from "node:test";
import assert from "node:assert/strict";
import { REJECTION_REASONS, rejectionLetter, splitRejectionNote } from "../src/lib/rejectionReasons.ts";

test("there are four reasons, in the order head office gave them", () => {
    assert.deepEqual(REJECTION_REASONS.map(r => r.label), [
        "Billed at the old dealer price", "One Nation One Franchisee Programme", "Plan Karo Save Karo Programme", "Urgent Sets billed at old pricing",
    ]);
});

test("each letter has the opening, its own reason and the closing", () => {
    REJECTION_REASONS.forEach((r, i) => {
        const text = rejectionLetter(i);
        assert.ok(text.startsWith("Dear Franchisee Partner,"));
        assert.ok(text.includes("Reason for Rejection:"));
        for (const line of r.body) assert.ok(text.includes(line));
        assert.ok(text.endsWith("Thanks & Regards\nTeam AFAC"));
        assert.ok(text.length < 3000);
    });
});

test("a saved letter splits into its reason; a hand-written note does not", () => {
    const s = splitRejectionNote(rejectionLetter(1));
    assert.equal(s.isLetter, true);
    assert.ok(s.reason.startsWith("Reason for Rejection:"));
    assert.ok(s.reason.includes("One Nation One Franchisee Programme"));
    assert.ok(!s.reason.includes("We sincerely value"));
    assert.ok(s.before.endsWith("could not be approved for additional company purchase benefits."));
    assert.ok(s.after.startsWith("Please note that this rejection applies only"));
    assert.equal(`${s.before}

${s.reason}

${s.after}`, rejectionLetter(1));
    assert.deepEqual(splitRejectionNote("Invoice is blurry"), { isLetter: false, before: "", reason: "Invoice is blurry", after: "" });
});
