/* Shared GHRAB browser-only Unicode PDF exporter from Studio 0.21.197 */
/**
 * AI Studio GHRAB: Unicode, searchable, client-only PDF export.
 *
 * Uses embedded Type3 glyphs with explicit ToUnicode maps. No external fonts,
 * network calls, CDN, or public PDF endpoint. The reader can select/search
 * text; PDFs are not asserted to be PDF/UA tagged documents.
 */
const enc = new TextEncoder();
const b = (str) => enc.encode(str);
const escapePdf = (str) => String(str).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/[\r\n]/g, " ");
function concat(chunks) {
  let size = 0;
  for (const chunk of chunks) size += chunk.length;
  const out = new Uint8Array(size);
  let pos = 0;
  for (const chunk of chunks) { out.set(chunk, pos); pos += chunk.length; }
  return out;
}
function hex(value, length = 2) { return value.toString(16).toUpperCase().padStart(length, "0"); }
function unicodeHex(char) {
  let out = "";
  for (let i = 0; i < char.length; i++) out += hex(char.charCodeAt(i), 4);
  return out;
}
function htmlToBlocks(doc, extras = []) {
  const root = doc.querySelector("main") || doc.body;
  if (!root) throw new Error("Manuál nemá obsah.");
  const selector = "h1,h2,h3,h4,p,li,dt,dd,summary,.acc .ans,.mini-step,.stat,.notice,.flow-warning,.flow-danger";
  const blocks = [];
  const ignore = "nav,footer,script,style,.search-overlay,.mobile-nav,.top-actions,.toc,[hidden],[aria-hidden='true']";
  for (const element of root.querySelectorAll(selector)) {
    if (element.closest('body[data-ghrab-access="denied"],body[data-ghrab-access="checking"]')) continue;
    if (element.closest(ignore) || element.closest("button")) continue;
    if (element.matches("p,li,dd") && element.closest(".acc .ans,.notice,.mini-step,.stat,.flow-warning,.flow-danger")) continue;
    const text = (element.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 2) continue;
    let type = /^H[1-4]$/.test(element.tagName) ? element.tagName.toLowerCase() :
      element.matches("summary") ? "h3" : element.matches("li") ? "list" : "body";
    if (element.matches(".notice,.flow-warning,.flow-danger")) type = "warning";
    blocks.push({ type, text });
  }
  for (const extra of extras) {
    if (extra && typeof extra.text === "string" && extra.text.trim())
      blocks.push({ type: extra.type || "body", text: extra.text.trim() });
  }
  const links = new Set();
  for (const anchor of root.querySelectorAll("a[href]")) {
    try {
      const url = new URL(anchor.getAttribute("href"), doc.baseURI);
      if (!["https:", "http:"].includes(url.protocol)) continue;
      if (url.username || url.password || links.has(url.href)) continue;
      links.add(url.href);
      blocks.push({ type: "link", text: (anchor.textContent || url.href).trim() + ": " + url.href, url: url.href });
    } catch { /* invalid link */ }
  }
  return blocks;
}
function makeGlyphCanvas(doc, char, bold) {
  const sample = doc.createElement("canvas");
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  if (!sampleCtx) throw new Error("Prohlížeč neumí vykreslit znaky PDF.");
  const css = (bold ? "bold " : "") + "100px Arial, sans-serif";
  sampleCtx.font = css;
  const m = sampleCtx.measureText(char);
  const ascent = Math.max(1, Math.ceil(m.actualBoundingBoxAscent || 80));
  const descent = Math.max(0, Math.ceil(m.actualBoundingBoxDescent || 23));
  const advance = Math.max(1, m.width);
  const pxWidth = Math.min(260, Math.max(16, Math.ceil(advance + 18)));
  const pxHeight = Math.min(190, ascent + descent + 18);
  sample.width = pxWidth;
  sample.height = pxHeight;
  sampleCtx.font = css;
  sampleCtx.textBaseline = "alphabetic";
  sampleCtx.fillStyle = "#000";
  sampleCtx.fillText(char, 8, 8 + ascent);
  const image = sampleCtx.getImageData(0, 0, pxWidth, pxHeight).data;
  const bytes = [];
  let bit = 7, current = 0;
  for (let row = 0; row < pxHeight; row++) {
    for (let col = 0; col < pxWidth; col++) {
      if (image[(row * pxWidth + col) * 4 + 3] >= 90) current |= 1 << bit;
      if (--bit < 0) { bytes.push(current); bit = 7; current = 0; }
    }
    if (bit !== 7) { bytes.push(current); bit = 7; current = 0; }
  }
  let pixels = "";
  for (const byte of bytes) pixels += hex(byte);
  return {
    width: pxWidth, height: pxHeight, pixels,
    advance: advance * 10,
    left: -80, bottom: -(descent + 8) * 10,
    right: (pxWidth - 8) * 10, top: (ascent + 8) * 10
  };
}
function pdfWriter() {
  const objects = [];
  return {
    add(parts) { objects.push(parts || null); return objects.length; },
    set(id, parts) { objects[id - 1] = parts; },
    finish(root) {
      const out = [b("%PDF-1.4\n% GHRAB unicode PDF\n")], offsets = [0];
      let position = out[0].length;
      for (let i = 0; i < objects.length; i++) {
        const parts = [b((i + 1) + " 0 obj\n"), ...(objects[i] || []), b("\nendobj\n")];
        offsets.push(position);
        for (const part of parts) { out.push(part); position += part.length; }
      }
      const startxref = position;
      let table = "xref\n0 " + (objects.length + 1) + "\n0000000000 65535 f \n";
      for (const offset of offsets.slice(1)) table += String(offset).padStart(10, "0") + " 00000 n \n";
      table += "trailer\n<< /Size " + (objects.length + 1) + " /Root " + root + " 0 R >>\nstartxref\n" + startxref + "\n%%EOF";
      out.push(b(table));
      return concat(out);
    }
  };
}
function makeType3Font(writer, doc, chars, bold) {
  const mapped = new Map();
  const charNames = [], widths = [], refs = [], imageRefs = [], mapping = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i], code = i + 1, name = "g" + code;
    const g = makeGlyphCanvas(doc, ch, bold);
    const img = writer.add([b("<< /Type /XObject /Subtype /Image /Width " + g.width +
      " /Height " + g.height + " /ImageMask true /BitsPerComponent 1 /Decode [0 1] /Filter /ASCIIHexDecode /Length " +
      (g.pixels.length + 1) + " >>\nstream\n" + g.pixels + ">\nendstream")]);
    const commands = g.advance.toFixed(2) + " 0 -120 -450 2800 1450 d1\nq\n" +
      ((g.right - g.left) / 1000).toFixed(4) + " 0 0 " + ((g.top - g.bottom) / 1000).toFixed(4) +
      " " + (g.left / 1000).toFixed(4) + " " + (g.bottom / 1000).toFixed(4) + " cm\n/I" + code + " Do\nQ\n";
    // Font units are thousandths of a text unit; CharProcs operate in glyph space.
    const correct = commands.replace(
      ((g.right - g.left) / 1000).toFixed(4) + " 0 0 " + ((g.top - g.bottom) / 1000).toFixed(4) +
      " " + (g.left / 1000).toFixed(4) + " " + (g.bottom / 1000).toFixed(4) + " cm",
      (g.right - g.left).toFixed(2) + " 0 0 " + (g.top - g.bottom).toFixed(2) +
      " " + g.left.toFixed(2) + " " + g.bottom.toFixed(2) + " cm"
    );
    const proc = writer.add([b("<< /Length " + b(correct).length + " >>\nstream\n"), b(correct), b("endstream")]);
    mapped.set(ch, code);
    charNames.push("/" + name); widths.push(g.advance.toFixed(2));
    refs.push("/" + name + " " + proc + " 0 R");
    imageRefs.push("/I" + code + " " + img + " 0 R");
    mapping.push("<" + hex(code) + "> <" + unicodeHex(ch) + ">");
  }
  const cmap = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n" +
    "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /GHRABToUnicode def\n/CMapType 2 def\n" +
    "1 begincodespacerange\n<00> <FF>\nendcodespacerange\n" +
    Array.from({ length: Math.ceil(mapping.length / 100) }, (_, i) => { const slice = mapping.slice(i * 100, i * 100 + 100); return slice.length + " beginbfchar\n" + slice.join("\n") + "\nendbfchar\n"; }).join("") +
    "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n";
  const cmapId = writer.add([b("<< /Length " + b(cmap).length + " >>\nstream\n"), b(cmap), b("endstream")]);
  const font = writer.add([b("<< /Type /Font /Subtype /Type3 /Name /GHRAB /FontBBox [-120 -450 2800 1450] " +
    "/FontMatrix [.001 0 0 .001 0 0] /FirstChar 1 /LastChar " + chars.length + " /Widths [" +
    widths.join(" ") + "] /CharProcs << " + refs.join(" ") + " >> /Encoding << /Type /Encoding /Differences [1 " +
    charNames.join(" ") + "] >> /Resources << /XObject << " + imageRefs.join(" ") + " >> >> /ToUnicode " +
    cmapId + " 0 R >>")]);
  return { ref: font, mapped };
}
function layoutBlocks(doc, blocks, title) {
  const canvas = doc.createElement("canvas"), ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Prohlížeč neumí připravit sazbu PDF.");
  const width = 595.28, height = 841.89, left = 45, right = width - 45, top = 77, bottom = 786;
  const specs = {
    h1: { size: 23, bold: true, line: 28, gap: 16 },
    h2: { size: 16, bold: true, line: 22, gap: 12 },
    h3: { size: 12, bold: true, line: 17, gap: 8 },
    h4: { size: 11, bold: true, line: 15, gap: 6 },
    list: { size: 10.5, bold: false, line: 15, gap: 7 },
    warning: { size: 10.5, bold: true, line: 15.5, gap: 10 },
    link: { size: 9.3, bold: false, line: 13.5, gap: 6 },
    body: { size: 10.5, bold: false, line: 15.5, gap: 11 }
  };
  const pages = []; let page = { lines: [], headings: [], links: [] }, cursor = top;
  const advance = () => { pages.push(page); page = { lines: [], headings: [], links: [] }; cursor = top; };
  function measure(txt, spec) {
    ctx.font = (spec.bold ? "bold " : "") + "100px Arial, sans-serif";
    return ctx.measureText(txt).width * spec.size / 100;
  }
  function wrap(text, spec) {
    const max = right - left; const lines = []; let line = "";
    const words = text.split(/\s+/).filter(Boolean);
    for (let word of words) {
      if (!line && measure(word, spec) <= max) { line = word; continue; }
      if (line && measure(line + " " + word, spec) <= max) { line += " " + word; continue; }
      if (line) lines.push(line);
      if (measure(word, spec) <= max) { line = word; continue; }
      let segment = "";
      for (const char of word) {
        if (segment && measure(segment + char, spec) > max) { lines.push(segment); segment = char; }
        else segment += char;
      }
      line = segment;
    }
    if (line) lines.push(line);
    return lines;
  }
  for (const block of blocks) {
    const kind = specs[block.type] ? block.type : "body", spec = specs[kind];
    const text = (kind === "list" ? "• " : "") + block.text;
    const wrapped = wrap(text, spec);
    const need = Math.min(2, wrapped.length) * spec.line + spec.gap;
    if (cursor + need > bottom) advance();
    const startPage = pages.length;
    if (["h1", "h2"].includes(kind)) page.headings.push({ title: block.text, y: cursor, level: kind, page: startPage });
    for (const line of wrapped) {
      if (cursor + spec.line > bottom) advance();
      page.lines.push({ text: line, x: left, y: height - cursor, spec, kind });
      if (block.url) page.links.push({ url: block.url, x1: left, x2: Math.min(right, left + measure(line, spec)), y1: height - cursor - 2, y2: height - cursor + spec.line });
      cursor += spec.line;
    }
    cursor += spec.gap;
  }
  pages.push(page);
  return { pages, width, height, left, right, title };
}
function createPdf(doc, blocks, title) {
  const layout = layoutBlocks(doc, blocks, title), writer = pdfWriter();
  const set = new Set();
  for (const block of blocks) for (const ch of block.text) set.add(ch);
  for (const ch of title) set.add(ch);
  for (const char of "AI Studio GHRAB • Strana 0123456789…") set.add(char);
  set.add("?"); set.add(" ");
  const chars = Array.from(set);
  const fontSpecs = [];
  for (const bold of [false, true]) {
    for (let k = 0; k < chars.length; k += 200) {
      const subset = chars.slice(k, k + 200);
      fontSpecs.push({ bold, font: makeType3Font(writer, doc, subset, bold) });
    }
  }
  const choose = (char, bold) => {
    const i = fontSpecs.findIndex((f) => f.bold === bold && f.font.mapped.has(char));
    if (i >= 0) return { key: "F" + i, code: fontSpecs[i].font.mapped.get(char) };
    const fallback = fontSpecs.findIndex((f) => f.bold === bold);
    return { key: "F" + fallback, code: fontSpecs[fallback].font.mapped.get("?") || 1 };
  };
  const catalog = writer.add(null), tree = writer.add(null);
  const refPages = layout.pages.map(() => writer.add(null));
  const fontRefs = fontSpecs.map((f, i) => "/F" + i + " " + f.font.ref + " 0 R").join(" ");
  const measureContext = doc.createElement("canvas").getContext("2d");
  if (!measureContext) throw new Error("Prohlížeč nemůže připravit sazbu PDF.");
  for (let i = 0; i < layout.pages.length; i++) {
    const p = layout.pages[i], operations = [];
    operations.push("1 1 1 rg 0 0 " + layout.width + " " + layout.height + " re f");
    operations.push(".07 .19 .30 rg .7 w 45 798 " + (layout.width - 90) + " 0 m " + (layout.width - 45) + " 798 l S");
    operations.push(".04 .35 .47 rg 45 816 50 3 re f");
    operations.push(".10 .20 .30 rg");
    function draw(txt, x, y, spec) {
      const fontSize = spec.size, bold = spec.bold;
      const runs = [];
      for (const char of txt) {
        const code = choose(char, bold);
        const last = runs[runs.length - 1];
        if (last && last.key === code.key) { last.codes.push(code.code); last.text += char; }
        else runs.push({ key: code.key, codes: [code.code], text: char });
      }
      let position = x;
      for (const run of runs) {
        const sequence = run.codes.map((v) => hex(v)).join("");
        operations.push("BT /" + run.key + " " + fontSize + " Tf 1 0 0 1 " + position.toFixed(2) + " " + y.toFixed(2) + " Tm <" + sequence + "> Tj ET");
        measureContext.font = (bold ? "bold " : "") + "100px Arial, sans-serif";
        position += measureContext.measureText(run.text).width * fontSize / 100;
      }
    }
    draw(title.length > 69 ? title.slice(0, 66) + "…" : title, 45, 811, { size: 10, bold: true });
    for (const line of p.lines) {
      operations.push(line.kind === "h2" || line.kind === "link" ? ".03 .42 .57 rg" :
        line.kind === "warning" ? ".56 .27 .11 rg" : ".10 .20 .30 rg");
      draw(line.text, line.x, line.y, line.spec);
    }
    draw("AI Studio GHRAB • Strana " + (i + 1), 45, 34, { size: 9, bold: false });
    const commands = operations.join("\n") + "\n";
    const content = writer.add([b("<< /Length " + b(commands).length + " >>\nstream\n"), b(commands), b("endstream")]);
    const links = [];
    for (const link of p.links) {
      const id = writer.add([b("<< /Type /Annot /Subtype /Link /Rect [" +
        [link.x1, link.y1, link.x2, link.y2].map((v) => v.toFixed(2)).join(" ") +
        "] /Border [0 0 0] /A << /S /URI /URI (" + escapePdf(link.url) + ") >> >>")]);
      links.push(id + " 0 R");
    }
    writer.set(refPages[i], [b("<< /Type /Page /Parent " + tree + " 0 R /MediaBox [0 0 " + layout.width +
      " " + layout.height + "] /Resources << /Font << " + fontRefs + " >> >> /Contents " +
      content + " 0 R" + (links.length ? " /Annots [" + links.join(" ") + "]" : "") + " >>")]);
  }
  writer.set(tree, [b("<< /Type /Pages /Count " + refPages.length + " /Kids [" + refPages.map(v => v + " 0 R").join(" ") + "] >>")]);
  writer.set(catalog, [b("<< /Type /Catalog /Pages " + tree + " 0 R >>")]);
  return { data: writer.finish(catalog), pages: layout.pages.length };
}
export async function downloadManualPdf(doc, options = {}) {
  if (!doc || !doc.querySelector) throw new Error("Obsah manuálu není dostupný.");
  const title = String(options.title || doc.title || "Příručka AI Studia").replace(/\s+/g, " ").trim();
  const fileName = String(options.filename || "AI-Studio-manual.pdf").replace(/[^a-zA-Z0-9_.-]/g, "_");
  const blocks = htmlToBlocks(doc, options.extras);
  if (blocks.length < 5) throw new Error("Chybí obsah potřebný k vytvoření PDF.");
  if (doc.documentElement?.dataset?.ghrabAccess === "denied" || doc.documentElement?.dataset?.ghrabAccess === "checking") throw new Error("Přístup k manuálu nebyl ověřen.");
  const { data, pages } = createPdf(doc, blocks, title);
  if (data.length > 35 * 1024 * 1024) throw new Error("PDF překročilo bezpečný limit velikosti.");
  const blob = new Blob([data], { type: "application/pdf" });
  const url = URL.createObjectURL(blob), link = doc.createElement("a");
  link.href = url;
  link.download = fileName;
  link.hidden = true;
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { pages, bytes: data.length, fileName };
}
