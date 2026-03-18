# Lesson 02 — CLI Engineering Checklist

This file tracks fixes applied to `invoke.js` per lesson 02.

## 1) stderr 活跃信号
- [ ] Update activity timestamps on both stdout and stderr

## 2) 超时设置
- [ ] Add configurable timeout (env/args)
- [ ] Graceful shutdown (SIGTERM then SIGKILL)

## 3) 进程生命周期
- [ ] Handle parent SIGINT/SIGTERM to cleanup child
- [ ] Avoid zombie processes

## 4) 流式解析
- [ ] Robust NDJSON parsing (handle chunk splits / partial lines)

## 5) 环境隔离
- [ ] Add clear env config section (DEV/PROD)

## 6) 错误处理
- [ ] Better error messages
- [ ] Optional retries (keep minimal unless requested)

---

## Acceptance
All items checked, plus a short README section describing the behavior.
