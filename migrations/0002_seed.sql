INSERT INTO sites (id, name, tower_total) VALUES (1, '廠區', 1600);

INSERT INTO zones (site_id, code, label, excel_label, position, is_car, in_tower) VALUES
  (1, 'floor_above', '一樓以上', '1F↑',   0, 1, 1),
  (1, 'floor_below', '一樓以下', '1F↓',   1, 1, 1),
  (1, 'p1',          'P1',       'P1',    2, 0, 0),
  (1, 'p3',          'P3',       'P3',    3, 0, 0),
  (1, 'spin_a',      '紡A',      '紡織-A', 4, 0, 0),
  (1, 'spin_b',      '紡B',      '紡織-B', 5, 0, 0),
  (1, 'spin_c',      '紡C',      '紡織-C', 6, 0, 0),
  (1, 'spin_d',      '紡D',      '紡織-D', 7, 0, 0),
  (1, 'spin_e',      '紡E',      '紡織-E', 8, 0, 0),
  (1, 'asphalt',     '柏油路',    '柏油路',  9, 0, 0);
