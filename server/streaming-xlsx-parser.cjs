"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

let saxesModule, unzipperModule;
try {
  saxesModule = require("saxes");
  unzipperModule = require("unzipper");
} catch {
  try {
    const excelJsDir = path.dirname(require.resolve("exceljs"));
    const nmDir = path.resolve(excelJsDir, "..", "..");
    saxesModule = require(path.join(nmDir, "saxes"));
    unzipperModule = require(path.join(nmDir, "unzipper"));
  } catch (e2) {
    console.error("[streaming-xlsx-parser] Cannot load saxes/unzipper:", e2.message);
  }
}

function colRefToIndex(ref) {
  const match = ref.match(/^([A-Z]+)/);
  if (!match) return 0;
  const letters = match[1];
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

function rowRefFromCellRef(ref) {
  const match = ref.match(/(\d+)$/);
  return match ? parseInt(match[1], 10) : 0;
}

async function parseSharedStrings(zipEntries) {
  const ssEntry = zipEntries.find(
    (e) => e.path === "xl/sharedStrings.xml" || e.path === "xl/SharedStrings.xml"
  );
  if (!ssEntry) return [];

  const strings = [];
  const buf = await ssEntry.buffer();
  const xml = buf.toString("utf8");

  const parser = new saxesModule.SaxesParser();
  let inSi = false;
  let inT = false;
  let current = "";

  parser.on("opentag", (node) => {
    if (node.name === "si") {
      inSi = true;
      current = "";
    } else if (inSi && (node.name === "t" || node.name === "r")) {
      inT = node.name === "t";
    }
  });

  parser.on("text", (text) => {
    if (inSi && inT) current += text;
  });

  parser.on("closetag", (node) => {
    if (node.name === "t") inT = false;
    if (node.name === "si") {
      strings.push(current);
      inSi = false;
      current = "";
    }
  });

  parser.write(xml);
  parser.close();
  return strings;
}

async function parseXlsxStreaming(filePath, options = {}) {
  const {
    sheetName,
    maxInMemoryRows = 500000,
    onProgress,
    header,
  } = options;

  if (!saxesModule || !unzipperModule) {
    throw new Error("saxes or unzipper not available");
  }

  const zip = await unzipperModule.Open.file(filePath);
  const entries = zip.files;

  const sharedStrings = await parseSharedStrings(entries);

  let sheetPath = "xl/worksheets/sheet1.xml";
  if (sheetName) {
    const wbEntry = entries.find((e) => e.path === "xl/workbook.xml");
    if (wbEntry) {
      const wbBuf = await wbEntry.buffer();
      const wbXml = wbBuf.toString("utf8");
      const sheetMap = parseWorkbookForSheets(wbXml);
      const target = sheetMap[sheetName.toLowerCase()];
      if (target) sheetPath = "xl/worksheets/" + target;
    }
  }

  const sheetEntry = entries.find(
    (e) => e.path === sheetPath || e.path.toLowerCase() === sheetPath.toLowerCase()
  );
  if (!sheetEntry) {
    throw new Error(`Sheet not found: ${sheetPath}`);
  }

  const sheetBuf = await sheetEntry.buffer();
  const sheetXml = sheetBuf.toString("utf8");

  const rows = [];
  let rowCount = 0;
  let lastRowNum = 0;
  let tmpFile = null;
  let tmpStream = null;
  let firstTmpRow = true;
  const useSpill = maxInMemoryRows === 0;

  if (useSpill) {
    tmpFile = path.join(os.tmpdir(), `sax-parse-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    tmpStream = fs.createWriteStream(tmpFile);
    tmpStream.write("[");
  }

  const parser = new saxesModule.SaxesParser();
  let inRow = false;
  let inCell = false;
  let inValue = false;
  let inInlineStr = false;
  let currentRow = [];
  let currentRowNum = 0;
  let cellRef = "";
  let cellType = "";
  let cellValue = "";

  parser.on("opentag", (node) => {
    if (node.name === "row") {
      inRow = true;
      currentRow = [];
      const rAttr = node.attributes.r;
      currentRowNum = rAttr ? parseInt(rAttr, 10) : lastRowNum + 1;
    } else if (inRow && node.name === "c") {
      inCell = true;
      cellRef = node.attributes.r || "";
      cellType = node.attributes.t || "";
      cellValue = "";
    } else if (inCell && node.name === "v") {
      inValue = true;
      cellValue = "";
    } else if (inCell && node.name === "is") {
      inInlineStr = true;
      cellValue = "";
    } else if (inInlineStr && node.name === "t") {
      inValue = true;
    }
  });

  parser.on("text", (text) => {
    if (inValue) cellValue += text;
  });

  parser.on("closetag", (node) => {
    if (node.name === "v" || (inInlineStr && node.name === "t")) {
      inValue = false;
    } else if (node.name === "is") {
      inInlineStr = false;
    } else if (node.name === "c" && inCell) {
      let resolved = cellValue;
      if (cellType === "s") {
        const idx = parseInt(cellValue, 10);
        resolved = isNaN(idx) ? cellValue : (sharedStrings[idx] ?? cellValue);
      } else if (cellType === "b") {
        resolved = cellValue === "1" ? "TRUE" : "FALSE";
      } else if (cellType === "inlineStr") {
        resolved = cellValue;
      } else if (cellType === "" || cellType === "n") {
        const num = parseFloat(cellValue);
        if (!isNaN(num) && cellValue !== "") resolved = num;
      }

      const colIdx = cellRef ? colRefToIndex(cellRef) : currentRow.length;
      while (currentRow.length < colIdx) currentRow.push("");
      currentRow.push(resolved);

      inCell = false;
      cellRef = "";
      cellType = "";
      cellValue = "";
    } else if (node.name === "row" && inRow) {
      while (lastRowNum + 1 < currentRowNum) {
        emitRow([]);
        lastRowNum++;
      }
      emitRow(currentRow);
      lastRowNum = currentRowNum;
      inRow = false;

      if (onProgress && rowCount % 50000 === 0) {
        onProgress(rowCount);
      }
    }
  });

  function emitRow(row) {
    if (!row || row.length === 0 || row.every(c => c === "" || c == null)) return;
    rowCount++;
    if (useSpill || (maxInMemoryRows > 0 && rows.length >= maxInMemoryRows)) {
      if (!tmpStream) {
        tmpFile = path.join(os.tmpdir(), `sax-parse-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        tmpStream = fs.createWriteStream(tmpFile);
        tmpStream.write("[");
        for (let i = 0; i < rows.length; i++) {
          if (i > 0) tmpStream.write(",");
          tmpStream.write(JSON.stringify(rows[i]));
        }
        rows.length = 0;
        firstTmpRow = false;
      }
      if (!firstTmpRow) tmpStream.write(",");
      tmpStream.write(JSON.stringify(row));
      firstTmpRow = false;
    } else {
      rows.push(row);
    }
  }

  parser.write(sheetXml);
  parser.close();

  if (tmpStream) {
    tmpStream.write("]");
    await new Promise((resolve, reject) => {
      tmpStream.end(() => resolve());
      tmpStream.on("error", reject);
    });
    return { tmpFile, rowCount };
  }

  return { rows, rowCount };
}

function parseWorkbookForSheets(wbXml) {
  const map = {};
  const parser = new saxesModule.SaxesParser();
  parser.on("opentag", (node) => {
    if (node.name === "sheet") {
      const name = node.attributes.name;
      const sheetId = node.attributes.sheetId;
      const rId = node.attributes["r:id"];
      if (name && sheetId) {
        map[name.toLowerCase()] = `sheet${sheetId}.xml`;
      }
    }
  });
  parser.write(wbXml);
  parser.close();
  return map;
}

async function getSheetNamesStreaming(filePath) {
  if (!saxesModule || !unzipperModule) {
    throw new Error("saxes or unzipper not available");
  }

  const zip = await unzipperModule.Open.file(filePath);
  const wbEntry = zip.files.find((e) => e.path === "xl/workbook.xml");
  if (!wbEntry) return [];

  const buf = await wbEntry.buffer();
  const xml = buf.toString("utf8");
  const names = [];
  const parser = new saxesModule.SaxesParser();
  parser.on("opentag", (node) => {
    if (node.name === "sheet" && node.attributes.name) {
      names.push(node.attributes.name);
    }
  });
  parser.write(xml);
  parser.close();
  return names;
}

async function previewStreaming(filePath, sheetNameArg) {
  const result = await parseXlsxStreaming(filePath, {
    sheetName: sheetNameArg,
    maxInMemoryRows: 100,
  });
  const rows = result.rows || [];
  return rows.slice(0, 20);
}

module.exports = { parseXlsxStreaming, getSheetNamesStreaming, previewStreaming };
