const fs = require("fs");
const path = require("path");
const os = require("os");

const filePath = process.argv[2];
if (!filePath) {
  process.send({ type: "error", error: "No file path provided" });
  process.exit(1);
}

const fileSizeMB = fs.statSync(filePath).size / (1024 * 1024);
const LARGE_FILE_THRESHOLD_MB = 10;

function resolveStreamingParser() {
  const candidates = [
    path.join(__dirname, "streaming-xlsx-parser.cjs"),
    path.resolve("server/streaming-xlsx-parser.cjs"),
    path.resolve("dist/streaming-xlsx-parser.cjs"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return require(p);
  }
  return null;
}

async function parseWithSAXStream(filePath) {
  const parser = resolveStreamingParser();
  if (!parser) throw new Error("SAX streaming parser not found");

  process.send({ type: "status", message: `SAX streaming large file (${fileSizeMB.toFixed(1)}MB)...` });

  const result = await parser.parseXlsxStreaming(filePath, {
    maxInMemoryRows: 0,
    onProgress: (count) => {
      process.send({ type: "status", message: `SAX streamed ${count} rows...` });
    },
  });

  if (result.tmpFile) {
    return { tmpFile: result.tmpFile, rowCount: result.rowCount };
  }
  const tmpFile = path.join(os.tmpdir(), `gl-parsed-${Date.now()}.json`);
  fs.writeFileSync(tmpFile, JSON.stringify(result.rows));
  return { tmpFile, rowCount: result.rowCount };
}

function parseWithSheetJS(filePath) {
  const XLSX = require("xlsx");
  process.send({ type: "status", message: `Parsing with SheetJS (${fileSizeMB.toFixed(1)}MB)...` });

  const buffer = fs.readFileSync(filePath);
  process.send({ type: "status", message: `Read ${(buffer.length / 1024 / 1024).toFixed(1)}MB, parsing (this may take several minutes for large files)...` });

  const wb = XLSX.read(buffer, {
    type: "buffer",
    raw: true,
    cellDates: false,
    cellNF: false,
    cellHTML: false,
    cellStyles: false,
    sheets: 0,
  });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: true });

  const rows = rawRows.filter(r => Array.isArray(r) && r.length > 0 && !r.every(c => c === "" || c == null));

  process.send({ type: "status", message: `Parsed ${rows.length} rows, writing temp file...` });

  const tmpFile = path.join(os.tmpdir(), `gl-parsed-${Date.now()}.json`);
  const fd = fs.openSync(tmpFile, "w");
  fs.writeSync(fd, "[");
  for (let i = 0; i < rows.length; i++) {
    if (i > 0) fs.writeSync(fd, ",");
    fs.writeSync(fd, JSON.stringify(rows[i]));
    if (i > 0 && i % 100000 === 0) {
      process.send({ type: "status", message: `Writing row ${i} of ${rows.length}...` });
    }
  }
  fs.writeSync(fd, "]");
  fs.closeSync(fd);

  return { tmpFile, rowCount: rows.length };
}

(async () => {
  try {
    let result;
    if (fileSizeMB > LARGE_FILE_THRESHOLD_MB) {
      try {
        process.send({ type: "status", message: `Large file (${fileSizeMB.toFixed(1)}MB), trying SAX streaming parser...` });
        result = await parseWithSAXStream(filePath);
      } catch (streamErr) {
        const msg = streamErr.message || String(streamErr);
        process.send({ type: "status", message: `SAX streaming failed (${msg.slice(0, 60)}), falling back to SheetJS...` });
        result = parseWithSheetJS(filePath);
      }
    } else {
      result = parseWithSheetJS(filePath);
    }
    process.send({ type: "done", tmpFile: result.tmpFile, rowCount: result.rowCount });
  } catch (err) {
    process.send({ type: "error", error: err.message || String(err) });
    process.exit(1);
  }
})();
