-- PostgRESTはGRANT/REVOKEのようなDDL権限変更を自動検知しないことがあるため、
-- 0058の権限剥奪を即座に反映させるためスキーマリロードを明示的に通知する。
notify pgrst, 'reload schema';
