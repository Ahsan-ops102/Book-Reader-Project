import JSZip from 'jszip';
const esc = v => String(v ?? '').replace(/[<>&"']/g, c => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  '"': '&quot;',
  "'": '&apos;'
})[c]);
const NS = 'http://schemas.openxmlformats.org';
export async function buildDocx(doc) {
  const zip = new JSZip(),
    relationships = [],
    numbering = [];
  let imageId = 0;
  function run(node) {
    if (node.type === 'hardBreak') return '<w:r><w:br/></w:r>';
    if (node.type !== 'text') return (node.content || []).map(run).join('');
    const marks = (node.marks || []).map(m => {
      if (m.type === 'textStyle' && /^#[a-f0-9]{6}$/i.test(m.attrs?.color || '')) return `<w:color w:val="${m.attrs.color.slice(1)}"/>`;
      return {
        bold: '<w:b/>',
        italic: '<w:i/>',
        underline: '<w:u w:val="single"/>',
        strike: '<w:strike/>',
        code: '<w:rFonts w:ascii="Courier New"/>',
        highlight: '<w:highlight w:val="yellow"/>'
      }[m.type] || '';
    }).join('');
    const text = `<w:r><w:rPr>${marks}</w:rPr><w:t xml:space="preserve">${esc(node.text)}</w:t></w:r>`;
    const link = (node.marks || []).find(m => m.type === 'link')?.attrs?.href;
    if (link && /^(https?:|mailto:)/i.test(link)) {
      const id = `link${relationships.length}`;
      relationships.push(`<Relationship Id="${id}" Type="${NS}/officeDocument/2006/relationships/hyperlink" Target="${esc(link)}" TargetMode="External"/>`);
      return `<w:hyperlink r:id="${id}">${text}</w:hyperlink>`;
    }
    return text;
  }
  function picture(node) {
    const match = node.attrs?.src?.match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
    if (!match) return `<w:p><w:r><w:t>${esc(node.attrs?.alt || '[Image unavailable in this export]')}</w:t></w:r></w:p>`;
    const index = ++imageId,
      ext = match[1] === 'jpeg' ? 'jpg' : 'png',
      name = `image${index}.${ext}`;
    zip.file(`word/media/${name}`, match[2], {
      base64: true
    });
    relationships.push(`<Relationship Id="image${index}" Type="${NS}/officeDocument/2006/relationships/image" Target="media/${name}"/>`);
    let width = Number(node.attrs.width) || 480,
      height = Number(node.attrs.height) || 320;
    if (ext === 'png') {
      const bytes = Uint8Array.from(atob(match[2].slice(0, 44)), c => c.charCodeAt(0));
      if (bytes.length >= 24) {
        const view = new DataView(bytes.buffer);
        const w = view.getUint32(16),
          h = view.getUint32(20);
        if (w && h) {
          width = w;
          height = h;
        }
      }
    }
    const scale = Math.min(1, 600 / width, 780 / height),
      cx = Math.round(width * scale * 9525),
      cy = Math.round(height * scale * 9525);
    return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${index}" name="${name}" descr="${esc(node.attrs.alt)}"/><a:graphic><a:graphicData uri="${NS}/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${index}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="image${index}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
  }
  function block(node, depth = 0, numId = null) {
    const content = node.content || [];
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const id = numbering.length + 1;
      numbering.push({
        id,
        ordered: node.type === 'orderedList',
        start: Math.max(1, Number(node.attrs?.start) || 1)
      });
      return content.map(n => block(n, depth, id)).join('');
    }
    if (node.type === 'listItem') return content.map((n, i) => block(n, ['bulletList', 'orderedList'].includes(n.type) ? depth + 1 : depth, i === 0 ? numId : null)).join('');
    if (node.type === 'table') return `<w:tbl><w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="single" w:sz="4" w:color="BBBBBB"/>`).join('')}</w:tblBorders></w:tblPr>${content.map(r => `<w:tr>${(r.content || []).map(c => `<w:tc>${(c.content || []).map(n => block(n)).join('') || '<w:p/>'}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    if (node.type === 'blockquote') return content.map(n => block(n, depth + 1)).join('');
    if (node.type === 'image') return picture(node);
    const style = node.type === 'heading' ? `<w:pStyle w:val="Heading${Math.min(3, node.attrs?.level || 1)}"/>` : '';
    const alignment = ['left', 'center', 'right', 'justify'].includes(node.attrs?.textAlign) ? `<w:jc w:val="${node.attrs.textAlign === 'justify' ? 'both' : node.attrs.textAlign}"/>` : '';
    const rule = node.type === 'horizontalRule' ? '<w:pBdr><w:bottom w:val="single" w:sz="6"/></w:pBdr>' : '';
    return `<w:p><w:pPr>${style}${alignment}${rule}${depth && !numId ? `<w:ind w:left="${480 * depth}"/>` : ''}${numId ? `<w:numPr><w:ilvl w:val="${Math.min(8, depth)}"/><w:numId w:val="${numId}"/></w:numPr>` : ''}</w:pPr>${content.map(run).join('')}</w:p>`;
  }
  const body = (doc.content || []).map(n => block(n)).join('');
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="${NS}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>${['document', 'styles', 'numbering'].map(n => `<Override PartName="/word/${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${n === 'document' ? 'document.main' : n}+xml"/>`).join('')}</Types>`);
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="rId1" Type="${NS}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0"?><Relationships xmlns="${NS}/package/2006/relationships"><Relationship Id="styles" Type="${NS}/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="numbering" Type="${NS}/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>${relationships.join('')}</Relationships>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="${NS}/wordprocessingml/2006/main" xmlns:r="${NS}/officeDocument/2006/relationships" xmlns:wp="${NS}/drawingml/2006/wordprocessingDrawing" xmlns:a="${NS}/drawingml/2006/main" xmlns:pic="${NS}/drawingml/2006/picture"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`);
  zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="${NS}/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:rFonts w:ascii="Calibri"/><w:sz w:val="22"/></w:rPr></w:style>${[1, 2, 3].map(n => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="${36 - n * 4}"/></w:rPr></w:style>`).join('')}</w:styles>`);
  zip.file('word/numbering.xml', `<?xml version="1.0"?><w:numbering xmlns:w="${NS}/wordprocessingml/2006/main">${numbering.map(n => `<w:abstractNum w:abstractNumId="${n.id}">${Array.from({
    length: 9
  }, (_, i) => `<w:lvl w:ilvl="${i}"><w:start w:val="${n.start}"/><w:numFmt w:val="${n.ordered ? 'decimal' : 'bullet'}"/><w:lvlText w:val="${n.ordered ? '%' + (i + 1) + '.' : '•'}"/><w:pPr><w:ind w:left="${720 * (i + 1)}" w:hanging="360"/></w:pPr></w:lvl>`).join('')}</w:abstractNum><w:num w:numId="${n.id}"><w:abstractNumId w:val="${n.id}"/></w:num>`).join('')}</w:numbering>`);
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE'
  });
}
export async function downloadDocx(doc, title) {
  const blob = new Blob([await buildDocx(doc)], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  const url = URL.createObjectURL(blob),
    a = document.createElement('a');
  a.href = url;
  a.download = (title || 'document').replace(/[\\/:*?"<>|]/g, '-') + '.docx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
