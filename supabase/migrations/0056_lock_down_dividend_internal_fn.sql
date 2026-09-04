-- セキュリティ修正: fn_run_dividend_settlement_internal は「呼び出し元(本部の即時実行 or
-- fn_maybe_run_dividend_settlement)が既にp_event_idの権限を検証済み」という前提の内部関数
-- だったが、Postgresの新規関数はデフォルトでPUBLICにEXECUTE権限が付与されるため、
-- 実際には参加者が任意のevent_idを指定して直接呼び出せてしまっていた(実機で確認)。
-- 他のイベントの配当を不正に実行されうる重大な抜けだったため、明示的に権限を剥奪する。
revoke execute on function fn_run_dividend_settlement_internal(uuid) from public;
