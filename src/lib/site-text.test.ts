// Run: npx tsx --test src/lib/site-text.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { isSafeHref, linkifyLine, parseSiteText, plainExcerpt } from "./site-text";

const links = (s: string) => linkifyLine(s).filter((n) => n.type === "link") as { href: string; label: string }[];

test("paragraphs split on blank lines, single newlines kept", () => {
  const p = parseSiteText("one\ntwo\n\n\n  \nthree\r\n\r\nfour");
  assert.equal(p.length, 3);
  assert.deepEqual(p[0], [{ type: "text", value: "one\ntwo" }]);
  assert.equal(parseSiteText("").length, 0);
  assert.equal(parseSiteText(null).length, 0);
  assert.equal(parseSiteText("  \n\n ").length, 0);
});

test("script tags stay text (React escapes them)", () => {
  const n = linkifyLine("<script>alert(1)</script> <img src=x onerror=alert(1)>");
  assert.equal(n.length, 1);
  assert.equal(n[0].type, "text");
  assert.ok((n[0] as { value: string }).value.includes("<script>"));
});

test("javascript:, data:, vbscript: and file: are never linked", () => {
  for (const s of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,<script>1</script>", "vbscript:x", "file:///etc/passwd", "//evil.com", "ftp://x.com/a"]) {
    assert.deepEqual(links(s), [], s);
  }
  assert.equal(isSafeHref("javascript:alert(1)"), false);
  assert.equal(isSafeHref("  javascript:alert(1)"), false);
  assert.equal(isSafeHref("java\nscript:alert(1)"), false);
  assert.equal(isSafeHref("http://"), false);
  assert.equal(isSafeHref("https://ok.org/a?b=1"), true);
  assert.equal(isSafeHref("mailto:a@b.org"), true);
  assert.equal(isSafeHref("https://x.org/\"onclick=1"), false);
});

test("a link inside a javascript-looking string is still only http(s)", () => {
  const l = links("javascript:alert('x') https://ok.org/p");
  assert.equal(l.length, 1);
  assert.equal(l[0].href, "https://ok.org/p");
});

test('double quotes end a URL: no attribute breakout', () => {
  const n = linkifyLine('see https://a.com/x"onmouseover="alert(1) now');
  const l = n.filter((x) => x.type === "link") as { href: string }[];
  assert.equal(l.length, 1);
  assert.equal(l[0].href, "https://a.com/x");
  assert.ok(!l[0].href.includes('"'));
  const t = n.filter((x) => x.type === "text").map((x) => (x as { value: string }).value).join("");
  assert.ok(t.includes('"onmouseover='));
});

test("angle brackets and single quotes end a URL", () => {
  assert.equal(links("<https://a.com/x>")[0].href, "https://a.com/x");
  assert.equal(links("https://a.com/x'y")[0].href, "https://a.com/x");
  assert.equal(links("https://a.com/x<script>")[0].href, "https://a.com/x");
});

test("trailing punctuation is not part of the link", () => {
  assert.equal(links("Visit https://a.com.")[0].href, "https://a.com");
  assert.equal(links("Visit https://a.com/x, then")[0].href, "https://a.com/x");
  assert.equal(links("(see https://a.com/x)")[0].href, "https://a.com/x");
  assert.equal(links("is it https://a.com/x?!")[0].href, "https://a.com/x");
  assert.equal(links("https://a.com/x;")[0].href, "https://a.com/x");
  assert.equal(links("https://en.wikipedia.org/wiki/Foo_(bar)")[0].href, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(links("(https://en.wikipedia.org/wiki/Foo_(bar))")[0].href, "https://en.wikipedia.org/wiki/Foo_(bar)");
  assert.equal(links("https://a.com/q?x=1&y=2")[0].href, "https://a.com/q?x=1&y=2");
  const n = linkifyLine("go https://a.com.");
  assert.deepEqual(n[n.length - 1], { type: "text", value: "." });
});

test("emails become mailto links; trailing dot excluded", () => {
  const l = links("Write coach@team.org.");
  assert.equal(l[0].href, "mailto:coach@team.org");
  assert.equal(l[0].label, "coach@team.org");
  assert.equal(links("mailto:a@b.org")[0].href, "mailto:a@b.org");
});

test("surrounding text is preserved exactly", () => {
  const src = "a https://x.org b\nc";
  const rebuilt = linkifyLine(src).map((n) => (n.type === "text" ? n.value : n.label)).join("");
  assert.equal(rebuilt, src);
});

test("html entities and markdown are not interpreted", () => {
  const n = linkifyLine("**bold** [x](javascript:alert(1)) &lt;b&gt;");
  assert.equal(n.length, 1);
  assert.equal(n[0].type, "text");
  assert.equal((n[0] as { value: string }).value, "**bold** [x](javascript:alert(1)) &lt;b&gt;");
});

test("markdown-style link with an http url keeps only the bare url", () => {
  const l = links("[x](https://a.com/p)");
  assert.equal(l[0].href, "https://a.com/p");
});

test("plainExcerpt collapses and truncates", () => {
  assert.equal(plainExcerpt("a\n\n b   c"), "a b c");
  assert.equal(plainExcerpt("x".repeat(300), 50).length, 50);
  assert.equal(plainExcerpt(null), "");
});
