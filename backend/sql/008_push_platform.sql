-- Android'da budilnik ikki xabardan iborat, shuning uchun worker qurilma platformasini ham bilishi kerak
DROP FUNCTION app.next_push();

CREATE FUNCTION app.next_push()
RETURNS TABLE (id BIGINT, type TEXT, title TEXT, body TEXT, data JSONB, devices JSONB)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT n.id, n.type::text, n.title::text, n.body, n.data,
           coalesce((SELECT jsonb_agg(jsonb_build_object('token', d.token, 'platform', d.platform))
                       FROM device_tokens d WHERE d.user_id = n.user_id), '[]')
      FROM notifications n
     WHERE n.pushed_at IS NULL AND n.created_at > now() - interval '1 hour'
     ORDER BY n.created_at
     LIMIT 1
       FOR UPDATE OF n SKIP LOCKED
$$;

REVOKE ALL ON FUNCTION app.next_push() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.next_push() TO app_worker;
