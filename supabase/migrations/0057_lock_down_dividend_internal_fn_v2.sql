-- 0056のrevokeがPUBLICからのみで、authenticated/anonロールへの直接GRANT
-- (Supabaseのプロジェクト初期設定が付与している可能性が高い)を剥がせていなかったため、
-- 実機再テストでもまだ直接呼び出せてしまっていた。authenticated/anonからも明示的に剥奪する。
revoke execute on function fn_run_dividend_settlement_internal(uuid) from authenticated, anon;
