DO $$
DECLARE
  v_user_id TEXT;
BEGIN
  SELECT "userId" INTO v_user_id
  FROM vault
  WHERE name = '设计模式黄金案例'
  ORDER BY "createdAt" ASC
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Demo user could not be resolved from the clean A3 vault';
  END IF;

  INSERT INTO vault (id, "userId", name, "createdAt", "updatedAt")
  VALUES (
    'a3-cap-zero-to-one-vault-20260718',
    v_user_id,
    '设计模式黄金案例·从零建库',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name,
      "updatedAt" = CURRENT_TIMESTAMP;

  RAISE NOTICE 'Prepared A3 zero-to-one vault for first-profile recording';
END $$;
