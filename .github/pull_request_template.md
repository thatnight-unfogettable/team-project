## 改了什么

<!-- 一句话说清这个 PR 解决什么问题；如果修的是评审 finding，写 ID -->

-

## 动了哪些权威数字（旧值 → 新值）

<!-- 没有就写「无」。动了就必须同步 README / docs/AGENTS-10.md / PPT / 讲稿 -->

| 位置 | 旧 | 新 | 依据 |
|---|---|---|---|
|  |  |  |  |

## 验证（贴真实输出，不要写"已测试"）

```
$ node tools/smoke.js
SMOKE: PASS __ / FAIL __

$ python tools/ci/check_data.py
PASS：0 个阻断问题 / 0 个警告
```

- [ ] `data/` 没有意外改动（`git diff --stat origin/main -- data/` 只有预期项）
- [ ] 新增/修改的断言在**回退本次修复时确实变红**（反证做过）
- [ ] 文档里出现的数字与代码/数据一致（`node tools/smoke.js` 会读一部分）

## 风险与回滚

- 风险：
- 回滚方式：`git revert <sha>`

## 关联

Closes #