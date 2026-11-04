import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("Russian and English have matching strings and placeholders", async () => {
  const strings = JSON.parse(
    await readFile(
      new URL("../app/ui/translations.json", import.meta.url),
      "utf8",
    ),
  );
  assert.deepEqual(
    Object.keys(strings.en).sort(),
    Object.keys(strings.ru).sort(),
  );
  assert.equal(
    Object.values(strings.ru).some((value) => /\?{3}/.test(value)),
    false,
  );
  for (const key of Object.keys(strings.en))
    assert.deepEqual(
      (strings.en[key].match(/\{\w+\}/g) || []).sort(),
      (strings.ru[key].match(/\{\w+\}/g) || []).sort(),
      key,
    );
});
