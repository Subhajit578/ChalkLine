import { test } from "node:test";
import assert from "node:assert/strict";
import { readDimensions, sniffImageType } from "./imageSize";

// a real 1x1 PNG
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64"
);

test("the type is read from the bytes, not from what the uploader said", () => {
  assert.equal(sniffImageType(PNG), "image/png");
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a\x01\x00\x01\x00", "latin1")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("RIFF\x00\x00\x00\x00WEBPVP8 ", "latin1")), "image/webp");
});

test("anything that is not one of the four formats is refused", () => {
  assert.equal(sniffImageType(Buffer.from("<script>alert(1)</script>")), null);
  assert.equal(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>")), null);
  assert.equal(sniffImageType(Buffer.from("%PDF-1.7")), null);
  assert.equal(sniffImageType(Buffer.alloc(0)), null);
  // a RIFF container that is not WebP (a WAV file)
  assert.equal(sniffImageType(Buffer.from("RIFF\x00\x00\x00\x00WAVEfmt ", "latin1")), null);
});

test("dimensions come from the header, with trailing bytes ignored", () => {
  assert.deepEqual(readDimensions(PNG), { width: 1, height: 1 });
  assert.deepEqual(readDimensions(Buffer.concat([PNG, Buffer.from("junk")])), { width: 1, height: 1 });
  assert.equal(readDimensions(Buffer.from("not an image at all")), null);
});
