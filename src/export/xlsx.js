import ExcelJS from 'exceljs';
import { businessDate, buildExcelValues } from '../../public/js/parking-core.js';
import { getActiveZones } from '../routes/zones.js';

const TIME_FORMAT = 'hh:mm';

function toExcelTime(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/);
  if (!match) return { text: String(hhmm || '') };
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return { value: (hours * 3600 + minutes * 60) / 86400 };
}

function rocTitle(businessDateStr) {
  const [year, month, day] = businessDateStr.split('-');
  return `${Number(year) - 1911}年${month}月${day}日車用數統計表`;
}

function writeValueRow(sheet, rowIndex, colStart, cells) {
  const labelCell = sheet.getCell(rowIndex, colStart + 1);
  labelCell.value = '剩餘車位數';
  labelCell.font = { bold: true };
  cells.forEach((cellSpec, index) => {
    const cell = sheet.getCell(rowIndex, colStart + 2 + index);
    cell.value = cellSpec.value;
    if (cellSpec.numFmt) cell.numFmt = cellSpec.numFmt;
    cell.alignment = { horizontal: 'center' };
  });
}

function writeRemarkRow(sheet, rowIndex, colStart, zones, remarks) {
  sheet.getCell(rowIndex, colStart + 1).value = '備註';
  zones.forEach((zone, index) => {
    const text = remarks?.[zone.code];
    if (typeof text !== 'string' || !text.trim()) return;
    const cell = sheet.getCell(rowIndex, colStart + 2 + index);
    cell.value = text.trim();
    cell.alignment = { horizontal: 'center' };
  });
}

async function buildWorkbook(records, zones) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'parking-report';

  const byMonth = new Map();
  for (const record of records) {
    const month = Number(record.businessDate.slice(5, 7));
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(record);
  }

  for (const [month, monthRecords] of [...byMonth.entries()].sort((a, b) => a[0] - b[0])) {
    const sheet = workbook.addWorksheet(`${month}月`);
    sheet.getColumn(1).width = 11;
    sheet.getColumn(2).width = 12;
    sheet.getColumn(15).width = 11;
    sheet.getColumn(16).width = 12;
    for (const offset of [...Array(10).keys()]) {
      sheet.getColumn(3 + offset).width = 9;
      sheet.getColumn(17 + offset).width = 9;
    }

    const byDate = new Map();
    for (const record of monthRecords) {
      if (!byDate.has(record.businessDate)) byDate.set(record.businessDate, []);
      byDate.get(record.businessDate).push(record);
    }
    const dates = [...byDate.keys()].sort();

    for (let pairStart = 0; pairStart < dates.length; pairStart += 2) {
      const startRow = sheet.rowCount + 1;
      for (let offset = 0; offset < 2; offset++) {
        const date = dates[pairStart + offset];
        if (!date) continue;
        const colStart = offset === 0 ? 1 : 15;
        const dayRecords = byDate.get(date);

        const titleRow = startRow;
        const titleCell = sheet.getCell(titleRow, colStart + 4);
        titleCell.value = rocTitle(date);
        titleCell.font = { bold: true, size: 12 };
        sheet.mergeCells(titleRow, colStart + 4, titleRow, colStart + 9);
        sheet.getCell(titleRow, colStart + 10).value = '填表人：';
        sheet.getCell(titleRow, colStart + 10).font = { bold: true };
        sheet.getCell(titleRow, colStart + 11).value = dayRecords[0]?.preparedBy ?? '';

        const headerRow = titleRow + 1;
        zones.forEach((zone, index) => {
          const cell = sheet.getCell(headerRow, colStart + 2 + index);
          cell.value = zone.excelLabel;
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center' };
        });

        let row = headerRow + 1;
        for (const record of dayRecords) {
          const time = toExcelTime(record.reportTime);
          const timeCell = sheet.getCell(row, colStart);
          if (time.value != null) {
            timeCell.value = time.value;
            timeCell.numFmt = TIME_FORMAT;
          } else {
            timeCell.value = time.text;
          }
          writeValueRow(sheet, row, colStart, buildExcelValues(record.values, zones));
          writeRemarkRow(sheet, row + 1, colStart, zones, record.remarks);
          row += 2;
        }
      }
    }
  }

  return workbook.xlsx.writeBuffer();
}

export async function exportRecords(env, url) {
  const today = businessDate(new Date());
  const from = url.searchParams.get('from') || today;
  const to = url.searchParams.get('to') || from;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return { error: '日期格式必須為 YYYY-MM-DD', status: 400 };
  }

  const { results } = await env.DB
    .prepare(
      'SELECT * FROM records WHERE site_id = 1 AND business_date BETWEEN ? AND ? ORDER BY business_date, report_time, id'
    )
    .bind(from, to)
    .all();
  const zones = await getActiveZones(env.DB);

  const records = results.map((row) => ({
    businessDate: row.business_date,
    reportTime: row.report_time,
    preparedBy: row.prepared_by,
    values: JSON.parse(row.values_json || '{}'),
    remarks: JSON.parse(row.remarks_json || '{}'),
  }));

  const buffer = await buildWorkbook(records, zones);
  const filename = encodeURIComponent(`停車場車用數_${from}_${to}.xlsx`);
  return {
    body: buffer,
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="parking-usage_${from}_${to}.xlsx"; filename*=UTF-8''${filename}`,
    },
  };
}
