CREATE OR REPLACE FUNCTION reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable; create a new version instead', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER versions_immutable BEFORE UPDATE OR DELETE ON versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER content_versions_immutable BEFORE UPDATE OR DELETE ON content_versions
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER content_pages_immutable BEFORE UPDATE OR DELETE ON content_pages
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER chunks_immutable BEFORE UPDATE OR DELETE ON chunks
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
--> statement-breakpoint
CREATE TRIGGER passages_immutable BEFORE UPDATE OR DELETE ON passages
  FOR EACH ROW EXECUTE FUNCTION reject_mutation();
