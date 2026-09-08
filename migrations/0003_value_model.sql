-- zones：unit 取代 is_car，label 改用現場口語（LINE 與畫面共用）
CREATE TABLE zones_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  excel_label TEXT NOT NULL,
  position INTEGER NOT NULL,
  unit TEXT NOT NULL CHECK (unit IN ('spaces', 'tenths')),
  in_tower INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

INSERT INTO zones_new (id, site_id, code, label, excel_label, position, unit, in_tower, active)
SELECT id, site_id, code, label, excel_label, position,
       CASE WHEN is_car = 1 THEN 'spaces' ELSE 'tenths' END,
       in_tower, active
FROM zones;

DROP TABLE zones;
ALTER TABLE zones_new RENAME TO zones;

UPDATE zones SET label = '車塔1上' WHERE code = 'floor_above';
UPDATE zones SET label = '車塔1下' WHERE code = 'floor_below';
UPDATE zones SET label = 'A區'     WHERE code = 'spin_a';
UPDATE zones SET label = 'B區'     WHERE code = 'spin_b';
UPDATE zones SET label = 'C區'     WHERE code = 'spin_c';
UPDATE zones SET label = 'D區'     WHERE code = 'spin_d';
UPDATE zones SET label = 'E區'     WHERE code = 'spin_e';

-- reports / records：欄位更名
ALTER TABLE reports RENAME COLUMN tokens_json TO values_json;
ALTER TABLE records RENAME COLUMN tokens_json TO values_json;
ALTER TABLE records RENAME COLUMN line_report TO guard_report;
ALTER TABLE records RENAME COLUMN control_report TO console_report;

-- 舊值轉換：x→none、0→full、0.N→carts、其餘整數依 zones.unit 判斷
UPDATE reports SET values_json = (
  SELECT json_group_object(z.code, CASE
    WHEN v.value IS NULL OR lower(v.value) = 'x' THEN json_object('kind', 'none')
    WHEN v.value = '0' THEN json_object('kind', 'full')
    WHEN v.value LIKE '0.%' THEN json_object('kind', 'carts', 'value', CAST(substr(v.value, 3) AS INTEGER))
    WHEN z.unit = 'spaces' THEN json_object('kind', 'spaces', 'value', CAST(v.value AS INTEGER))
    ELSE json_object('kind', 'tenths', 'value', CAST(v.value AS INTEGER))
  END)
  FROM zones z LEFT JOIN json_each(reports.values_json) v ON v.key = z.code
);

UPDATE records SET values_json = (
  SELECT json_group_object(z.code, CASE
    WHEN v.value IS NULL OR lower(v.value) = 'x' THEN json_object('kind', 'none')
    WHEN v.value = '0' THEN json_object('kind', 'full')
    WHEN v.value LIKE '0.%' THEN json_object('kind', 'carts', 'value', CAST(substr(v.value, 3) AS INTEGER))
    WHEN z.unit = 'spaces' THEN json_object('kind', 'spaces', 'value', CAST(v.value AS INTEGER))
    ELSE json_object('kind', 'tenths', 'value', CAST(v.value AS INTEGER))
  END)
  FROM zones z LEFT JOIN json_each(records.values_json) v ON v.key = z.code
);
