const { parentPort } = require("worker_threads");
const XLSX = require("xlsx");
const { parse } = require("csv-parse/sync");
const fs = require("fs");
const path = require("path");
const os = require("os");

function resolveStreamingParser() {
  const candidates = [
    path.join(__dirname, "streaming-xlsx-parser.cjs"),
    path.resolve("server/streaming-xlsx-parser.cjs"),
    path.resolve("dist/streaming-xlsx-parser.cjs"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return require(p); } catch {}
    }
  }
  return null;
}

function parseFileToRecords(buffer, filename, selectedSheet) {
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return jsonRows.map(row => {
      const stringRow = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  }
  const content = buffer.toString("utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });
}

function getSheetNames(buffer) {
  const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  return workbook.SheetNames || [];
}

function previewHeaders(buffer, filename, selectedSheet) {
  const ext = (filename || "").toLowerCase().split(".").pop();
  let records;
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 5 });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    records = jsonRows.map(row => {
      const stringRow = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  } else {
    const content = buffer.toString("utf-8");
    records = parse(content, {
      columns: true, skip_empty_lines: true, trim: true,
      relax_column_count: true, relax_quotes: true, to: 5,
    });
  }
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, sampleRows: records.slice(0, 3) };
}

const LARGE_FILE_MB = 10;

function getFileSizeMB(filePath) {
  try {
    return fs.statSync(filePath).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

async function parseLargeWithSAX(filePath, selectedSheet) {
  const sax = resolveStreamingParser();
  if (!sax) throw new Error("SAX streaming parser not available");

  const result = await sax.parseXlsxStreaming(filePath, {
    sheetName: selectedSheet,
    maxInMemoryRows: 500000,
  });

  if (result.tmpFile) {
    const data = JSON.parse(fs.readFileSync(result.tmpFile, "utf8"));
    try { fs.unlinkSync(result.tmpFile); } catch {}
    return data;
  }
  return result.rows;
}

async function parseLargeToRecords(filePath, selectedSheet) {
  const rawRows = await parseLargeWithSAX(filePath, selectedSheet);
  if (!rawRows || rawRows.length === 0) return [];

  const headers = rawRows[0].map(h => (h != null ? String(h) : ""));
  const records = [];
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    if (!row || row.length === 0) continue;
    const record = {};
    for (let j = 0; j < headers.length; j++) {
      if (headers[j]) record[headers[j]] = row[j] != null ? String(row[j]) : "";
    }
    records.push(record);
  }
  return records;
}

async function parseLargeTbSheet(filePath) {
  return await parseLargeWithSAX(filePath, undefined);
}

parentPort.on("message", async (msg) => {
  try {
    const { action, buffer, filePath, filename, selectedSheet } = msg;
    const isLargeFile = filePath && getFileSizeMB(filePath) > LARGE_FILE_MB;
    const ext = (filename || "").toLowerCase().split(".").pop();
    const isExcel = ext === "xlsx" || ext === "xls";

    if (isLargeFile && isExcel && (action === "parse" || action === "parseTbSheet" || action === "parseTbSheetToFile" || action === "sheetNames" || action === "preview")) {
      try {
        const sax = resolveStreamingParser();
        if (sax) {
          let result;
          switch (action) {
            case "parse": {
              result = await parseLargeToRecords(filePath, selectedSheet);
              break;
            }
            case "parseTbSheet": {
              result = await parseLargeTbSheet(filePath);
              break;
            }
            case "parseTbSheetToFile": {
              const rows = await parseLargeTbSheet(filePath);
              const tmpFile = path.join(os.tmpdir(), `parsed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
              const writeStream = fs.createWriteStream(tmpFile);
              writeStream.write("[");
              for (let i = 0; i < rows.length; i++) {
                if (i > 0) writeStream.write(",");
                writeStream.write(JSON.stringify(rows[i]));
              }
              writeStream.write("]");
              writeStream.end();
              await new Promise((resolve, reject) => {
                writeStream.on("finish", resolve);
                writeStream.on("error", reject);
              });
              if (filePath) { try { fs.unlinkSync(filePath); } catch (e) {} }
              parentPort.postMessage({ success: true, data: { tmpFile, rowCount: rows.length } });
              return;
            }
            case "sheetNames": {
              result = await sax.getSheetNamesStreaming(filePath);
              break;
            }
            case "preview": {
              const previewRows = await sax.previewStreaming(filePath);
              if (previewRows.length > 0) {
                const headers = previewRows[0].map(h => h != null ? String(h) : "");
                const sampleRows = [];
                for (let i = 1; i < Math.min(previewRows.length, 4); i++) {
                  const record = {};
                  for (let j = 0; j < headers.length; j++) {
                    if (headers[j]) record[headers[j]] = previewRows[i]?.[j] != null ? String(previewRows[i][j]) : "";
                  }
                  sampleRows.push(record);
                }
                result = { headers, sampleRows };
              } else {
                result = { headers: [], sampleRows: [] };
              }
              break;
            }
          }
          if (filePath) { try { fs.unlinkSync(filePath); } catch (e) {} }
          parentPort.postMessage({ success: true, data: result });
          return;
        }
      } catch (streamErr) {
        console.error("SAX streaming failed, falling back to SheetJS:", streamErr.message);
      }
    }

    const buf = buffer ? Buffer.from(buffer) : fs.readFileSync(filePath);

    let result;
    switch (action) {
      case "parse":
        result = parseFileToRecords(buf, filename, selectedSheet);
        break;
      case "sheetNames":
        result = getSheetNames(buf);
        break;
      case "preview":
        result = previewHeaders(buf, filename, selectedSheet);
        break;
      case "parseTbSheet": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        result = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });
        break;
      }
      case "parseTbSheetToFile": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });
        const tmpFile = path.join(os.tmpdir(), `parsed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        const writeStream = fs.createWriteStream(tmpFile);
        writeStream.write("[");
        for (let i = 0; i < rows.length; i++) {
          if (i > 0) writeStream.write(",");
          writeStream.write(JSON.stringify(rows[i]));
        }
        writeStream.write("]");
        writeStream.end();
        writeStream.on("finish", () => {
          if (filePath) { try { fs.unlinkSync(filePath); } catch (e) {} }
          parentPort.postMessage({ success: true, data: { tmpFile, rowCount: rows.length } });
        });
        writeStream.on("error", (err) => {
          if (filePath) { try { fs.unlinkSync(filePath); } catch (e) {} }
          parentPort.postMessage({ success: false, error: err.message });
        });
        return;
      }
      case "parseMultiSheet": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const sheets = {};
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, range: 0, defval: "" });
        }
        result = { sheetNames: wb.SheetNames, sheets };
        break;
      }
      default:
        throw new Error("Unknown action: " + action);
    }

    if (filePath) { try { fs.unlinkSync(filePath); } catch (e) {} }

    parentPort.postMessage({ success: true, data: result });
  } catch (error) {
    if (msg.filePath) { try { fs.unlinkSync(msg.filePath); } catch (e) {} }
    parentPort.postMessage({ success: false, error: error.message });
  }
});
